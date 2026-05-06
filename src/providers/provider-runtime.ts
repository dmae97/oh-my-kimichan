import type { TaskRunner } from "../contracts/orchestration.js";
import { createKimiTaskRunner, type KimiTaskRunnerOptions } from "../kimi/runner.js";
import { style, status } from "../util/theme.js";
import { checkDeepSeekBalance } from "./deepseek/deepseek-balance.js";
import { createDeepSeekReadOnlyTaskRunner } from "./deepseek/deepseek-provider.js";
import {
  forceDisableDeepSeek,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
} from "./deepseek/deepseek-config.js";
import { ProviderHealthRegistry } from "./health.js";
import { createProviderTaskRunner } from "./provider-task-runner.js";
import type { ProviderPolicy } from "./types.js";

export interface ProviderBackedTaskRunnerOptions {
  kimi: KimiTaskRunnerOptions;
  providerPolicy?: ProviderPolicy;
  deepseekPromptPrefix?: string;
  allowDeepSeekAdvisoryFileNodes?: boolean;
}

export async function createProviderBackedTaskRunner(
  options: ProviderBackedTaskRunnerOptions
): Promise<TaskRunner> {
  const providerPolicy = options.providerPolicy ?? "auto";
  const kimiRunner = createKimiTaskRunner(options.kimi);
  const providerHealth = new ProviderHealthRegistry();

  const deepseekStatus = providerPolicy === "auto" ? await getDeepSeekProviderStatus() : undefined;
  const deepseekKey = providerPolicy === "auto" && deepseekStatus?.enabled
    ? await resolveDeepSeekApiKey()
    : undefined;
  const deepseekCheck = providerPolicy === "auto" && deepseekStatus?.enabled && deepseekKey?.apiKey
    ? await checkDeepSeekBalance({ apiKey: deepseekKey.apiKey })
    : undefined;
  const deepseekRunner = deepseekCheck?.available
    ? createDeepSeekReadOnlyTaskRunner({
        apiKey: deepseekKey?.apiKey,
        allowAdvisoryFileNodes: options.allowDeepSeekAdvisoryFileNodes ?? true,
        promptPrefix: options.deepseekPromptPrefix,
      })
    : undefined;

  if (deepseekCheck?.available) {
    providerHealth.markDeepSeekAvailable();
  } else if (deepseekCheck) {
    providerHealth.markDeepSeekUnavailable(deepseekCheck.reason ?? "DeepSeek unavailable");
    if (deepseekCheck.reason?.includes("402")) {
      await forceDisableDeepSeek(deepseekCheck.reason, { disabledBy: "provider-402" });
      console.error(status.warn(`DeepSeek forced disabled: ${deepseekCheck.reason}`));
      console.error(style.gray("Kimi fallback is active. Run /deepseek-enable after topping up."));
    }
  } else if (providerPolicy === "auto" && deepseekStatus?.enabled === false) {
    providerHealth.markDeepSeekUnavailable(deepseekStatus.disabledReason ?? "DeepSeek disabled");
    console.error(status.warn(`DeepSeek disabled: ${deepseekStatus.disabledReason ?? "disabled by user"}`));
    console.error(style.gray("Kimi-only fallback is active. Run /deepseek-enable to re-enable."));
  }

  return createProviderTaskRunner({
    kimiRunner,
    deepseekRunner,
    providerPolicy,
    providerHealth,
    onDeepSeekDisabled: async (event) => {
      await forceDisableDeepSeek(event.reason, {
        disabledBy: event.reason.includes("402") ? "provider-402" : "provider-availability",
      });
      console.error(status.warn(`DeepSeek forced disabled: ${event.reason}`));
      console.error(style.gray(`Node ${event.nodeId} fell back to Kimi. Run /deepseek-enable after fixing balance/auth.`));
    },
  });
}

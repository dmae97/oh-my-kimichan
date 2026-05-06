import { checkDeepSeekBalance } from "../providers/deepseek/deepseek-balance.js";
import {
  forceDisableDeepSeek,
  getDeepSeekProviderStatus,
  resolveDeepSeekApiKey,
  setDeepSeekApiKey,
  setDeepSeekEnabled,
} from "../providers/deepseek/deepseek-config.js";
import { status, label, header, style } from "../util/theme.js";

export interface ProviderDoctorOptions {
  json?: boolean;
  soft?: boolean;
}

export interface ProviderJsonOptions {
  json?: boolean;
}

export interface ProviderDeepSeekSetOptions extends ProviderJsonOptions {
  fromEnv?: string;
}

export type ProviderDeepSeekApiOptions = ProviderDeepSeekSetOptions;

type ApiKeyInputSource = "env" | "stdin" | "prompt";

export async function providerDoctorCommand(
  provider: string | undefined,
  options: ProviderDoctorOptions = {}
): Promise<void> {
  const target = provider ?? "deepseek";
  if (target !== "deepseek") {
    const payload = {
      provider: target,
      available: false,
      reason: "Only deepseek provider doctor is implemented",
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(header("Provider doctor"));
      console.log(status.error(payload.reason));
    }
    if (!options.soft) process.exitCode = 1;
    return;
  }

  const providerStatus = await getDeepSeekProviderStatus();
  const key = await resolveDeepSeekApiKey();
  const result = providerStatus.enabled
    ? await checkDeepSeekBalance({ apiKey: key.apiKey })
    : {
        provider: "deepseek" as const,
        available: false,
        checkedAt: Date.now(),
        reason: providerStatus.disabledReason ?? "DeepSeek is disabled",
        disableForRun: true,
      };
  if (options.json) {
    console.log(JSON.stringify({
      ...result,
      enabled: providerStatus.enabled,
      disabledBy: providerStatus.disabledBy,
      apiKeySet: providerStatus.apiKeySet,
      apiKeySource: providerStatus.apiKeySource,
    }, null, 2));
  } else {
    console.log(header("Provider doctor"));
    console.log(label("Provider", "deepseek"));
    console.log(label("Mode", "opportunistic read-only worker"));
    console.log(label("Enabled", providerStatus.enabled ? "yes" : "no"));
    console.log(label("API key", providerStatus.apiKeySet ? `set (${providerStatus.apiKeySource ?? "unknown"})` : "missing"));
    if (result.available) {
      console.log(status.ok("DeepSeek is available"));
      const balances = result.balance?.balance_infos ?? [];
      for (const balance of balances) {
        console.log(label(`Balance ${balance.currency}`, balance.total_balance));
      }
    } else {
      console.log(status.error(result.reason ?? "DeepSeek unavailable"));
      if (!providerStatus.enabled) {
        console.log(style.gray("Run /deepseek-enable or `omk deepseek enable` after fixing the issue."));
      }
      console.log(style.gray("Fallback: Kimi remains the primary provider for all nodes."));
    }
  }

  if (!result.available && !options.soft) {
    process.exitCode = 1;
  }
}

export async function providerDeepSeekEnableCommand(options: ProviderJsonOptions = {}): Promise<void> {
  const config = await setDeepSeekEnabled(true);
  const payload = {
    provider: "deepseek",
    enabled: config.enabled !== false,
    message: "DeepSeek opportunistic workers enabled",
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(header("DeepSeek provider"));
    console.log(status.ok(payload.message));
    console.log(style.gray("Kimi remains the orchestrator; DeepSeek is used only for safe read/review/QA/documentation nodes."));
  }
}

export async function providerDeepSeekDisableCommand(
  reason = "Disabled by user",
  options: ProviderJsonOptions = {}
): Promise<void> {
  const config = await forceDisableDeepSeek(reason, { disabledBy: "user" });
  const payload = {
    provider: "deepseek",
    enabled: config.enabled !== false,
    disabledReason: config.disabledReason,
    disabledBy: config.disabledBy,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(header("DeepSeek provider"));
    console.log(status.warn("DeepSeek forced disabled"));
    console.log(label("Reason", config.disabledReason ?? reason));
    console.log(style.gray("Kimi-only fallback remains active."));
  }
}

export async function providerDeepSeekSetCommand(options: ProviderDeepSeekSetOptions = {}): Promise<void> {
  const input = await resolveApiKeyInput({ ...options, promptWhenTty: true });
  await saveDeepSeekApiKey(input, options);
}

export async function providerDeepSeekApiCommand(
  options: ProviderDeepSeekApiOptions = {}
): Promise<void> {
  const input = await resolveApiKeyInput({
    fromEnv: options.fromEnv,
    promptWhenTty: true,
  });
  await saveDeepSeekApiKey(input, options);
}

async function resolveApiKeyInput(
  options: ProviderDeepSeekSetOptions & { promptWhenTty?: boolean }
): Promise<{ apiKey: string; source: ApiKeyInputSource }> {
  if (options.fromEnv) {
    const value = process.env[options.fromEnv];
    if (!value) throw new Error(`Environment variable is not set: ${options.fromEnv}`);
    return { apiKey: value, source: "env" };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { apiKey: process.env.DEEPSEEK_API_KEY, source: "env" };
  }

  if (!process.stdin.isTTY) {
    const stdin = await readStdin();
    if (stdin.trim()) return { apiKey: stdin.trim(), source: "stdin" };
  }

  if (options.promptWhenTty && process.stdin.isTTY && process.stdout.isTTY) {
    const { password } = await import("@inquirer/prompts");
    const apiKey = await password({
      message: "DeepSeek API key",
      mask: "*",
      validate: (value) => value.trim().length > 0 || "DeepSeek API key is required",
    });
    return { apiKey, source: "prompt" };
  }

  throw new Error("DeepSeek API key is required. Use `omk deepseek api --from-env DEEPSEEK_API_KEY` or pipe the key via stdin.");
}

async function saveDeepSeekApiKey(
  input: { apiKey: string; source: ApiKeyInputSource },
  options: ProviderJsonOptions = {}
): Promise<void> {
  const result = await setDeepSeekApiKey(input.apiKey);
  const payload = {
    provider: "deepseek",
    enabled: true,
    apiKeySet: true,
    apiKeyEnv: result.apiKeyEnv,
    secretsPath: result.secretsPath,
    source: input.source,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(header("DeepSeek provider"));
    console.log(status.ok("DeepSeek API key saved without printing it"));
    console.log(label("Secret file", result.secretsPath));
    console.log(label("Env", result.apiKeyEnv));
    console.log(style.gray("DeepSeek hybrid routing has been enabled. Run `omk deepseek doctor` to verify balance."));
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

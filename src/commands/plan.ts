import { runShell } from "../util/shell.js";
import { getOmkPath, getProjectRoot, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import { t } from "../util/i18n.js";

export async function planCommand(goal: string, options: { thinking?: string; runId?: string }): Promise<void> {
  const root = getProjectRoot();
  const agentFile = getOmkPath("agents/roles/architect.yaml");
  const sessionId = createOmkSessionId("plan");

  if (!(await pathExists(agentFile))) {
    console.error(status.error(t("plan.architectMissing")));
    process.exit(1);
  }

  const promptText = t("plan.prompt", goal);

  console.log(header(t("plan.header")));
  console.log(label(t("plan.goalLabel"), goal) + "\n");
  const args = ["--print", "--output-format=stream-json"];
  args.push("--agent-file", agentFile);
  // ⚠️ Using --config-file causes kimi to throw "Login requires the default config file".
  //    Hooks are injected via mergeKimiHooks() into ~/.kimi/config.toml.

  // Always sync hooks + MCP + skills globally to ~/.kimi/
  await injectKimiGlobals(args);

  args.push("-p", promptText);

  const env = createOmkSessionEnv(root, sessionId);
  if (options.runId) {
    env.OMK_RUN_ID = options.runId;
  }

  const result = await runShell("kimi", args, {
    timeout: 120000,
    cwd: root,
    env,
  });
  console.log(result.stdout);
  if (result.failed) {
    console.error(result.stderr);
    process.exit(result.exitCode);
  }
}

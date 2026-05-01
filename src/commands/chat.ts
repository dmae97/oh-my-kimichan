import { getOmkPath, getProjectRoot, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header, status, kimichanCliHero } from "../util/theme.js";
import { readFile } from "fs/promises";
import { dirname, join, isAbsolute } from "path";
import YAML from "yaml";
import { initCommand } from "./init.js";
import { runKimiInteractive } from "../util/kimi-runner.js";
import { createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import { t } from "../util/i18n.js";

async function verifyAgentPrompt(agentFile: string): Promise<boolean> {
  if (!(await pathExists(agentFile))) return false;
  try {
    const raw = await readFile(agentFile, "utf8");
    const parsed = YAML.parse(raw);
    const promptPath = parsed?.agent?.system_prompt_path as string | undefined;
    if (!promptPath) return true;
    const resolved = isAbsolute(promptPath)
      ? promptPath
      : join(dirname(agentFile), promptPath);
    return await pathExists(resolved);
  } catch {
    return false;
  }
}

export async function chatCommand(options: { agentFile?: string; runId?: string; workers?: string; maxStepsPerTurn?: string }): Promise<void> {
  const root = getProjectRoot();
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");
  const sessionId = createOmkSessionId("chat");
  const runId = options.runId;

  const promptOk = await verifyAgentPrompt(agentFile);
  if (!promptOk) {
    console.log(
      status.warn(t("chat.notInitialized"))
    );
    await initCommand({ profile: "default" });
    console.log(status.ok(t("chat.autoInitComplete")));
  }

  console.log(style.gray("agent: ") + style.cream(agentFile) + "\n");

  // ── Print OMK status summary (HUD/TODO preview before entering chat) ──
  try {
    const { renderHudDashboard } = await import("./hud.js");
    const hud = await renderHudDashboard({ runId, terminalWidth: process.stdout.columns });
    // Trim HUD to 20 lines compactly
    const lines = hud.split("\n");
    const summary = lines.slice(0, Math.min(lines.length, 20)).join("\n");
    console.log(summary);
    console.log(style.gray(t("chat.scrollUpForHud")));
  } catch {
    // Ignore HUD failure
  }

  const args: string[] = [];
  args.push("--agent-file", agentFile);
  // ⚠️ Using --config-file causes kimi to throw "Login requires the default config file".
  //    Hooks are injected via mergeKimiHooks() into ~/.kimi/config.toml.

  // Always sync hooks + MCP + skills globally to ~/.kimi/
  await injectKimiGlobals(args);
  if (process.env.OMK_DEBUG === "1") {
    console.error("[OMK_DEBUG] chat args:", args);
  }

  // ── Run Kimi CLI via node-pty (intercept banner and replace with custom banner) ──
  console.log(style.purple("🌸 oh-my-kimichan is wrapping Kimi CLI..."));

  const env = createOmkSessionEnv(root, sessionId);
  if (runId) {
    env.OMK_RUN_ID = runId;
  }

  await runKimiInteractive(args, {
    cwd: root,
    env,
  });
}

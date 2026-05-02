import { getOmkPath, getProjectRoot, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, status } from "../util/theme.js";
import { runShell } from "../util/shell.js";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join, isAbsolute, relative } from "path";

export async function ensureChatRunState(root: string, runId: string): Promise<void> {
  const runDir = join(root, ".omk", "runs", runId);
  await mkdir(runDir, { recursive: true });
  const statePath = join(runDir, "state.json");
  if (!(await pathExists(statePath))) {
    const state = {
      schemaVersion: 1,
      runId,
      status: "running",
      nodes: [
        {
          id: "chat",
          name: "Chat Session",
          role: "chat",
          dependsOn: [],
          status: "running",
          retries: 0,
          maxRetries: 0,
          startedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(state, null, 2));
  }
}

export async function updateChatHeartbeat(root: string, runId: string): Promise<void> {
  const statePath = join(root, ".omk", "runs", runId, "state.json");
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    const started = Date.parse(chatNode.startedAt);
    chatNode.durationMs = Date.now() - (Number.isNaN(started) ? Date.now() : started);
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore heartbeat failures
  }
}

export async function updateChatThinking(root: string, runId: string, thinking: string): Promise<void> {
  const statePath = join(root, ".omk", "runs", runId, "state.json");
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    chatNode.thinking = thinking;
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore
  }
}

export async function finalizeChatRunState(root: string, runId: string, success: boolean): Promise<void> {
  const statePath = join(root, ".omk", "runs", runId, "state.json");
  try {
    const raw = await readFile(statePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse(raw) as any;
    if (!state.nodes?.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatNode = state.nodes.find((n: any) => n.id === "chat");
    if (!chatNode) return;
    chatNode.status = success ? "done" : "failed";
    chatNode.completedAt = new Date().toISOString();
    const started = Date.parse(chatNode.startedAt);
    chatNode.durationMs = Date.now() - (Number.isNaN(started) ? Date.now() : started);
    state.status = success ? "done" : "failed";
    state.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } catch {
    // ignore finalize failures
  }
}
import YAML from "yaml";
import { initCommand } from "./init.js";
import { runKimiInteractive } from "../util/kimi-runner.js";
import { createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import { t } from "../util/i18n.js";
import { detectTmux, launchChatCockpit, isCockpitChild } from "../util/chat-cockpit.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

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

type ChatLayout = "auto" | "tmux" | "inline" | "plain";
type ChatBrand = "kimichan" | "minimal" | "plain";

function resolveLayout(requested: ChatLayout | undefined): ChatLayout {
  if (requested && requested !== "auto") return requested;
  // Already inside a tmux cockpit pane — never launch tmux again
  if (isCockpitChild()) return "inline";
  return "auto";
}

function renderChatIntro(
  brand: ChatBrand,
  meta: { agent: string; runId?: string; layout: ChatLayout; trust: string }
): string {
  const titleKey: Record<ChatBrand, string> = {
    kimichan: "chat.intro.kimichan",
    minimal: "chat.intro.minimal",
    plain: "chat.intro.plain",
  };
  const title = t(titleKey[brand] ?? titleKey.kimichan);
  const lines: string[] = [style.purpleBold(`🌸 ${title}`)];
  if (brand !== "plain") {
    lines.push(
      `  ${style.gray(t("chat.intro.agent") + ":")} ${style.cream(meta.agent)}`
    );
    if (meta.runId) {
      lines.push(
        `  ${style.gray(t("chat.intro.run") + ":")} ${style.cream(meta.runId)}`
      );
    }
    lines.push(
      `  ${style.gray(t("chat.intro.layout") + ":")} ${style.cream(meta.layout)}`
    );
    lines.push(
      `  ${style.gray(t("chat.intro.trust") + ":")} ${style.cream(meta.trust)}`
    );
  }
  return lines.join("\n");
}

export async function chatCommand(options: {
  agentFile?: string;
  runId?: string;
  workers?: string;
  maxStepsPerTurn?: string;
  layout?: ChatLayout;
  brand?: ChatBrand;
}): Promise<void> {
  const root = getProjectRoot();
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");
  const sessionId = createOmkSessionId("chat");
  const runId = options.runId;
  const effectiveRunId = runId ?? sessionId;
  const layout = resolveLayout(options.layout);
  const brand = options.brand ?? "kimichan";

  const promptOk = await verifyAgentPrompt(agentFile);
  if (!promptOk) {
    console.log(status.warn(t("chat.notInitialized")));
    await initCommand({ profile: "default" });
    console.log(status.ok(t("chat.autoInitComplete")));
  }

  // ── tmux layout: delegate to cockpit launcher ──
  if (layout === "tmux") {
    const hasTmux = await detectTmux();
    if (!hasTmux) {
      console.error(status.error(t("chat.cockpitTmuxNotFound")));
      console.error(style.gray(t("chat.cockpitTmuxInstallHint")));
      process.exit(1);
    }
    if (!process.stdout.isTTY) {
      console.error(status.error("tmux layout requires a TTY"));
      process.exit(1);
    }
    await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root });
    return;
  }

  // ── auto layout: tmux if available and TTY, else inline ──
  if (layout === "auto") {
    const hasTmux = await detectTmux();
    if (hasTmux && process.stdout.isTTY) {
      await launchChatCockpit({ runId: effectiveRunId, brand, cwd: root });
      return;
    }
    // fall through to inline
  }

  // ── plain / inline: run Kimi directly ──
  const isPlain = layout === "plain";

  if (!isPlain) {
    const resources = await getOmkResourceSettings();
    const trust = `${resources.mcpScope} MCP / ${resources.skillsScope} skills`;
    const agentDisplay = relative(root, agentFile);
    console.log(
      renderChatIntro(brand, {
        agent: agentDisplay,
        runId: effectiveRunId,
        layout: isPlain ? "plain" : "inline",
        trust,
      }) + "\n"
    );
  }

  // ── Print OMK status summary (HUD/TODO preview before entering chat) ──
  if (!isPlain) {
    try {
      const { renderHudDashboard } = await import("./hud.js");
      const hud = await renderHudDashboard({ runId: effectiveRunId, terminalWidth: process.stdout.columns });
      const lines = hud.split("\n");
      const summary = lines.slice(0, Math.min(lines.length, 20)).join("\n");
      console.log(summary);
      console.log(style.gray(t("chat.scrollUpForHud")));
    } catch {
      // Ignore HUD failure
    }
  }

  const args: string[] = [];
  args.push("--agent-file", agentFile);
  await injectKimiGlobals(args);
  if (process.env.OMK_DEBUG === "1") {
    console.error("[OMK_DEBUG] chat args:", args);
  }

  const env = createOmkSessionEnv(root, sessionId);
  if (options.workers) {
    env.OMK_WORKERS = options.workers;
  }
  if (options.maxStepsPerTurn) {
    args.push("--max-steps-per-turn", options.maxStepsPerTurn);
  }

  env.OMK_RUN_ID = effectiveRunId;

  await ensureChatRunState(root, effectiveRunId);

  // ── Live heartbeat: keep state.json fresh while chat is active ──
  const HEARTBEAT_MS = 2000;
  let lastThinking = "";
  const pendingUpdates = new Set<Promise<void>>();
  function track(p: Promise<void>): void {
    pendingUpdates.add(p);
    p.then(() => pendingUpdates.delete(p), () => pendingUpdates.delete(p));
  }
  const heartbeat = setInterval(() => {
    track(updateChatHeartbeat(root, effectiveRunId).catch(() => {}));
  }, HEARTBEAT_MS);

  let exitCode = 0;
  try {
    exitCode = await runKimiInteractive(args, {
      cwd: root,
      env,
      onData: (data) => {
        // Lightweight activity sampling: extract short tool/thinking snippets
        const lines = data.split("\n");
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.length < 3) continue;
          if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
            const m = line.match(/["']([^"']{1,60})["']/);
            lastThinking = m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`;
            track(updateChatThinking(root, effectiveRunId, lastThinking).catch(() => {}));
            continue;
          }
          const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
          if (explicit) {
            lastThinking = `🧠 ${explicit[1].trim().slice(0, 100)}`;
            track(updateChatThinking(root, effectiveRunId, lastThinking).catch(() => {}));
            continue;
          }
        }
      },
    });
  } finally {
    clearInterval(heartbeat);
    await Promise.all(pendingUpdates);
    await finalizeChatRunState(root, effectiveRunId, exitCode === 0);
    if (isCockpitChild()) {
      const sanitized = effectiveRunId.replace(/[^a-zA-Z0-9]/g, "-");
      const session = `omk-chat-${sanitized}`;
      await runShell("tmux", ["kill-session", "-t", session], { cwd: root, timeout: 5000 }).catch(() => {});
    }
  }
}

import pty from "node-pty";
import { BannerReplacer } from "./kimi-banner.js";
import { KimiBugFilter } from "./kimi-bug-filter.js";
import { kimichanBanner, style } from "./theme.js";
import { ensureDir, injectKimiGlobals, getProjectRoot } from "./fs.js";
import { join } from "path";
import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { runShellStreaming } from "./shell.js";
import { getOmkResourceSettings, type OmkRuntimeScope } from "./resource-profile.js";
import { KimiStatusLineEnhancer } from "./kimi-statusline.js";
import { formatOmkVersionFooter } from "./version.js";

export async function runKimiInteractive(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    onMeta?: (meta: { directory?: string; session?: string; model?: string }) => void;
  }
): Promise<void> {
  const resources = await getOmkResourceSettings();

  // Debug: log args so we can verify MCP/skills flags are present
  process.stderr.write(`[omk-debug] runKimiInteractive args: ${JSON.stringify(args)}\n`);

  const replacer = new BannerReplacer((meta) => {
    writeStdout(kimichanBanner(meta, formatOmkVersionFooter()) + "\n");
    options?.onMeta?.(meta);
  });
  const bugFilter = new KimiBugFilter();
  const statusLine = await KimiStatusLineEnhancer.create();
  const originalRawMode = process.stdin.isTTY ? process.stdin.isRaw : undefined;

  const env = options?.env
    ? { ...(process.env as Record<string, string>), OMK_RESOURCE_PROFILE_EFFECTIVE: resources.profile, ...options.env }
    : { ...(process.env as Record<string, string>), OMK_RESOURCE_PROFILE_EFFECTIVE: resources.profile };

  const ptyProcess = pty.spawn("kimi", args, {
    name: "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: options?.cwd ?? process.cwd(),
    env,
  });

  // ── Backpressure-safe stdout writer ──
  // Prevents process.stdout.write from blocking the event loop when the
  // TTY is slow, which in turn starves stdin keypress handlers.
  const stdoutQueue: string[] = [];
  let stdoutWriting = false;
  const MAX_QUEUE_SIZE = 4096; // memory safety cap: drop oldest chunks under extreme backpressure
  let queueOverflowWarned = false;

  function flushStdoutQueue(): void {
    stdoutWriting = true;
    while (stdoutQueue.length > 0) {
      const chunk = stdoutQueue.shift()!;
      if (!process.stdout.write(chunk)) {
        process.stdout.once("drain", () => {
          stdoutWriting = false;
          flushStdoutQueue();
        });
        return;
      }
    }
    stdoutWriting = false;
    queueOverflowWarned = false;
  }

  function writeStdout(data: string): void {
    if (stdoutQueue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest 25% to recover instead of unbounded growth
      const dropCount = Math.max(1, Math.floor(MAX_QUEUE_SIZE * 0.25));
      stdoutQueue.splice(0, dropCount);
      if (!queueOverflowWarned) {
        queueOverflowWarned = true;
        process.stderr.write(style.red("[omk] stdout queue overflow: dropped old chunks to prevent OOM\n"));
      }
    }
    stdoutQueue.push(data);
    if (!stdoutWriting) {
      flushStdoutQueue();
    }
  }

  // stdout → 터미널 (버그 필터 → 배너 필터링 적용)
  ptyProcess.onData((data) => {
    const bugResult = bugFilter.process(data);
    if (bugResult.sendEnter) {
      ptyProcess.write("\n");
    }
    if (bugResult.output === null) {
      return;
    }
    const output = replacer.process(bugResult.output);
    if (output !== null) {
      writeStdout(statusLine.process(output));
    }
  });

  // stdin → pty (Buffer passthrough for lower latency)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (data: string | Buffer) => {
    ptyProcess.write(typeof data === "string" ? data : data.toString("utf8"));
  });

  // 터미널 리사이즈 → pty 동기화
  process.stdout.on("resize", () => {
    ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  // 종료 대기
  return new Promise<void>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      const bugRest = bugFilter.forceFlush();
      if (bugRest) writeStdout(statusLine.process(bugRest));
      const replacerRest = replacer.forceFlush();
      if (replacerRest) writeStdout(statusLine.process(replacerRest));
      statusLine.dispose();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(originalRawMode ?? false);
      }
      process.stdin.pause();
      // Do NOT process.exit here — the caller should decide when to exit.
      // Returning the exit code via resolve is enough for the wrapper to handle.
      if (exitCode !== 0) {
        process.stderr.write(style.red(`[omk] kimi exited with code ${exitCode}\n`));
      }
      resolve();
    });
  });
}

export interface KimiTaskRunnerOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  agentFile?: string;
  promptPrefix?: string;
  mcpScope?: OmkRuntimeScope;
  skillsScope?: OmkRuntimeScope;
  onThinking?: (thinking: string) => void;
}

function createLiveThinkingHandler(onThinking: ((thinking: string) => void) | undefined) {
  if (!onThinking) return undefined;
  let recentLine = "";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (recentLine) onThinking(`📝 ${recentLine}`);
  };

  return (chunk: string) => {
    const lines = chunk.split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.length < 3) continue;

      // Explicit thinking markers
      const explicit = line.match(/^<think(?:ing)?>[\s:]*(.+?)(?:<\/think(?:ing)?>)?$/i);
      if (explicit) {
        onThinking(`🧠 ${explicit[1].trim().slice(0, 100)}`);
        continue;
      }

      // Tool/file activity
      if (/read_file|write_file|edit_file|search_files|glob|grep|ctx_read/i.test(line)) {
        const m = line.match(/["']([^"']{1,60})["']/);
        onThinking(m ? `📄 ${m[1].split("/").pop() ?? m[1]}` : `🔧 ${line.slice(0, 60)}`);
        continue;
      }

      if (line.length > 5 && line.length < 120 && !line.startsWith("```")) {
        recentLine = line.slice(0, 80);
      }
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 400);
  };
}

export function createKimiTaskRunner(options: KimiTaskRunnerOptions = {}): TaskRunner {
  const { cwd, timeout = 120000, env, agentFile, promptPrefix, mcpScope, skillsScope, onThinking } = options;
  let currentOnThinking = onThinking;

  const runner: TaskRunner = {
    get onThinking() {
      return currentOnThinking;
    },
    set onThinking(fn) {
      currentOnThinking = fn;
    },

    async run(node: DagNode, nodeEnv: Record<string, string>): Promise<TaskResult> {
      const mergedEnv = { ...env, ...nodeEnv };
      const args: string[] = [];
      await injectKimiGlobals(args, { mcpScope, skillsScope });
      if (agentFile) {
        args.push("--agent-file", agentFile);
      }
      args.push("--prompt", buildNodeMessage(node, mergedEnv, promptPrefix));
      args.push("--print");

      const worktree = node.worktree ?? cwd;
      if (worktree) {
        await ensureDir(worktree);
      }

      const runId = mergedEnv.OMK_RUN_ID;
      const logPath = runId
        ? join(getProjectRoot(), ".omk", "runs", runId, `${node.id}.log`)
        : undefined;

      const thinkingHandler = createLiveThinkingHandler(currentOnThinking);

      const result = await runShellStreaming("kimi", args, {
        cwd: worktree,
        timeout,
        env: mergedEnv,
        logPath,
        onStdout: thinkingHandler,
      });

      // Debug: log runner result so we can diagnose unexpected failures
      if (result.failed || result.exitCode !== 0) {
        const stderrPreview = result.stderr.slice(0, 500).replace(/\n/g, "\\n");
        process.stderr.write(
          `[omk-debug] node=${node.id} exitCode=${result.exitCode} failed=${result.failed} stdoutLen=${result.stdout.length} stderrLen=${result.stderr.length} stderrPreview=${stderrPreview}\n`
        );
      }

      const prefix = `[${node.id}:${node.role}] `;
      const prefixStdout = result.stdout
        .split("\n")
        .map((line) => (line.trim() ? prefix + line : line))
        .join("\n");
      const prefixStderr = result.stderr
        .split("\n")
        .map((line) => (line.trim() ? prefix + line : line))
        .join("\n");

      // Kimi CLI (--print) may return exit code 1 when an MCP server fails to
      // connect, even though it produced meaningful stdout. Treat non-empty
      // stdout as success so the DAG can continue.
      const hasOutput = result.stdout.trim().length > 0;
      return {
        success: (!result.failed && result.exitCode === 0) || hasOutput,
        exitCode: result.exitCode,
        stdout: prefixStdout,
        stderr: prefixStderr,
      };
    },
  };

  return runner;
}

function buildNodeMessage(
  node: DagNode,
  env: Record<string, string>,
  promptPrefix?: string
): string {
  const routing = node.routing;
  const sections = [
    promptPrefix?.trim(),
    [
      `Execute DAG node: ${node.id}`,
      `Name: ${node.name}`,
      `Role: ${node.role}`,
      `Run ID: ${env.OMK_RUN_ID ?? ""}`,
      `Dependencies: ${node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "none"}`,
      `Skill hints: ${routing?.skills?.join(", ") || env.OMK_SKILL_HINTS || "none"}`,
      `MCP hints: ${routing?.mcpServers?.join(", ") || env.OMK_MCP_HINTS || "none"}`,
      `Tool hints: ${routing?.tools?.join(", ") || env.OMK_TOOL_HINTS || "none"}`,
      `Context budget: ${routing?.contextBudget ?? env.OMK_CONTEXT_BUDGET ?? "small"}`,
      `Evidence required: ${String(routing?.evidenceRequired ?? env.OMK_ROUTE_EVIDENCE_REQUIRED ?? false)}`,
    ].join("\n"),
    [
      "Instructions:",
      "- Keep context small and read only the files needed for this node.",
      "- Use the listed skills/MCP/tools when they fit the node.",
      "- Produce concrete evidence, changed files, blockers, and verification result.",
      "- Do not silently skip required gates.",
    ].join("\n"),
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}

import pty from "node-pty";
import { BannerReplacer } from "./kimi-banner.js";
import { KimiBugFilter } from "./kimi-bug-filter.js";
import { kimichanBanner, style } from "./theme.js";
import { ensureDir, injectKimiGlobals, getProjectRoot, pathExists } from "./fs.js";
import { readClipboardImage } from "./clipboard-image.js";
import { join, resolve } from "path";
import { spawn } from "child_process";
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
    onData?: (data: string) => void;
  }
): Promise<number> {
  const resources = await getOmkResourceSettings();

  // Debug: log args so we can verify MCP/skills flags are present
  if (process.env.OMK_DEBUG === "1") {
    process.stderr.write(`[omk-debug] runKimiInteractive args: ${JSON.stringify(args)}\n`);
  }

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
    options?.onData?.(data);
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
    const text = typeof data === "string" ? data : data.toString("utf8");

    // Ctrl+V (0x16) — paste clipboard image directly into the prompt
    if (text.includes("\x16")) {
      const remaining = text.replace(/\x16/g, "");
      const result = readClipboardImage(getProjectRoot());
      if (result.path && result.relativePath) {
        // If user pressed Ctrl+V by itself, auto-submit with a newline so Kimi sees it immediately.
        // If Ctrl+V was mixed with other typed text, only insert the path without newline.
        const autoSubmit = remaining.trim().length === 0 ? "\n" : "";
        ptyProcess.write(`[IMAGE: ./${result.relativePath}]${autoSubmit}`);
      } else if (remaining.trim().length === 0) {
        ptyProcess.write(`[Clipboard: no image found]\n`);
      }
      if (remaining) {
        ptyProcess.write(remaining);
      }
      return;
    }

    // /paste-image — explicit command to insert clipboard image path
    if (text.trim() === "/paste-image") {
      const result = readClipboardImage(getProjectRoot());
      if (result.path && result.relativePath) {
        ptyProcess.write(`[IMAGE: ./${result.relativePath}]\n`);
      } else {
        ptyProcess.write(`[Clipboard image error: ${result.error ?? "No image found"}]\n`);
      }
      return;
    }

    // /goal-image — create an omk goal from clipboard image and run in parallel
    if (text.trim() === "/goal-image") {
      const result = readClipboardImage(getProjectRoot());
      if (result.path && result.relativePath) {
        ptyProcess.write(`[Goal image: ./${result.relativePath}] — spawning parallel agents…\n`);
        spawnImageGoal(result.path, result.relativePath);
      } else {
        ptyProcess.write(`[Clipboard image error: ${result.error ?? "No image found"}]\n`);
      }
      return;
    }

    ptyProcess.write(text);
  });

  // 터미널 리사이즈 → pty 동기화
  process.stdout.on("resize", () => {
    ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  // 종료 대기
  return new Promise<number>((resolve) => {
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
      resolve(exitCode);
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
  /** If true, automatically pick .omk/agents/{role}.yaml per node role */
  roleAgentFiles?: boolean;
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

async function resolveAgentFileForRole(role: string, fallback?: string): Promise<string | undefined> {
  const projectRoot = getProjectRoot();
  const candidates = [
    join(projectRoot, ".omk", "agents", `${role}.yaml`),
    join(projectRoot, ".omk", "agents", `${role}.yml`),
    join(projectRoot, ".omk", "agents", "roles", `${role}.yaml`),
    join(projectRoot, ".omk", "agents", "roles", `${role}.yml`),
    join(projectRoot, ".kimi", "agents", `${role}.yaml`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return fallback;
}

export function createKimiTaskRunner(options: KimiTaskRunnerOptions = {}): TaskRunner {
  const { cwd, timeout = 120000, env, agentFile, promptPrefix, mcpScope, skillsScope, onThinking, roleAgentFiles } = options;
  let currentOnThinking = onThinking;

  const runner: TaskRunner = {
    get onThinking() {
      return currentOnThinking;
    },
    set onThinking(fn) {
      currentOnThinking = fn;
    },

    fork(newOnThinking) {
      return createKimiTaskRunner({ ...options, onThinking: newOnThinking });
    },

    async run(node: DagNode, nodeEnv: Record<string, string>): Promise<TaskResult> {
      const mergedEnv = { ...env, ...nodeEnv };
      const args: string[] = [];
      await injectKimiGlobals(args, { mcpScope, skillsScope, role: node.role });

      const resolvedAgentFile = roleAgentFiles
        ? await resolveAgentFileForRole(node.role, agentFile)
        : agentFile;
      if (resolvedAgentFile) {
        args.push("--agent-file", resolvedAgentFile);
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

function spawnImageGoal(imagePath: string, relativePath: string): void {
  const goalPrompt = `Analyze and process the attached image at ${relativePath}. Inspect the image contents, describe what you see, and propose relevant actions or code changes.`;
  const omkCli = process.argv[1] ? resolve(process.argv[1]) : "omk";
  const root = getProjectRoot();

  // Step 1: create goal
  const create = spawn(process.execPath, [omkCli, "goal", "create", goalPrompt, "--json"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env as NodeJS.ProcessEnv,
  });

  let stdout = "";
  let stderr = "";
  create.stdout.on("data", (d: Buffer) => {
    stdout += d.toString("utf8");
  });
  create.stderr.on("data", (d: Buffer) => {
    stderr += d.toString("utf8");
  });

  create.on("close", (code: number | null) => {
    if (code !== 0) {
      process.stderr.write(
        `[omk] goal create failed for image ${relativePath}${stderr ? `: ${stderr.trim()}` : ""}\n`
      );
      return;
    }
    try {
      const spec = JSON.parse(stdout);
      const goalId = spec.goalId as string | undefined;
      if (!goalId) {
        process.stderr.write(`[omk] goal create returned no goalId\n`);
        return;
      }
      // Step 2: run goal in parallel (detached)
      const run = spawn(process.execPath, [omkCli, "goal", "run", goalId], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: process.env as NodeJS.ProcessEnv,
      });
      run.unref();
      process.stderr.write(`[omk] Spawned parallel goal ${goalId} for image ${relativePath}\n`);
    } catch {
      process.stderr.write(`[omk] Failed to parse goal create output: ${stdout.slice(0, 200)}\n`);
    }
  });

  create.unref();
}

function buildNodeMessage(
  node: DagNode,
  env: Record<string, string>,
  promptPrefix?: string
): string {
  const routing = node.routing;
  const mandatoryRouting: string[] = [];
  if (routing?.skills?.length) {
    mandatoryRouting.push(`- Skills (MUST use): ${routing.skills.join(", ")}`);
  }
  if (routing?.mcpServers?.length) {
    mandatoryRouting.push(`- MCP servers (MUST activate): ${routing.mcpServers.join(", ")}`);
  }
  if (routing?.tools?.length) {
    mandatoryRouting.push(`- Tools (MUST call when relevant): ${routing.tools.join(", ")}`);
  }
  if (routing?.rationale) {
    mandatoryRouting.push(`- Rationale: ${routing.rationale}`);
  }

  const sections = [
    promptPrefix?.trim(),
    [
      `Execute DAG node: ${node.id}`,
      `Name: ${node.name}`,
      `Role: ${node.role}`,
      `Run ID: ${env.OMK_RUN_ID ?? ""}`,
      `Dependencies: ${node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "none"}`,
      `Context budget: ${routing?.contextBudget ?? env.OMK_CONTEXT_BUDGET ?? "small"}`,
      `Evidence required: ${String(routing?.evidenceRequired ?? env.OMK_ROUTE_EVIDENCE_REQUIRED ?? false)}`,
    ].join("\n"),
    mandatoryRouting.length > 0
      ? [
          "Routing directives (MANDATORY — activate these skills/MCP/tools explicitly):",
          ...mandatoryRouting,
          "- Do not ignore the routing hints above.",
          "- If a skill or MCP server is listed, prefer its capabilities over generic reasoning.",
        ].join("\n")
      : undefined,
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

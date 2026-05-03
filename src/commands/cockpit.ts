/**
 * OMK Chat Cockpit — compact read-only run-state sidecar.
 */

import { readFile, readdir, stat as fsStat } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getOmkPath, getProjectRoot, pathExists } from "../util/fs.js";
import {
  buildRunViewModel,
  parseRunStateResult,
  type RunViewModel,
  type RunHealth,
  type RunViewModelWorker,
} from "../util/run-view-model.js";
import {
  style,
  panel,
  gradient,
  separator,
  sanitizeTerminalText,
  getSystemUsage,
} from "../util/theme.js";
import { getKimiUsage } from "../kimi/usage.js";
import { parseGitStatusPorcelain, listRunCandidates } from "./hud.js";
import { discoverRoutingInventory } from "../orchestration/routing.js";
import { readTodos, deriveTodosFromState } from "../util/todo-sync.js";
import { readSessionMeta, type SessionMeta } from "../util/session.js";

const execFileAsync = promisify(execFile);

export interface CockpitCommandOptions {
  runId?: string;
  watch?: boolean;
  refreshMs?: number;
}

export interface CockpitRenderOptions {
  runId?: string;
  terminalWidth?: number;
}

// Local helpers mirrored from hud.ts to keep cockpit self-contained.

const ANSI_REGEX = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;

/** Truncate visible text while preserving ANSI escape sequences. */
function truncateLine(line: string, maxWidth: number): string {
  const clean = sanitizeTerminalText(line);
  if (clean.length <= maxWidth) return line;

  let visibleCount = 0;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_REGEX.lastIndex = 0;
  while ((match = ANSI_REGEX.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index);
    for (const char of textBefore) {
      if (visibleCount >= maxWidth - 1) {
        return result + style.gray("…");
      }
      result += char;
      visibleCount++;
    }
    result += match[0];
    lastIndex = ANSI_REGEX.lastIndex;
  }

  const remaining = line.slice(lastIndex);
  for (const char of remaining) {
    if (visibleCount >= maxWidth - 1) {
      return result + style.gray("…");
    }
    result += char;
    visibleCount++;
  }

  return result;
}

function truncateText(value: string, maxLength: number): string {
  const clean = sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= maxLength) return clean;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function statusRank(statusValue: string): number {
  const normalized = statusValue.toLowerCase();
  switch (normalized) {
    case "running":
    case "in_progress": return 0;
    case "pending": return 1;
    case "blocked": return 2;
    case "failed": return 3;
    case "skipped": return 4;
    case "done":
    case "completed": return 5;
    default: return 6;
  }
}

function todoMarker(statusValue: string): string {
  const normalized = statusValue.toLowerCase();
  switch (normalized) {
    case "running":
    case "in_progress": return style.purpleBold("▶");
    case "done":
    case "completed": return style.mintBold("✓");
    case "failed": return style.red("✕");
    case "blocked": return style.orange("■");
    case "skipped": return style.gray("⊘");
    default: return style.gray("□");
  }
}

function gitMarker(changeStatus: string): string {
  const normalized = changeStatus.replace(/\s/g, "");
  if (normalized === "??") return style.blue("?");
  if (normalized.includes("D")) return style.red("D");
  if (normalized.includes("A")) return style.mint("A");
  if (normalized.includes("R")) return style.purple("R");
  return style.orange("M");
}

function healthColor(health: RunHealth): (s: string) => string {
  switch (health) {
    case "ok": return style.mint;
    case "warn": return style.orange;
    case "blocked": return style.orange;
    case "failed": return style.red;
    default: return style.gray;
  }
}

async function getGitChanges(root: string): Promise<{ status: string; path: string }[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: root, timeout: 5000, maxBuffer: 1024 * 1024, encoding: "utf-8" }
    );
    return parseGitStatusPorcelain(String(stdout));
  } catch {
    return null;
  }
}

function normalizeRefreshMs(refreshMs: number | undefined): number {
  if (refreshMs === undefined) return 2_000;
  if (!Number.isFinite(refreshMs)) return 2_000;
  return Math.min(60_000, Math.max(250, Math.round(refreshMs)));
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function workerStateColor(state: RunViewModelWorker["state"]): (s: string) => string {
  switch (state) {
    case "running": return style.purpleBold;
    case "done": return style.mint;
    case "failed": return style.red;
    case "blocked": return style.orange;
    case "skipped": return style.gray;
    default: return style.gray;
  }
}

function miniProgressBar(done: number, total: number, width = 8): string {
  if (total <= 0 || !Number.isFinite(total)) return style.gray("░".repeat(width));
  const safeDone = Number.isNaN(done) ? 0 : Math.min(Math.max(0, done), total);
  const filled = Math.round((safeDone / total) * width);
  const empty = Math.max(0, width - filled);
  return style.mint("█".repeat(filled)) + style.gray("░".repeat(empty));
}

function clearScreen(): void {
  // Clear screen + move cursor home, but PRESERVE scrollback so users can scroll up
  // to see previous code edits and output history.
  process.stdout.write("\x1b[2J\x1b[H");
}

// Core rendering

function getTerminalWidth(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.max(34, Math.min(60, requested));
  }
  const cols = process.stdout.columns;
  if (cols && cols >= 34) return Math.min(cols, 60);
  return 36;
}

export async function renderCockpit(options: CockpitRenderOptions = {}) {
  const width = getTerminalWidth(options.terminalWidth);
  const targetWidth = Math.max(34, Math.min(60, width));
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;
  let sessionMeta: SessionMeta | null = null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      const stats = await Promise.all(
        dirs.map(async (d) => {
          const statePath = join(runsDir, d.name, "state.json");
          const [hasState, s] = await Promise.all([
            pathExists(statePath),
            fsStat(join(runsDir, d.name)).catch(() => null),
          ]);
          if (!hasState) return null;
          return s ? { name: d.name, mtime: s.mtimeMs } : null;
        })
      );
      const best = stats
        .filter((s): s is { name: string; mtime: number } => s !== null)
        .sort((a, b) => b.mtime - a.mtime)[0];
      latestRunName = best?.name ?? null;
    }
    if (latestRunName) {
      const [stateContent, sessionMetaResult] = await Promise.all([
        readFile(join(runsDir, latestRunName, "state.json"), "utf-8").catch(() => null),
        readSessionMeta(latestRunName).catch(() => null),
      ]);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
      sessionMeta = sessionMetaResult;
    }
  }



  const lines: string[] = [];

  // Header
  lines.push(gradient("OMK Cockpit"));
  lines.push("");

  // Compact Kimi usage (moved to top)
  try {
    const usage = await getKimiUsage();
    const account = usage.oauth.loggedIn ? usage.oauth.displayId : "/login";
    const fiveHourPercent =
      usage.quota.fiveHour?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - usage.quota.fiveHour.remainingPercent))
        : null;
    const weeklyPercent =
      usage.quota.weekly?.remainingPercent != null
        ? Math.min(100, Math.max(0, 100 - usage.quota.weekly.remainingPercent))
        : null;
    const fiveHour =
      fiveHourPercent != null
        ? `${fiveHourPercent}%`
        : `${Math.round(usage.totalSecondsLast5Hours / 60)}m`;
    const weekly =
      weeklyPercent != null
        ? `${weeklyPercent}%`
        : `${Math.round(usage.totalSecondsWeek / 60)}m`;
    lines.push(`${style.gray("kimi")} ${account} 5h:${fiveHour} wk:${weekly}`);
    lines.push("");
  } catch (err) {
    if (process.env.OMK_DEBUG === "1") {
      console.error(`[OMK_DEBUG] usage error:`, err);
    }
    lines.push(`${style.gray("kimi")} ${style.gray("unavailable")} 5h:${style.gray("?")} wk:${style.gray("?")}`);
    lines.push("");
  }

  // Run ID
  const displayRunId = latestRunName ?? "--";
  lines.push(`${style.gray("run")} ${style.creamBold(truncateText(displayRunId, targetWidth - 6))}`);

  // Session type badge
  if (sessionMeta?.type === "chat") {
    lines.push(`${style.gray("type")} ${style.purpleBold("💬 Chat")}`);
  }

  // Run duration
  if (vm.startedAt) {
    const startedMs = Date.parse(vm.startedAt);
    if (!Number.isNaN(startedMs)) {
      const duration = formatElapsed(Date.now() - startedMs);
      lines.push(`${style.gray("duration")} ${style.gray(duration)}`);
    }
  }

  // Goal title + score
  if (vm.goalTitle) {
    const scoreBadge = vm.goalScore != null ? style.creamBold(` ${vm.goalScore}%`) : "";
    lines.push(`${style.gray("goal")} ${truncateText(vm.goalTitle, targetWidth - 8 - sanitizeTerminalText(scoreBadge).length)}${scoreBadge}`);
  }

  // Health
  const healthStr = vm.health.toUpperCase();
  lines.push(`${style.gray("health")} ${healthColor(vm.health)(healthStr)}`);

  // Next action
  if (vm.nextAction && vm.nextAction !== "Run complete" && vm.nextAction !== "Ready") {
    lines.push(`${style.gray("next")} ${style.cream(truncateText(vm.nextAction, targetWidth - 8))}`);
  }

  // Progress
  lines.push(
    `${style.gray("progress")} ${style.mintBold(`${vm.progress.settled}/${vm.progress.total}`)} ${style.gray(`settled, ${vm.progress.running} active`)}`
  );

  // System usage
  try {
    const sys = getSystemUsage();
    lines.push(
      `${style.gray("sys")} ${style.gray("cpu")}${style.mintBold(`${sys.cpuPercent}%`)} ${style.gray("mem")}${style.mintBold(`${sys.memPercent}%`)}`
    );
  } catch { /* ignore */ }

  // ETA
  if (vm.eta) {
    const confBadge = vm.etaConfidence ? style.gray(` (${vm.etaConfidence})`) : "";
    lines.push(`${style.gray("ETA")} ${style.cream(vm.eta)}${confBadge}`);
  }

  // Active node
  if (vm.activeNode) {
    const activeName = truncateText(vm.activeNode.name, targetWidth - 12);
    lines.push(`${style.gray("active")} ${style.purpleBold("▶")} ${activeName}`);
    if (vm.activeNode.thinking) {
      const thinking = truncateText(sanitizeTerminalText(vm.activeNode.thinking), targetWidth - 10);
      lines.push(`  ${style.gray("→")} ${thinking}`);
    }
  }

  // Iteration count (for iterative goals)
  if (vm.iterationCount != null && vm.maxIterations != null && vm.maxIterations > 0) {
    const iterText = `${vm.iterationCount}/${vm.maxIterations}`;
    lines.push(`${style.gray("iteration")} ${style.creamBold(iterText)}`);
  }

  // Last activity age
  if (vm.lastActivityAt) {
    const lastMs = Date.parse(vm.lastActivityAt);
    if (!Number.isNaN(lastMs)) {
      const age = formatElapsed(Date.now() - lastMs);
      lines.push(`${style.gray("updated")} ${style.gray(`${age} ago`)}`);
    }
  }

  // Blocker
  if (vm.blocker) {
    const blockerText = truncateText(
      `${vm.blocker.reason} (${vm.blocker.nodeId})`,
      targetWidth - 12
    );
    const retryInfo = !vm.blocker.recoverable
      ? style.red(" [max retries]")
      : vm.blocker.retryCount > 0
        ? style.orange(` [retry ${vm.blocker.retryCount}/${vm.blocker.maxRetries}]`)
        : "";
    lines.push(`${style.gray("blocker")} ${style.red("■")} ${blockerText}${retryInfo}`);
  }

  // Additional blockers (up to 3)
  if (vm.blockers && vm.blockers.length > 1) {
    const extras = vm.blockers.slice(1, 4);
    for (const b of extras) {
      const icon = b.status === "blocked" ? style.orange("■") : style.red("⚠");
      const text = truncateText(`${b.reason} (${b.nodeId})`, targetWidth - 14);
      const hint =
        b.status === "failed"
          ? `run: omk verify --run ${vm.runId ?? "<runId>"}`
          : "check dependency outputs";
      lines.push(`${style.gray("blocker")} ${icon} ${text}`);
      lines.push(`  ${style.gray("hint:")} ${style.cream(hint)}`);
    }
  }

  lines.push(separator(targetWidth));

  // ── Parallel Agents / Workers ──
  const todos = latestRunName
    ? ((await readTodos(latestRunName)) ?? (await deriveTodosFromState(latestRunName)))
    : null;
  const sortedNodes = [...(vm.workers ?? [])].sort((a, b) => {
    const rank = statusRank(a.state) - statusRank(b.state);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  if (todos && todos.length > 0) {
    const sortedTodos = [...todos].sort(
      (a, b) => statusRank(a.status) - statusRank(b.status)
    );
    const doneCount = sessionMeta?.todoDoneCount ?? sortedTodos.filter((t) => t.status === "done").length;
    const totalCount = sessionMeta?.todoCount ?? sortedTodos.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const chatPrefix = sessionMeta?.type === "chat" ? "💬 " : "";
    lines.push(
      `${style.pinkBold(`${chatPrefix}TODO`)} ${miniProgressBar(doneCount, totalCount)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${doneCount}/${totalCount})`)}`
    );

    for (const todo of sortedTodos.slice(0, 10)) {
      const marker = todoMarker(todo.status);
      const elapsed = todo.elapsedMs ? style.gray(formatElapsed(todo.elapsedMs)) : "";
      const agentBadge = todo.agent ? style.gray(`[${truncateText(todo.agent, 8)}]`) : "";
      const base = `${marker} ${agentBadge} ${truncateText(todo.title, targetWidth - 14)} ${elapsed}`.replace(/\s+/g, " ").trim();
      lines.push(`  ${base}`);

      if (todo.role || todo.description) {
        const meta = [todo.role ? `role:${todo.role}` : "", todo.description || ""].filter(Boolean).join(" | ");
        if (meta) lines.push(`    ${style.gray(truncateText(meta, targetWidth - 8))}`);
      }
      if ((todo.status === "failed" || todo.status === "blocked") && todo.evidence) {
        lines.push(`    ${style.red("→")} ${truncateText(todo.evidence, targetWidth - 8)}`);
      }
    }

    if (sortedTodos.length > 10) {
      lines.push(`  ${style.gray(`… ${sortedTodos.length - 10} more`)}`);
    }
  } else if (sortedNodes.length > 0) {
    // Summary bar
    const { done, total, running, failed, blocked, skipped, settled } = vm.progress;
    const pct = total > 0 ? Math.round((settled / total) * 100) : 0;
    lines.push(
      `${style.pinkBold("AGENTS")} ${miniProgressBar(settled, total)} ${style.creamBold(`${pct}%`)} ` +
        `${style.gray(`(${running}▶ ${done}✓ ${failed}✕ ${blocked}■ ${skipped}⊘ / ${total})`)}`
    );

    for (const node of sortedNodes.slice(0, 10)) {
      const stateLabel = workerStateColor(node.state)(node.state.toUpperCase());
      const elapsed = formatElapsed(node.elapsedMs);
      const base = `${stateLabel} ${style.gray(elapsed)} ${truncateText(node.label || node.id, targetWidth - 16)}`;

      if (node.state === "running") {
        lines.push(`  ${base}`);
        if (node.phase) {
          lines.push(`    ${style.gray("→")} ${truncateText(node.phase, targetWidth - 8)}`);
        } else if (node.currentNode) {
          lines.push(`    ${style.gray("→")} ${truncateText(node.currentNode, targetWidth - 8)}`);
        }
        if (node.lastActivityAgeMs != null && node.lastActivityAgeMs > 30_000) {
          const staleText = `stale ${formatElapsed(node.lastActivityAgeMs)}`;
          lines.push(`    ${style.orange("⚠")} ${style.orange(staleText)}`);
        }
      } else if ((node.state === "failed" || node.state === "blocked") && node.lastEvidence) {
        const evidence = truncateText(node.lastEvidence.message || node.lastEvidence.gate, targetWidth - 10);
        const retryBadge = node.retryCount > 0 ? style.orange(` [retry ${node.retryCount}]`) : "";
        lines.push(`  ${base}${retryBadge}`);
        lines.push(`    ${style.red("→")} ${evidence}`);
      } else {
        lines.push(`  ${base}`);
      }
    }

    if (sortedNodes.length > 10) {
      lines.push(`  ${style.gray(`… ${sortedNodes.length - 10} more agents`)}`);
    }
  } else {
    lines.push(style.gray("No parallel agents active — waiting for work"));
  }

  lines.push(separator(targetWidth));

  // Changed files — up to 8
  if (gitChanges.length > 0) {
    lines.push(style.pinkBold(`Changed (${gitChanges.length})`));
    for (const change of gitChanges.slice(0, 8)) {
      lines.push(`  ${gitMarker(change.status)} ${truncateText(change.path, targetWidth - 6)}`);
    }
    if (gitChanges.length > 8) {
      lines.push(`  ${style.gray(`… ${gitChanges.length - 8} more`)}`);
    }
  } else {
    lines.push(style.mint("✓ clean worktree"));
  }

  lines.push(separator(targetWidth));

  // Recent Runs (excluding current)
  try {
    if (await pathExists(runsDir)) {
      const candidates = await listRunCandidates(runsDir);
      const sorted = candidates
        .filter((c) => c.name !== latestRunName)
        .sort((a, b) => b.stateUpdatedAtMs - a.stateUpdatedAtMs)
        .slice(0, 5);
      if (sorted.length > 0) {
        lines.push(style.pinkBold("History"));
        const historyLines = await Promise.all(
          sorted.map(async (c) => {
            let st = style.gray("?");
            try {
              const raw = await readFile(join(runsDir, c.name, "state.json"), "utf-8");
              const parsed = parseRunStateResult(raw);
              if (parsed.state) {
                const stateVm = buildRunViewModel(parsed.state);
                if (stateVm.health === "ok" && stateVm.progress.settled === stateVm.progress.total && stateVm.progress.total > 0) {
                  st = style.mint("✓");
                } else if (stateVm.health === "failed") {
                  st = style.red("✕");
                } else if (stateVm.health === "blocked") {
                  st = style.orange("■");
                } else if (stateVm.progress.running > 0) {
                  st = style.purple("▶");
                } else {
                  st = style.gray("?");
                }
              }
            } catch { /* ignore */ }
            let goalTitle = "";
            try {
              const goalRaw = await readFile(join(runsDir, c.name, "goal.md"), "utf-8");
              const firstLine = goalRaw.split(/\r?\n/)[0]?.trim() ?? "";
              goalTitle = firstLine.replace(/^#+\s*/, "").slice(0, 24);
            } catch { /* ignore */ }
            const date = new Date(c.stateUpdatedAtMs);
            const dateStr = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
            const name = truncateText(c.name, targetWidth - 20);
            const titlePart = goalTitle ? style.gray(`  → ${goalTitle}`) : "";
            return `  ${st} ${name} ${style.gray(dateStr)}${titlePart}`;
          })
        );
        lines.push(...historyLines);
        lines.push(separator(targetWidth));
      }
    }
  } catch { /* ignore */ }

  // Verbose: routing inventory (skills + MCP)
  if (process.env.OMK_COCKPIT_VERBOSE === "1") {
    try {
      const inventory = discoverRoutingInventory(root);
      const skills = [...inventory.skills.keys()].slice(0, 8);
      const mcps = [...inventory.mcpServers.keys()].slice(0, 6);
      if (skills.length > 0) {
        lines.push(`${style.gray("skills")} ${style.cream(skills.join(", "))}`);
      }
      if (mcps.length > 0) {
        lines.push(`${style.gray("mcp")} ${style.cream(mcps.join(", "))}`);
      }
    } catch { /* ignore */ }
  }

  // State error recovery hint
  if (stateError !== "ok") {
    lines.push("");
    lines.push(`${style.orangeBold("⚠ state")} ${style.orange(stateError)}`);
    const isChatRun = (latestRunName ?? "").startsWith("chat-");
    const recovery =
      stateError === "missing"
        ? isChatRun
          ? `omk chat --run-id ${latestRunName ?? "<id>"}`
          : `omk run --run-id ${latestRunName ?? "<id>"}`
        : stateError === "corrupt"
          ? `omk run --run-id ${latestRunName ?? "<run-id>"}`
          : `omk verify --run ${latestRunName ?? "<run-id>"}`;
    lines.push(`${style.gray("hint:")} ${style.cream(recovery)}`);
  }

  const content = lines.map((l) => truncateLine(l, targetWidth));
  return panel(content);
}

export async function cockpitCommand(options: CockpitCommandOptions = {}): Promise<void> {
  const refreshMs = normalizeRefreshMs(options.refreshMs);

  if (!options.watch) {
    console.log(await renderCockpit({ runId: options.runId }));
    return;
  }

  let stopped = false;
  let resized = false;
  const stop = (): void => {
    stopped = true;
  };
  const onResize = (): void => {
    resized = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("SIGWINCH", onResize);

  let keyHandler: ((chunk: Buffer) => void) | undefined;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    keyHandler = (key: Buffer) => {
      const char = key.toString();
      if (char === "\u0003" || char === "q") {
        stopped = true;
      } else if (char === "r") {
        resized = true; // trigger immediate refresh
      }
    };
    process.stdin.on("data", keyHandler);
  }

  try {
    while (!stopped) {
      const frame = await renderCockpit({ runId: options.runId, terminalWidth: process.stdout.columns });
      clearScreen();
      process.stdout.write(frame + "\n");
      if (stopped) break;

      // Wait for refresh interval or resize event
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, refreshMs);
        const interval = setInterval(() => {
          if (stopped || resized) {
            clearTimeout(timer);
            clearInterval(interval);
            resized = false;
            resolve();
          }
        }, 100);
      });
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGWINCH", onResize);
    if (process.stdin.isTTY && keyHandler) {
      process.stdin.off("data", keyHandler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }

  process.stdout.write("\n");
}

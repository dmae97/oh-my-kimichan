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
} from "../util/run-view-model.js";
import {
  style,
  panel,
  gradient,
  separator,
  sanitizeTerminalText,
} from "../util/theme.js";
import { getKimiUsage } from "../util/kimi-usage.js";
import { parseGitStatusPorcelain } from "./hud.js";

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

function truncateLine(line: string, maxWidth: number): string {
  const clean = sanitizeTerminalText(line);
  if (clean.length <= maxWidth) return line;
  const visible = clean.slice(0, Math.max(1, maxWidth - 1));
  return visible + "…";
}

function truncateText(value: string, maxLength: number): string {
  const clean = sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= maxLength) return clean;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function statusRank(statusValue: string): number {
  switch (statusValue) {
    case "running": return 0;
    case "pending": return 1;
    case "blocked": return 2;
    case "failed": return 3;
    case "done": return 4;
    default: return 5;
  }
}

function todoMarker(statusValue: string): string {
  switch (statusValue) {
    case "running": return style.purpleBold("▶");
    case "done": return style.mintBold("✓");
    case "failed": return style.red("✕");
    case "blocked": return style.orange("■");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

// Core rendering

export async function renderCockpit(options: CockpitRenderOptions = {}): Promise<string> {
  // Fixed compact width so the panel stays square and never breaks in small tmux panes.
  const width = options.terminalWidth ?? 36;
  const targetWidth = Math.max(34, Math.min(40, width));
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      let best: { name: string; mtime: number } | null = null;
      for (const d of dirs) {
        const statePath = join(runsDir, d.name, "state.json");
        if (!(await pathExists(statePath))) continue;
        const s = await fsStat(join(runsDir, d.name)).catch(() => null);
        if (!s) continue;
        if (!best || s.mtimeMs > best.mtime) {
          best = { name: d.name, mtime: s.mtimeMs };
        }
      }
      latestRunName = best?.name ?? null;
    }
    if (latestRunName) {
      const stateContent = await readFile(
        join(runsDir, latestRunName, "state.json"),
        "utf-8"
      ).catch(() => null);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
    }
  }

  const lines: string[] = [];

  // Header
  lines.push(gradient("OMK Cockpit"));
  lines.push("");

  // Run ID
  const displayRunId = latestRunName ?? "--";
  lines.push(`${style.gray("run")} ${style.creamBold(truncateText(displayRunId, targetWidth - 6))}`);

  // Goal title
  if (vm.goalTitle) {
    lines.push(`${style.gray("goal")} ${truncateText(vm.goalTitle, targetWidth - 8)}`);
  }

  // Health
  const healthStr = vm.health.toUpperCase();
  lines.push(`${style.gray("health")} ${healthColor(vm.health)(healthStr)}`);

  // Progress
  lines.push(
    `${style.gray("progress")} ${style.mintBold(`${vm.progress.done}/${vm.progress.total}`)} ${style.gray(`done, ${vm.progress.running} active`)}`
  );

  // ETA
  if (vm.eta) {
    lines.push(`${style.gray("ETA")} ${style.cream(vm.eta)}`);
  }

  // Active node
  if (vm.activeNode) {
    const activeName = truncateText(vm.activeNode.name, targetWidth - 12);
    lines.push(`${style.gray("active")} ${style.purpleBold("▶")} ${activeName}`);
  }

  // Blocker
  if (vm.blocker) {
    const blockerText = truncateText(
      `${vm.blocker.reason} (${vm.blocker.nodeId})`,
      targetWidth - 12
    );
    lines.push(`${style.gray("blocker")} ${style.red("■")} ${blockerText}`);
  }

  lines.push(separator(targetWidth));

  // TODO list — up to 8 nodes sorted by status rank
  const sortedNodes = [...(vm.workers ?? [])].sort((a, b) => {
    const rank = statusRank(a.state) - statusRank(b.state);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  if (sortedNodes.length > 0) {
    lines.push(style.pinkBold("TODO"));
    for (const node of sortedNodes.slice(0, 8)) {
      const label = truncateText(node.label || node.id, targetWidth - 6);
      lines.push(`  ${todoMarker(node.state)} ${label}`);
    }
    if (sortedNodes.length > 8) {
      lines.push(`  ${style.gray(`… ${sortedNodes.length - 8} more`)}`);
    }
  } else {
    lines.push(style.gray("No active tasks"));
  }

  lines.push(separator(targetWidth));

  // Changed files — up to 8
  if (gitChanges.length > 0) {
    lines.push(style.pinkBold("Changed"));
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

  // Compact Kimi usage (optional)
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
  } catch {
    // omit on error to keep cockpit lightweight
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
          ? `omk summary-show ${latestRunName ?? "<run-id>"}`
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
  const stop = (): void => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopped) {
      const frame = await renderCockpit({ runId: options.runId });
      clearScreen();
      process.stdout.write(frame + "\n");
      if (stopped) break;
      await sleep(refreshMs);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }

  process.stdout.write("\n");
}

import { readdir, readFile, stat as fsStat } from "fs/promises";
import { join } from "path";
import { uptime } from "os";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { getOmkPath, pathExists, getProjectRoot } from "../util/fs.js";
import { getKimiUsage, formatDuration, type UsageStats } from "../util/kimi-usage.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { formatBytes } from "../util/output-buffer.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { t } from "../util/i18n.js";
import type { RunState } from "../contracts/orchestration.js";
import {
  style,
  status,
  bullet,
  panel,
  gauge,
  stat,
  sparkleHeader,
  gradient,
  getSystemUsage,
  separator,
  padEndAnsi,
  sanitizeTerminalText,
} from "../util/theme.js";

const execFileAsync = promisify(execFile);

export interface HudGitChange {
  status: string;
  path: string;
}

export interface HudRunCandidate {
  name: string;
  mtimeMs: number;
  hasState: boolean;
  hasGoal: boolean;
  hasPlan: boolean;
}

export interface HudRenderOptions {
  runId?: string;
  terminalWidth?: number;
  kimiUsage?: UsageStats;
  footerRefreshMs?: number;
}

export interface HudCommandOptions extends HudRenderOptions {
  watch?: boolean;
  refreshMs?: number;
  clear?: boolean;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function formatEtaMs(ms: number | undefined): string {
  if (ms === undefined) return "unknown";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function parseRunState(content: string): RunState | null {
  try {
    const value = JSON.parse(content) as Partial<RunState>;
    if (!value || typeof value !== "object" || typeof value.runId !== "string" || !Array.isArray(value.nodes)) {
      return null;
    }
    return value as RunState;
  } catch {
    return null;
  }
}

function getDiskUsage(): { used: number; total: number; percent: number } | null {
  try {
    const raw = execSync("df -k .", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const line = raw.trim().split("\n").pop();
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) return null;
    const total = parseInt(parts[1], 10) * 1024;
    const used = parseInt(parts[2], 10) * 1024;
    const percent = Math.round((used / total) * 100);
    return { used, total, percent };
  } catch {
    return null;
  }
}

export function parseGitStatusPorcelain(output: string): HudGitChange[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath;
      return {
        status: statusCode.trim() || statusCode,
        path: renamedPath.replace(/^"|"$/g, ""),
      };
    });
}

async function getGitChanges(root: string): Promise<HudGitChange[] | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: root,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
    });
    return parseGitStatusPorcelain(String(stdout));
  } catch {
    return null;
  }
}

function lineWidth(line: string): number {
  return sanitizeTerminalText(line).length;
}

function blockWidth(block: string): number {
  return Math.max(0, ...block.split("\n").map(lineWidth));
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

export function buildHudSidebar(
  state: RunState | null,
  changes: HudGitChange[],
  options: { maxTodos?: number; maxFiles?: number } = {}
): string {
  const maxTodos = options.maxTodos ?? 9;
  const maxFiles = options.maxFiles ?? 12;
  const lines: string[] = ["", `  ${style.pinkBold("Right Rail")}`];

  const nodes = [...(state?.nodes ?? [])].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  if (state) {
    const done = nodes.filter((node) => node.status === "done").length;
    const active = nodes.filter((node) => node.status === "running").length;
    lines.push(`  ${style.gray("run")} ${style.creamBold(truncateText(state.runId, 34))}`);
    lines.push(`  ${style.gray("progress")} ${style.mintBold(`${done}/${nodes.length}`)} ${style.gray(`done, ${active} active`)}`);
    lines.push("");
  }

  lines.push(`  ${style.pinkBold("TODO")}`);
  if (nodes.length === 0) {
    lines.push(`  ${style.gray(t("hud.noActiveRun"))}`);
    lines.push(`  ${style.gray(t("hud.runToSeeTodos"))}`);
  } else {
    for (const node of nodes.slice(0, maxTodos)) {
      const role = style.gray(`[${truncateText(node.role, 9)}]`);
      const name = truncateText(node.name || node.id, 30);
      lines.push(`  ${todoMarker(node.status)} ${role} ${name}`);
    }
    if (nodes.length > maxTodos) {
      lines.push(`  ${style.gray(`… ${nodes.length - maxTodos} more tasks`)}`);
    }
  }

  lines.push("", `  ${style.pinkBold("Changed Files")} ${style.gray(`(${changes.length})`)}`);
  if (changes.length === 0) {
    lines.push(`  ${style.mint("✓")} ${style.gray("clean worktree")}`);
  } else {
    for (const change of changes.slice(0, maxFiles)) {
      lines.push(`  ${gitMarker(change.status)} ${truncateText(change.path, 38)}`);
    }
    if (changes.length > maxFiles) {
      lines.push(`  ${style.gray(`… ${changes.length - maxFiles} more files`)}`);
    }
  }
  lines.push("");

  return panel(lines, gradient("TODO / Changed Files"));
}

export function renderHudColumns(mainPanels: string[], sidebar: string, terminalWidth = defaultHudTerminalWidth()): string {
  const left = mainPanels.join("\n\n");
  const leftLines = left.split("\n");
  const rightLines = sidebar.split("\n");
  const leftWidth = blockWidth(left);
  const rightWidth = blockWidth(sidebar);
  const gap = 3;

  if (terminalWidth < 100 || leftWidth + gap + rightWidth > terminalWidth) {
    return `${left}\n\n${sidebar}`;
  }

  const height = Math.max(leftLines.length, rightLines.length);
  const output: string[] = [];
  for (let i = 0; i < height; i += 1) {
    const leftLine = leftLines[i] ?? "";
    const rightLine = rightLines[i] ?? "";
    output.push(`${padEndAnsi(leftLine, leftWidth)}${" ".repeat(gap)}${rightLine}`.trimEnd());
  }
  return output.join("\n");
}

function defaultHudTerminalWidth(): number {
  const stdoutWidth = process.stdout.columns;
  if (typeof stdoutWidth === "number" && stdoutWidth > 0) return stdoutWidth;
  const envWidth = Number.parseInt(process.env.COLUMNS ?? "", 10);
  return Number.isFinite(envWidth) && envWidth > 0 ? envWidth : 120;
}

export function renderHudColumnsWithDetectedWidth(mainPanels: string[], sidebar: string): string {
  return renderHudColumns(mainPanels, sidebar, defaultHudTerminalWidth());
}

function normalizeRefreshMs(refreshMs: number | undefined): number {
  if (refreshMs === undefined) return 2_000;
  if (!Number.isFinite(refreshMs)) return 2_000;
  return Math.min(60_000, Math.max(250, Math.round(refreshMs)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderFooter(refreshMs?: number): string {
  const footerLines = [
    separator(50),
    style.mint(t("hud.hint")) + "  " + style.gray("omk chat") + " " + t("hud.interactive") + "  |  " + style.gray("omk plan") + " " + t("hud.plan") + "  |  " + style.gray("omk run") + " " + t("hud.execute") + "  |  " + style.gray("omk merge") + " " + t("hud.merge"),
  ];
  if (refreshMs) {
    footerLines.push(style.gray(t("hud.liveRefresh", refreshMs)));
  }
  footerLines.push(style.gray("  " + formatOmkVersionFooter()), separator(50));
  return footerLines.join("\n");
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function runCandidateScore(candidate: HudRunCandidate): number {
  let score = 0;
  if (candidate.hasState) score += 4;
  if (candidate.hasGoal) score += 2;
  if (candidate.hasPlan) score += 1;
  if (candidate.name === "latest") score -= 8;
  return score;
}

export function selectLatestRunName(candidates: HudRunCandidate[]): string | null {
  const valid = candidates.filter((candidate) => candidate.hasState || candidate.hasGoal || candidate.hasPlan);
  if (valid.length === 0) return null;

  return [...valid]
    .sort((a, b) => {
      const score = runCandidateScore(b) - runCandidateScore(a);
      if (score !== 0) return score;
      const mtime = b.mtimeMs - a.mtimeMs;
      if (mtime !== 0) return mtime;
      return b.name.localeCompare(a.name);
    })[0].name;
}

async function listRunCandidates(runsDir: string): Promise<HudRunCandidate[]> {
  const entries = await readdir(runsDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  return Promise.all(dirs.map(async (entry) => {
    const runDir = join(runsDir, entry.name);
    const info = await fsStat(runDir).catch(() => null);
    const [hasState, hasGoal, hasPlan] = await Promise.all([
      pathExists(join(runDir, "state.json")),
      pathExists(join(runDir, "goal.md")),
      pathExists(join(runDir, "plan.md")),
    ]);
    return {
      name: entry.name,
      mtimeMs: info?.mtimeMs ?? 0,
      hasState,
      hasGoal,
      hasPlan,
    };
  }));
}

export async function renderHudDashboard(options: HudRenderOptions = {}): Promise<string> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const kimiUsagePromise = options.kimiUsage ? Promise.resolve(options.kimiUsage) : getKimiUsage();
  const gitChangesPromise = getGitChanges(root);
  const mainPanels: string[] = [];
  const output: string[] = [];

  // ── Top banner ───────────────────────────────────────────────
  output.push(sparkleHeader("oh-my-kimichan HUD"));

  // ── System Usage Panel ───────────────────────────────────────
  const usage = getSystemUsage();
  const disk = getDiskUsage();

  const sysLines: string[] = [
    "",
    gauge("CPU Load", usage.cpuPercent, 100, 20),
    gauge("Memory  ", usage.memPercent, 100, 20),
    disk ? gauge("Disk    ", disk.percent, 100, 20) : "",
    "",
    stat("Load Avg", usage.loadAvg.map((v) => v.toFixed(2)).join(", "), ""),
    stat("Memory", `${usage.memUsedGB} / ${usage.memTotalGB}`, " GB"),
    stat("OMK Profile", `${resources.profile} (${resources.mcpScope} MCP, ${resources.skillsScope} skills)`, ""),
    stat("OMK Buffer", formatBytes(resources.shellMaxBufferBytes), ""),
    disk ? stat("Disk", `${(disk.used / 1024 / 1024 / 1024).toFixed(1)} / ${(disk.total / 1024 / 1024 / 1024).toFixed(1)}`, " GB") : "",
    stat("Uptime", formatUptime(Math.floor(uptime())), ""),
    "",
  ].filter(Boolean);

  mainPanels.push(panel(sysLines, gradient("System Usage")));

  // ── Coding Plan Usage ────────────────────────────────────────
  const kimiUsage = await kimiUsagePromise;
  const LIMIT_HOURS = 5;
  const limitSeconds = LIMIT_HOURS * 3600;
  const rollingPercent = kimiUsage.quota.fiveHour
    ? Math.min(100, 100 - kimiUsage.quota.fiveHour.remainingPercent)
    : Math.min(100, Math.round((kimiUsage.totalSecondsLast5Hours / limitSeconds) * 100));
  const weekPercent = kimiUsage.quota.weekly
    ? Math.min(100, 100 - kimiUsage.quota.weekly.remainingPercent)
    : Math.min(100, Math.round((kimiUsage.totalSecondsWeek / (limitSeconds * 7)) * 100));

  const planLines: string[] = [
    "",
    gauge("5h Window", rollingPercent, 100, 20),
    gauge("This Week", weekPercent, 100, 20),
    "",
    stat("OAuth Login", `${kimiUsage.oauth.displayId} (${kimiUsage.oauth.tokenStatus})`, ""),
    stat("5h Usage", kimiUsage.quota.fiveHour ? `${kimiUsage.quota.fiveHour.remainingPercent}% left` : formatDuration(kimiUsage.totalSecondsLast5Hours), ""),
    stat("5h Sessions", `${kimiUsage.sessionCountLast5Hours}`, ""),
    stat("Today Used", formatDuration(kimiUsage.totalSecondsToday), ""),
    stat("Today Sessions", `${kimiUsage.sessionCountToday}`, ""),
    stat("Week Usage", kimiUsage.quota.weekly ? `${kimiUsage.quota.weekly.remainingPercent}% left` : formatDuration(kimiUsage.totalSecondsWeek), ""),
    stat("Week Sessions", `${kimiUsage.sessionCountWeek}`, ""),
    kimiUsage.quota.error ? stat("Quota Source", `local fallback (${kimiUsage.quota.error})`, "") : "",
    "",
  ].filter(Boolean);

  mainPanels.push(panel(planLines, gradient("Kimi Usage")));

  // ── Project Status ───────────────────────────────────────────
  const projLines: string[] = [""];
  const gitChangesResult = await gitChangesPromise;
  const gitChanges = gitChangesResult ?? [];
  projLines.push(
    `  ${style.purple("🌿 Git")}      ${gitChangesResult === null ? status.warn("unavailable") : gitChanges.length === 0 ? status.ok("clean") : status.warn(`${gitChanges.length} changes`)}`
  );

  const omkExists = await pathExists(join(root, ".omk"));
  projLines.push(`  ${style.purple("📁 OMK")}      ${omkExists ? status.ok("initialized") : status.warn("omk init needed")}`);

  const agentsMdExists = await pathExists(join(root, "AGENTS.md"));
  projLines.push(`  ${style.purple("📝 AGENTS")}   ${agentsMdExists ? status.ok("exists") : status.warn("missing")}`);

  const designMdExists = await pathExists(join(root, "DESIGN.md"));
  projLines.push(`  ${style.purple("🎨 DESIGN")}   ${designMdExists ? status.ok("exists") : status.info("optional")}`);

  projLines.push("");
  mainPanels.push(panel(projLines, gradient("Project Status")));

  // ── Latest Run ───────────────────────────────────────────────
  const runsDir = getOmkPath("runs");
  let runLines: string[] = [];
  let latestState: RunState | null = null;

  if (await pathExists(runsDir)) {
    let latestRunName: string | null = options?.runId ?? null;

    if (!latestRunName) {
      const runCandidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(runCandidates);
    }

    if (latestRunName) {
      const runDir = join(runsDir, latestRunName);

      const goal = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => "N/A");
      const plan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => "N/A");
      const state = await readFile(join(runDir, "state.json"), "utf-8")
        .then(parseRunState)
        .catch(() => null);
      latestState = state;
      const goalLine = goal.replace(/# Goal\n\n?/, "").split("\n")[0].trim();

      runLines = [
        "",
        `  ${style.gray("Run ID:")}   ${style.creamBold(latestRunName)}`,
        `  ${style.gray("Goal:")}     ${style.cream(goalLine)}`,
        `  ${style.gray("Plan:")}     ${plan !== "N/A" ? style.mint("✔ generated") : style.gray("none")}`,
        "",
      ];

      if (state?.estimate) {
        runLines.push(
          `  ${style.pinkBold("ETA:")}      ${style.cream(formatEtaMs(state.estimate.estimatedRemainingMs))} ${style.gray(`(${state.estimate.confidence} confidence)`)}`,
          `  ${style.gray("Progress:")} ${style.mintBold(`${state.estimate.completedNodes}/${state.estimate.totalNodes}`)} ${style.gray(`${state.estimate.percentComplete}%`)}`,
          state.estimate.estimatedCompletedAt
            ? `  ${style.gray("Done by:")}  ${style.cream(new Date(state.estimate.estimatedCompletedAt).toLocaleString())}`
            : "",
          "",
        );
      }

      // Workers
      const worktreesDir = getOmkPath(`worktrees/${latestRunName}`);
      if (await pathExists(worktreesDir)) {
        const workers = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
          e.filter((d) => d.isDirectory()).map((d) => d.name)
        );
        if (workers.length > 0) {
          runLines.push(`  ${style.pinkBold("Workers:")}`);
          for (const w of workers) {
            runLines.push(bullet(w, "mint"));
          }
          runLines.push("");
        }
      }
    }
  }

  if (runLines.length === 0) {
    runLines = ["", `  ${style.gray(t("hud.noRunHistory"))}`, ""];
  }

  mainPanels.push(panel(runLines, gradient("Latest Run")));
  output.push(renderHudColumns(mainPanels, buildHudSidebar(latestState, gitChanges), options.terminalWidth ?? defaultHudTerminalWidth()));
  output.push("");

  // ── Tips ─────────────────────────────────────────────────────
  output.push(renderFooter(options.footerRefreshMs));
  output.push("");
  return output.join("\n");
}

export async function hudCommand(options: HudCommandOptions = {}): Promise<void> {
  const refreshMs = normalizeRefreshMs(options.refreshMs);

  if (!options.watch) {
    console.log(await renderHudDashboard(options));
    return;
  }

  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let cachedUsage: UsageStats | undefined;
  let lastUsageRefreshMs = 0;
  const usageRefreshMs = Math.max(60_000, refreshMs);

  try {
    while (!stopped) {
      const now = Date.now();
      if (!cachedUsage || now - lastUsageRefreshMs >= usageRefreshMs) {
        cachedUsage = await getKimiUsage();
        lastUsageRefreshMs = now;
      }
      const frame = await renderHudDashboard({ ...options, kimiUsage: cachedUsage, footerRefreshMs: refreshMs });
      if (options.clear ?? true) clearScreen();
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

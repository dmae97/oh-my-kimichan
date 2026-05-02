import { readdir, readFile, stat as fsStat } from "fs/promises";
import { join } from "path";
import { uptime } from "os";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { getOmkPath, pathExists, getProjectRoot } from "../util/fs.js";
import { getKimiUsage, type UsageStats } from "../util/kimi-usage.js";
import { buildUsageViewModel } from "../util/usage-view-model.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { formatBytes } from "../util/output-buffer.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { t } from "../util/i18n.js";
import type { RunState } from "../contracts/orchestration.js";
import type { GoalSpec, GoalEvidence } from "../contracts/goal.js";
import {
  parseRunStateResult,
  buildRunViewModel,
  renderRunSummary,
  type RunViewModel,
  type RunHealth,
} from "../util/run-view-model.js";
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
  schemaVersion?: number;
}

export type HudSection = "run" | "project" | "resources";

export interface HudRenderOptions {
  runId?: string;
  terminalWidth?: number;
  kimiUsage?: UsageStats;
  footerRefreshMs?: number;
  compact?: boolean;
  section?: HudSection;
}

export interface HudCommandOptions extends HudRenderOptions {
  watch?: boolean;
  refreshMs?: number;
  clear?: boolean;
  noClear?: boolean;
  alternateScreen?: boolean;
}

interface GoalData {
  title: string;
  status?: string;
  requiredTotal: number;
  requiredPassed: number;
  firstUnmet?: { id: string; description: string };
  latestEvidenceAt?: string;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
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

function truncateLine(line: string, maxWidth: number): string {
  const clean = sanitizeTerminalText(line);
  if (clean.length <= maxWidth) return line;
  const visible = clean.slice(0, Math.max(1, maxWidth - 1));
  return visible + "…";
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

function stateErrorRecovery(error: RunViewModel["stateError"], runId: string | null): string {
  switch (error) {
    case "corrupt": return `omk summary-show ${runId ?? "<run-id>"}`;
    case "missing": return `omk run --run-id ${runId ?? "<id>"}`;
    case "invalid":
    case "oldSchema":
      return `omk verify --run ${runId ?? "<run-id>"}`;
    default:
      return "";
  }
}

async function loadGoalData(goalId: string): Promise<GoalData | null> {
  const goalsBase = getOmkPath("goals");
  const goalPath = join(goalsBase, goalId, "goal.json");
  const evidencePath = join(goalsBase, goalId, "evidence.json");

  try {
    const goalContent = await readFile(goalPath, "utf-8");
    const goal = JSON.parse(goalContent) as Partial<GoalSpec>;
    if (!goal || typeof goal !== "object" || !goal.title) return null;

    let evidence: GoalEvidence[] = [];
    try {
      const evContent = await readFile(evidencePath, "utf-8");
      evidence = JSON.parse(evContent) as GoalEvidence[];
    } catch {
      // no evidence file
    }

    const criteria = (goal.successCriteria ?? []).filter((c) => c.requirement === "required");
    const requiredTotal = criteria.length;
    const requiredPassed = criteria.filter((c) =>
      evidence.some((e) => e.criterionId === c.id && e.passed)
    ).length;

    const firstUnmet = criteria.find((c) =>
      !evidence.some((e) => e.criterionId === c.id && e.passed)
    );

    const latestEvidenceAt = evidence.length > 0
      ? evidence.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0].checkedAt
      : undefined;

    return {
      title: goal.title,
      status: goal.status,
      requiredTotal,
      requiredPassed,
      firstUnmet: firstUnmet ? { id: firstUnmet.id, description: firstUnmet.description } : undefined,
      latestEvidenceAt,
    };
  } catch {
    return null;
  }
}

function buildSummaryBar(
  vm: RunViewModel,
  stateError: RunViewModel["stateError"],
  _goalTitle: string | null,
  width: number
): string {
  if (stateError !== "ok") {
    const warning = `⚠ Latest Run state is ${stateError}. Run: ${stateErrorRecovery(stateError, vm.runId)}`;
    return truncateLine(warning, width);
  }

  const summary = renderRunSummary(vm);
  return truncateLine(summary, width);
}

function buildStateErrorPanel(
  stateError: RunViewModel["stateError"],
  runId: string | null
): string {
  const recovery = stateErrorRecovery(stateError, runId);
  const lines = [
    "",
    `  ${style.orangeBold("⚠ State:")} ${style.orange(stateError)}`,
    `  ${style.gray("Suggested recovery:")}`,
    recovery ? `    ${style.cream(recovery)}` : "",
    "",
  ].filter(Boolean);
  return panel(lines, gradient("Run State Warning"));
}

export function buildHudSidebar(
  state: RunState | null,
  changes: HudGitChange[],
  options: { maxTodos?: number; maxFiles?: number; viewModel?: RunViewModel; maxWidth?: number } = {}
): string {
  const maxTodos = options.maxTodos ?? 9;
  const maxFiles = options.maxFiles ?? 12;
  const lines: string[] = ["", `  ${style.pinkBold("Right Rail")}`];

  const vm = options.viewModel ?? (state ? buildRunViewModel(state) : null);

  const nodes = [...(state?.nodes ?? [])].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });

  if (vm) {
    lines.push(`  ${style.gray("run")} ${style.creamBold(truncateText(vm.runId ?? "--", 34))}`);
    lines.push(`  ${style.gray("progress")} ${style.mintBold(`${vm.progress.done}/${vm.progress.total}`)} ${style.gray(`done, ${vm.progress.running} active`)}`);
    if (vm.health !== "ok") {
      lines.push(`  ${style.gray("health")} ${healthColor(vm.health)(vm.health.toUpperCase())}`);
    }
    lines.push("");
  } else if (state) {
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

  const contentLines = options.maxWidth
    ? lines.map((l) => truncateLine(l, Math.max(1, options.maxWidth! - 4)))
    : lines;

  return panel(contentLines, gradient("TODO / Changed Files"));
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

function enterAlternateScreen(): void {
  process.stdout.write("\x1b[?1049h");
}

function leaveAlternateScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

function runCandidateScore(candidate: HudRunCandidate): number {
  let score = 0;
  if (candidate.schemaVersion === 1) score += 1;
  if (candidate.name === "latest") score -= 8;
  return score;
}

export function selectLatestRunName(candidates: HudRunCandidate[]): string | null {
  const valid = candidates.filter((candidate) => candidate.hasState || candidate.hasGoal || candidate.hasPlan);
  if (valid.length === 0) return null;

  return [...valid]
    .sort((a, b) => {
      const mtime = b.mtimeMs - a.mtimeMs;
      if (mtime !== 0) return mtime;
      const score = runCandidateScore(b) - runCandidateScore(a);
      if (score !== 0) return score;
      return b.name.localeCompare(a.name);
    })[0].name;
}

export async function listRunCandidates(runsDir: string): Promise<HudRunCandidate[]> {
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
    let schemaVersion: number | undefined;
    if (hasState) {
      try {
        const stateContent = await readFile(join(runDir, "state.json"), "utf-8");
        const parsed = JSON.parse(stateContent) as { schemaVersion?: number };
        if (parsed && typeof parsed === "object" && typeof parsed.schemaVersion === "number") {
          schemaVersion = parsed.schemaVersion;
        }
      } catch {
        // ignore parse errors
      }
    }
    return {
      name: entry.name,
      mtimeMs: info?.mtimeMs ?? 0,
      hasState,
      hasGoal,
      hasPlan,
      schemaVersion,
    };
  }));
}

async function buildSystemPanel(): Promise<string> {
  const usage = getSystemUsage();
  const disk = getDiskUsage();
  const resources = await getOmkResourceSettings();

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

  return panel(sysLines, gradient("System Usage"));
}

async function buildKimiUsagePanel(kimiUsage?: UsageStats): Promise<string> {
  const usage = kimiUsage ?? await getKimiUsage();
  const LIMIT_HOURS = 5;
  const limitSeconds = LIMIT_HOURS * 3600;
  const vm = buildUsageViewModel(usage);

  const fiveHourGaugePercent = vm.fiveHour.percent ??
    Math.min(100, Math.round((usage.totalSecondsLast5Hours / limitSeconds) * 100));
  const weekGaugePercent = vm.weekly.percent ??
    Math.min(100, Math.round((usage.totalSecondsWeek / (limitSeconds * 7)) * 100));

  const loginLine = vm.source === "missingAuth"
    ? stat("OAuth Login", "login required; showing local sessions only", "")
    : stat("OAuth Login", `${vm.accountLabel} (${vm.authStatus})`, "");

  const planLines: string[] = [
    "",
    gauge("5h Window", fiveHourGaugePercent, 100, 20),
    gauge("This Week", weekGaugePercent, 100, 20),
    "",
    loginLine,
    stat("5h Usage", vm.fiveHour.label, ""),
    stat("5h Sessions", `${usage.sessionCountLast5Hours}`, ""),
    stat("Today Used", vm.today.label, ""),
    stat("Today Sessions", `${vm.today.sessionCount}`, ""),
    stat("Week Usage", vm.weekly.label, ""),
    stat("Week Sessions", `${usage.sessionCountWeek}`, ""),
    vm.error ? stat("Quota Source", `local fallback (${vm.error})`, "") : "",
    "",
  ].filter(Boolean);

  return panel(planLines, gradient("Kimi Usage"));
}

async function buildProjectStatusPanel(gitChangesResult: HudGitChange[] | null): Promise<string> {
  const root = getProjectRoot();
  const gitChanges = gitChangesResult ?? [];
  const projLines: string[] = [""];

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
  return panel(projLines, gradient("Project Status"));
}

async function buildLatestRunPanel(
  options: HudRenderOptions,
  vm: RunViewModel,
  stateError: RunViewModel["stateError"],
  _gitChanges: HudGitChange[],
  maxWidth?: number
): Promise<string> {
  const runsDir = getOmkPath("runs");
  let runLines: string[] = [];

  if (await pathExists(runsDir)) {
    let latestRunName: string | null = options?.runId ?? null;

    if (!latestRunName) {
      const runCandidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(runCandidates);
    }

    if (latestRunName) {
      const runDir = join(runsDir, latestRunName);

      let goalTitle: string | null = null;
      let goalData: GoalData | null = null;

      if (vm.runId && stateError === "ok") {
        try {
          const stateContent = await readFile(join(runDir, "state.json"), "utf-8");
          const { state } = parseRunStateResult(stateContent);
          if (state?.goalId) {
            goalData = await loadGoalData(state.goalId);
            if (goalData) goalTitle = goalData.title;
          }
          if (!goalData && state?.goalSnapshot?.title) {
            goalTitle = state.goalSnapshot.title;
          }
        } catch {
          // ignore
        }
      }

      const goalMd = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => null);
      const plan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => null);

      if (!goalTitle && goalMd) {
        goalTitle = goalMd.replace(/# Goal\n\n?/, "").split("\n")[0].trim();
      }
      if (!goalTitle) goalTitle = "N/A";

      runLines = [
        "",
        `  ${style.gray("Run ID:")}   ${style.creamBold(latestRunName)}`,
        `  ${style.gray("Goal:")}     ${style.cream(goalTitle)}`,
        `  ${style.gray("Plan:")}     ${plan ? style.mint("✔ generated") : style.gray("none")}`,
        "",
      ];

      if (goalData) {
        if (goalData.status) {
          runLines.push(`  ${style.gray("Goal Status:")} ${style.creamBold(goalData.status)}`);
        }
        if (goalData.requiredTotal > 0) {
          runLines.push(`  ${style.gray("Criteria:")}   ${style.mintBold(`${goalData.requiredPassed}/${goalData.requiredTotal}`)} ${style.gray("required passed")}`);
        }
        if (goalData.firstUnmet) {
          runLines.push(`  ${style.gray("Next Up:")}    ${style.orange(truncateText(goalData.firstUnmet.description, 50))}`);
        }
        if (goalData.latestEvidenceAt) {
          runLines.push(`  ${style.gray("Evidence:")}   ${style.gray(new Date(goalData.latestEvidenceAt).toLocaleString())}`);
        }
        runLines.push("");
      } else if (vm.goalTitle) {
        runLines.push(`  ${style.gray("Goal:")}     ${style.cream(vm.goalTitle ?? "N/A")}`);
        if (vm.goalScore != null) {
          runLines.push(`  ${style.gray("Score:")}     ${style.mintBold(`${vm.goalScore}%`)}`);
        }
        runLines.push("");
      }

      if (vm.eta || vm.progress.total > 0) {
        runLines.push(
          `  ${style.pinkBold("ETA:")}      ${style.cream(vm.eta ?? "--")}`,
          `  ${style.gray("Progress:")} ${style.mintBold(`${vm.progress.done}/${vm.progress.total}`)} ${style.gray(`${vm.progress.percent}%`)}`,
          "",
        );
      }

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

  if (maxWidth) {
    const contentMaxWidth = Math.max(1, maxWidth - 4);
    runLines = runLines.map((l) => truncateLine(l, contentMaxWidth));
  }

  return panel(runLines, gradient("Latest Run"));
}

async function renderCompactDashboard(options: HudRenderOptions): Promise<string> {
  const width = options.terminalWidth ?? defaultHudTerminalWidth();
  const effectiveWidth = Math.max(40, width - 4);
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const candidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(candidates);
    }
    if (latestRunName) {
      const stateContent = await readFile(join(runsDir, latestRunName, "state.json"), "utf-8").catch(() => null);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
    }
  }

  const goalTitle = vm.goalTitle ?? null;
  const output: string[] = [];

  output.push(sparkleHeader("oh-my-kimichan HUD"));

  const summary = buildSummaryBar(vm, stateError, goalTitle, effectiveWidth);
  output.push(summary);
  output.push("");

  const usage = getSystemUsage();
  output.push(`${style.gray("CPU:")}${usage.cpuPercent}% ${style.gray("MEM:")}${usage.memPercent}% ${style.gray("LOAD:")}${usage.loadAvg[0].toFixed(1)}`);
  output.push("");

  const runPanel = await buildLatestRunPanel(options, vm, stateError, gitChanges, effectiveWidth);
  output.push(runPanel);
  output.push("");

  if (stateError !== "ok" && latestRunName) {
    output.push(buildStateErrorPanel(stateError, latestRunName));
    output.push("");
  }

  const sidebar = buildHudSidebar(null, gitChanges, { viewModel: vm, maxWidth: effectiveWidth });
  output.push(sidebar);
  output.push("");

  output.push(renderFooter(options.footerRefreshMs));
  output.push("");
  return output.join("\n");
}

async function renderMediumDashboard(options: HudRenderOptions): Promise<string> {
  const width = options.terminalWidth ?? defaultHudTerminalWidth();
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];
  const mainPanels: string[] = [];
  const output: string[] = [];

  output.push(sparkleHeader("oh-my-kimichan HUD"));

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const candidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(candidates);
    }
    if (latestRunName) {
      const stateContent = await readFile(join(runsDir, latestRunName, "state.json"), "utf-8").catch(() => null);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
    }
  }

  const goalTitle = vm.goalTitle ?? null;
  const summary = buildSummaryBar(vm, stateError, goalTitle, width - 4);
  output.push(summary);
  output.push("");

  const projPanel = await buildProjectStatusPanel(gitChangesResult);
  mainPanels.push(projPanel);

  const runPanel = await buildLatestRunPanel(options, vm, stateError, gitChanges);
  mainPanels.push(runPanel);

  if (stateError !== "ok" && latestRunName) {
    mainPanels.push(buildStateErrorPanel(stateError, latestRunName));
  }

  const sidebar = buildHudSidebar(null, gitChanges, { viewModel: vm });
  output.push(renderHudColumns(mainPanels, sidebar, width));
  output.push("");

  output.push(renderFooter(options.footerRefreshMs));
  output.push("");
  return output.join("\n");
}

async function renderFullDashboard(options: HudRenderOptions): Promise<string> {
  const width = options.terminalWidth ?? defaultHudTerminalWidth();
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];
  const mainPanels: string[] = [];
  const output: string[] = [];

  output.push(sparkleHeader("oh-my-kimichan HUD"));

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const candidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(candidates);
    }
    if (latestRunName) {
      const stateContent = await readFile(join(runsDir, latestRunName, "state.json"), "utf-8").catch(() => null);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
    }
  }

  const goalTitle = vm.goalTitle ?? null;
  const summary = buildSummaryBar(vm, stateError, goalTitle, width - 4);
  output.push(summary);
  output.push("");

  mainPanels.push(await buildSystemPanel());
  mainPanels.push(await buildKimiUsagePanel(options.kimiUsage));
  mainPanels.push(await buildProjectStatusPanel(gitChangesResult));

  const runPanel = await buildLatestRunPanel(options, vm, stateError, gitChanges);
  mainPanels.push(runPanel);

  if (stateError !== "ok" && latestRunName) {
    mainPanels.push(buildStateErrorPanel(stateError, latestRunName));
  }

  const sidebar = buildHudSidebar(null, gitChanges, { viewModel: vm });
  output.push(renderHudColumns(mainPanels, sidebar, width));
  output.push("");

  output.push(renderFooter(options.footerRefreshMs));
  output.push("");
  return output.join("\n");
}

async function renderSectionDashboard(options: HudRenderOptions): Promise<string> {
  const width = options.terminalWidth ?? defaultHudTerminalWidth();
  const root = getProjectRoot();
  const gitChangesResult = await getGitChanges(root);
  const gitChanges = gitChangesResult ?? [];
  const output: string[] = [];

  output.push(sparkleHeader("oh-my-kimichan HUD"));

  const runsDir = getOmkPath("runs");
  let vm: RunViewModel = buildRunViewModel(null);
  let stateError: RunViewModel["stateError"] = "missing";
  let latestRunName: string | null = options.runId ?? null;

  if (await pathExists(runsDir)) {
    if (!latestRunName) {
      const candidates = await listRunCandidates(runsDir);
      latestRunName = selectLatestRunName(candidates);
    }
    if (latestRunName) {
      const stateContent = await readFile(join(runsDir, latestRunName, "state.json"), "utf-8").catch(() => null);
      if (stateContent) {
        const result = parseRunStateResult(stateContent);
        stateError = result.error;
        vm = buildRunViewModel(result.state, { changedFiles: gitChanges.map((c) => c.path) });
      }
    }
  }

  const goalTitle = vm.goalTitle ?? null;
  const summary = buildSummaryBar(vm, stateError, goalTitle, width - 4);
  output.push(summary);
  output.push("");

  switch (options.section) {
    case "run": {
      const runPanel = await buildLatestRunPanel(options, vm, stateError, gitChanges);
      output.push(runPanel);
      output.push("");
      if (stateError !== "ok" && latestRunName) {
        output.push(buildStateErrorPanel(stateError, latestRunName));
        output.push("");
      }
      const sidebar = buildHudSidebar(null, gitChanges, { viewModel: vm });
      output.push(sidebar);
      break;
    }
    case "project": {
      const projPanel = await buildProjectStatusPanel(gitChangesResult);
      output.push(projPanel);
      break;
    }
    case "resources": {
      output.push(await buildSystemPanel());
      output.push("");
      output.push(await buildKimiUsagePanel(options.kimiUsage));
      break;
    }
  }

  output.push("");
  output.push(renderFooter(options.footerRefreshMs));
  output.push("");
  return output.join("\n");
}

export async function renderHudDashboard(options: HudRenderOptions = {}): Promise<string> {
  const width = options.terminalWidth ?? defaultHudTerminalWidth();

  if (options.section) {
    return renderSectionDashboard(options);
  }

  if (options.compact || width < 90) {
    return renderCompactDashboard(options);
  }

  if (width < 120) {
    return renderMediumDashboard(options);
  }

  return renderFullDashboard(options);
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

  const useAlternateScreen = options.alternateScreen ?? false;
  const shouldClear = !(options.noClear ?? false) && (options.clear ?? true);

  if (useAlternateScreen) {
    enterAlternateScreen();
  }

  try {
    while (!stopped) {
      const now = Date.now();
      if (!cachedUsage || now - lastUsageRefreshMs >= usageRefreshMs) {
        cachedUsage = await getKimiUsage();
        lastUsageRefreshMs = now;
      }
      const frame = await renderHudDashboard({ ...options, kimiUsage: cachedUsage, footerRefreshMs: refreshMs });
      if (shouldClear) clearScreen();
      process.stdout.write(frame + "\n");
      if (stopped) break;
      await sleep(refreshMs);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (useAlternateScreen) {
      leaveAlternateScreen();
    }
  }

  process.stdout.write("\n");
}

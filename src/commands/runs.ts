import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists } from "../util/fs.js";
import { style, status, padEndAnsi, sanitizeTerminalText } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { listRunCandidates } from "./hud.js";

const ANSI_REGEX = /\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MIN_RUN_HISTORY_WIDTH = 20;
const DEFAULT_RUN_HISTORY_WIDTH = 80;

export interface NodeSummary {
  done: number;
  running: number;
  failed: number;
  pending: number;
  total: number;
}

export interface RunDetail {
  name: string;
  status: string;
  nodeSummary: NodeSummary;
  updatedAt: string;
  createdAt: string;
  elapsedMs: number;
  hasGoal: boolean;
  hasPlan: boolean;
  goalTitle?: string;
}

function visibleLength(value: string): number {
  return sanitizeTerminalText(value).length;
}

function getTerminalWidth(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_RUN_HISTORY_WIDTH, Math.floor(requested));
  }
  const stdoutColumns = process.stdout.columns;
  if (stdoutColumns && stdoutColumns > 0) {
    return Math.max(MIN_RUN_HISTORY_WIDTH, Math.floor(stdoutColumns));
  }
  const envColumns = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(envColumns) && envColumns > 0) {
    return Math.max(MIN_RUN_HISTORY_WIDTH, envColumns);
  }
  return DEFAULT_RUN_HISTORY_WIDTH;
}

function truncateLine(line: string, maxWidth: number): string {
  const clean = sanitizeTerminalText(line);
  if (clean.length <= maxWidth) return line;
  if (maxWidth <= 0) return "";
  if (maxWidth === 1) return style.gray("…");

  let visibleCount = 0;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_REGEX.lastIndex = 0;
  while ((match = ANSI_REGEX.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index);
    for (const char of textBefore) {
      if (visibleCount >= maxWidth - 1) return result + style.gray("…");
      result += char;
      visibleCount++;
    }
    result += match[0];
    lastIndex = ANSI_REGEX.lastIndex;
  }

  const remaining = line.slice(lastIndex);
  for (const char of remaining) {
    if (visibleCount >= maxWidth - 1) return result + style.gray("…");
    result += char;
    visibleCount++;
  }

  return result;
}

function truncateText(value: string, maxLength: number): string {
  const clean = sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
  if (maxLength <= 0) return "";
  const chars = [...clean];
  if (chars.length <= maxLength) return clean;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function fitLines(lines: string[], width: number): string[] {
  return lines.map((line) => truncateLine(line, width));
}

async function loadRunDetails(runDir: string): Promise<RunDetail | null> {
  const statePath = join(runDir, "state.json");
  if (!(await pathExists(statePath))) return null;
  let goalTitle: string | undefined;
  try {
    const goalRaw = await readFile(join(runDir, "goal.md"), "utf-8");
    const firstLine = goalRaw.split(/\r?\n/)[0]?.trim() ?? "";
    if (firstLine) goalTitle = firstLine.replace(/^#+\s*/, "").slice(0, 50);
  } catch { /* ignore */ }

  try {
    const raw = await readFile(statePath, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    const nodes = Array.isArray(state.nodes) ? (state.nodes as Record<string, unknown>[]) : [];
    const summary: NodeSummary = {
      done: 0, running: 0, failed: 0, pending: 0, total: nodes.length,
    };
    for (const n of nodes) {
      const st = String(n.status ?? "pending").toLowerCase();
      if (st === "done" || st === "completed") summary.done++;
      else if (st === "running" || st === "in_progress") summary.running++;
      else if (st === "failed") summary.failed++;
      else summary.pending++;
    }
    const updatedAtStr = String(state.updatedAt ?? "");
    const createdAtStr = String(state.createdAt ?? updatedAtStr);
    let elapsedMs = 0;
    const updatedMs = Date.parse(updatedAtStr);
    const createdMs = Date.parse(createdAtStr);
    if (!Number.isNaN(updatedMs) && !Number.isNaN(createdMs)) {
      elapsedMs = updatedMs - createdMs;
    }
    const [hasGoal, hasPlan] = await Promise.all([
      pathExists(join(runDir, "goal.md")),
      pathExists(join(runDir, "plan.md")),
    ]);
    return {
      name: runDir.split("/").pop() ?? runDir,
      status: String(state.status ?? "unknown"),
      nodeSummary: summary,
      updatedAt: updatedAtStr,
      createdAt: createdAtStr,
      elapsedMs,
      hasGoal,
      hasPlan,
      goalTitle,
    };
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return "—";
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function statusColor(s: string): string {
  switch (s) {
    case "done":
    case "completed":
      return style.mint(s);
    case "running":
    case "in_progress":
      return style.purple(s);
    case "failed":
      return style.red(s);
    case "cancelled":
      return style.orange(s);
    default:
      return style.gray(s);
  }
}

function miniProgressBar(done: number, total: number, width = 6): string {
  if (total <= 0 || !Number.isFinite(total)) return style.gray("░".repeat(width));
  const safeDone = Number.isNaN(done) ? 0 : Math.min(Math.max(0, done), total);
  const filled = Math.round((safeDone / total) * width);
  const empty = Math.max(0, width - filled);
  return style.mint("█".repeat(filled)) + style.gray("░".repeat(empty));
}

export interface RunsCommandOptions {
  limit?: number;
  json?: boolean;
  watch?: boolean;
  refreshMs?: number;
  terminalWidth?: number;
  statusFilter?: string;
  searchKeyword?: string;
  sinceMs?: number;
  untilMs?: number;
  stats?: boolean;
  exportPath?: string;
  insights?: boolean;
}

function progressParts(d: RunDetail): string[] {
  const parts: string[] = [];
  if (d.nodeSummary.done > 0) parts.push(style.mint(`${d.nodeSummary.done}✓`));
  if (d.nodeSummary.running > 0) parts.push(style.purple(`${d.nodeSummary.running}▶`));
  if (d.nodeSummary.failed > 0) parts.push(style.red(`${d.nodeSummary.failed}✕`));
  if (d.nodeSummary.pending > 0) parts.push(style.gray(`${d.nodeSummary.pending}○`));
  return parts;
}

function renderCompactRunLines(details: RunDetail[], width: number): string[] {
  const lines: string[] = [
    style.purpleBold(`📋 ${t("runs.header")}`),
    style.gray("─".repeat(width)),
  ];

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const num = String(i + 1).padStart(2, " ");
    const compactProgress = d.nodeSummary.total > 0
      ? style.gray(`${d.nodeSummary.done}/${d.nodeSummary.total}`)
      : style.gray("—");
    const meta = `${statusColor(d.status)} ${compactProgress} ${style.gray(formatElapsed(d.elapsedMs))}`;
    const nameBudget = Math.max(4, width - visibleLength(`${num}  ${meta}`) - 2);
    lines.push(`${num} ${style.cream(truncateText(d.name, nameBudget))} ${meta}`);

    const date = formatDate(d.updatedAt).replace(/^\d{4}-/, "");
    const titlePrefix = d.goalTitle ? `${style.gray(" →")} ` : "";
    const titleBudget = Math.max(0, width - visibleLength(`   ${date}${titlePrefix}`));
    const title = d.goalTitle ? style.gray(truncateText(d.goalTitle, titleBudget)) : "";
    lines.push(`   ${style.gray(date)}${titlePrefix}${title}`);
  }

  lines.push(style.gray("─".repeat(width)));
  lines.push(style.gray(t("runs.footerHint")));
  return fitLines(lines, width);
}

function renderTableRunLines(details: RunDetail[], width: number): string[] {
  const nameWidth = Math.max(12, Math.min(28, width - 56));
  const sep = style.gray("─".repeat(width));
  const colHeader = [
    style.gray("#"),
    padEndAnsi(style.gray("Run ID"), nameWidth),
    padEndAnsi(style.gray("Status"), 8),
    padEndAnsi(style.gray("Progress"), 18),
    padEndAnsi(style.gray("Elapsed"), 7),
    style.gray("Updated"),
  ].join(" ");
  const lines: string[] = [style.purpleBold(`📋 ${t("runs.header")}`), sep, colHeader, sep];

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const num = String(i + 1).padStart(2, " ");
    const name = padEndAnsi(truncateText(d.name, nameWidth), nameWidth);
    const statStr = padEndAnsi(statusColor(d.status), 8);
    const parts = progressParts(d);
    const progressText = parts.join(" ") || style.gray("—");
    const progress = d.nodeSummary.total > 0
      ? `${miniProgressBar(d.nodeSummary.done, d.nodeSummary.total)} ${progressText}`
      : style.gray("—");
    const progressStr = padEndAnsi(progress, 18);
    const elapsed = padEndAnsi(formatElapsed(d.elapsedMs), 7);
    const date = formatDate(d.updatedAt);
    const title = d.goalTitle ? style.gray(`  → ${truncateText(d.goalTitle, width - 6)}`) : "";
    lines.push(`${num} ${name} ${statStr} ${progressStr} ${elapsed} ${date}`);
    if (title) lines.push(title);
  }

  lines.push(sep);
  lines.push(style.gray(t("runs.footerHint")));
  return fitLines(lines, width);
}

export function renderRunsList(details: RunDetail[], options: { terminalWidth?: number } = {}): string {
  const width = getTerminalWidth(options.terminalWidth);
  const lines = width < 72
    ? renderCompactRunLines(details, width)
    : renderTableRunLines(details, width);
  return lines.join("\n");
}

export async function runsCommand(options: RunsCommandOptions = {}): Promise<void> {
  const runsDir = getOmkPath("runs");

  if (!(await pathExists(runsDir))) {
    if (options.json) {
      console.log(JSON.stringify([]));
      return;
    }
    console.log(status.warn(t("runs.noRunsDir")));
    return;
  }

  const doRender = async (): Promise<void> => {
    const candidates = await listRunCandidates(runsDir);
    if (candidates.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
        return;
      }
      console.log(t("runs.noRuns"));
      return;
    }

    let sorted = candidates
      .slice()
      .sort((a, b) => b.stateUpdatedAtMs - a.stateUpdatedAtMs);

    const limit = options.limit ?? 20;
    sorted = sorted.slice(0, limit);

    let details = (await Promise.all(
      sorted.map((c) => loadRunDetails(join(runsDir, c.name)))
    )).filter(Boolean) as RunDetail[];

    if (options.statusFilter) {
      const filter = options.statusFilter.toLowerCase();
      details = details.filter((d) => d.status.toLowerCase() === filter);
    }

    if (options.searchKeyword) {
      const kw = options.searchKeyword.toLowerCase();
      details = details.filter((d) =>
        d.name.toLowerCase().includes(kw) ||
        (d.goalTitle?.toLowerCase().includes(kw) ?? false)
      );
    }

    if (options.sinceMs != null) {
      details = details.filter((d) => Date.parse(d.updatedAt) >= options.sinceMs!);
    }
    if (options.untilMs != null) {
      details = details.filter((d) => Date.parse(d.updatedAt) <= options.untilMs!);
    }

    const terminalWidth = getTerminalWidth(options.terminalWidth);

    if (options.stats) {
      renderStats(details, candidates.length, terminalWidth);
      return;
    }

    if (options.exportPath) {
      await exportRunsToMarkdown(details, options.exportPath);
      return;
    }

    if (options.insights) {
      renderInsights(details, terminalWidth);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(details, null, 2));
      return;
    }

    console.log(renderRunsList(details, { terminalWidth }));
  };

  if (options.watch) {
    const refresh = options.refreshMs ?? 3000;
    while (true) {
      console.clear();
      await doRender();
      await new Promise((r) => setTimeout(r, refresh));
    }
  }

  await doRender();
}

function renderStats(details: RunDetail[], totalCandidates: number, terminalWidth?: number): void {
  const total = details.length;
  if (total === 0) {
    console.log(t("runs.noRuns"));
    return;
  }
  const width = getTerminalWidth(terminalWidth);

  const statusCounts: Record<string, number> = {};
  let totalElapsed = 0;
  let totalNodes = 0;
  let totalDone = 0;
  let totalRunning = 0;
  let totalFailed = 0;
  let totalPending = 0;
  let withGoal = 0;
  let withPlan = 0;
  let oldestMs = Infinity;
  let newestMs = -Infinity;

  for (const d of details) {
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    totalElapsed += d.elapsedMs;
    totalNodes += d.nodeSummary.total;
    totalDone += d.nodeSummary.done;
    totalRunning += d.nodeSummary.running;
    totalFailed += d.nodeSummary.failed;
    totalPending += d.nodeSummary.pending;
    if (d.hasGoal) withGoal++;
    if (d.hasPlan) withPlan++;
    const updated = Date.parse(d.updatedAt);
    if (!Number.isNaN(updated)) {
      if (updated < oldestMs) oldestMs = updated;
      if (updated > newestMs) newestMs = updated;
    }
  }

  const now = Date.now();
  const day7 = details.filter((d) => now - Date.parse(d.updatedAt) <= 7 * 24 * 60 * 60 * 1000).length;
  const day30 = details.filter((d) => now - Date.parse(d.updatedAt) <= 30 * 24 * 60 * 60 * 1000).length;

  const header = style.purpleBold(`📊 ${t("runs.statsHeader")}`);
  const sep = style.gray("─".repeat(width));
  const lines: string[] = [header, sep];

  lines.push(`${style.gray("Total runs")}      ${style.creamBold(String(total))} ${totalCandidates > total ? style.gray(`(filtered from ${totalCandidates})`) : ""}`);
  lines.push(`${style.gray("Avg duration")}    ${style.cream(formatElapsed(Math.round(totalElapsed / total)))}`);
  lines.push(`${style.gray("Total nodes")}     ${style.creamBold(String(totalNodes))} ${style.gray(`(${totalDone}✓ ${totalRunning}▶ ${totalFailed}✕ ${totalPending}○)`)}`);
  lines.push(`${style.gray("Last 7 days")}     ${style.cream(String(day7))}`);
  lines.push(`${style.gray("Last 30 days")}    ${style.cream(String(day30))}`);
  lines.push(`${style.gray("With goal")}       ${style.cream(`${withGoal}/${total}`)} ${style.gray(`(${Math.round((withGoal / total) * 100)}%)`)}`);
  lines.push(`${style.gray("With plan")}       ${style.cream(`${withPlan}/${total}`)} ${style.gray(`(${Math.round((withPlan / total) * 100)}%)`)}`);

  const statusEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  if (statusEntries.length > 0) {
    lines.push("");
    lines.push(style.gray("Status breakdown"));
    for (const [st, count] of statusEntries) {
      const pct = Math.round((count / total) * 100);
      const colored = statusColor(st);
      lines.push(`  ${colored} ${style.gray(`${count} (${pct}%)`)}`);
    }
  }

  if (oldestMs !== Infinity && newestMs !== -Infinity) {
    lines.push("");
    lines.push(`${style.gray("Oldest")}          ${style.gray(formatDate(new Date(oldestMs).toISOString()))}`);
    lines.push(`${style.gray("Newest")}          ${style.gray(formatDate(new Date(newestMs).toISOString()))}`);
  }

  lines.push(sep);
  console.log(fitLines(lines, width).join("\n"));
}

function renderInsights(details: RunDetail[], terminalWidth?: number): void {
  if (details.length === 0) {
    console.log(t("runs.noRuns"));
    return;
  }
  const width = getTerminalWidth(terminalWidth);

  const header = style.purpleBold(`🔍 ${t("runs.insightsHeader")}`);
  const sep = style.gray("─".repeat(width));
  const lines: string[] = [header, sep];

  // Parallel computation of independent insights
  const [
    longestRuns,
    mostComplexRuns,
    failureHotspots,
    weekdayActivity,
  ] = [
    computeLongestRuns(details),
    computeMostComplexRuns(details),
    computeFailureHotspots(details),
    computeWeekdayActivity(details),
  ];

  // Longest runs
  lines.push(style.pinkBold("Longest Runs"));
  for (const d of longestRuns.slice(0, 5)) {
    lines.push(`  ${style.gray("•")} ${style.cream(d.name)} ${style.gray(formatElapsed(d.elapsedMs))}`);
  }

  // Most complex runs
  lines.push("");
  lines.push(style.pinkBold("Most Complex Runs"));
  for (const d of mostComplexRuns.slice(0, 5)) {
    lines.push(`  ${style.gray("•")} ${style.cream(d.name)} ${style.gray(`${d.nodeSummary.total} nodes`)}`);
  }

  // Failure hotspots
  if (failureHotspots.length > 0) {
    lines.push("");
    lines.push(style.pinkBold("Failure Hotspots"));
    for (const d of failureHotspots.slice(0, 5)) {
      const rate = d.nodeSummary.total > 0 ? Math.round((d.nodeSummary.failed / d.nodeSummary.total) * 100) : 0;
      lines.push(`  ${style.red("✕")} ${style.cream(d.name)} ${style.red(`${rate}% failed`)} ${style.gray(`(${d.nodeSummary.failed}/${d.nodeSummary.total})`)}`);
    }
  }

  // Weekday activity
  lines.push("");
  lines.push(style.pinkBold("Weekday Activity (last 30 days)"));
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const maxCount = Math.max(1, ...weekdayActivity);
  for (let i = 0; i < 7; i++) {
    const count = weekdayActivity[i];
    const barWidth = 12;
    const filled = Math.round((count / maxCount) * barWidth);
    const bar = style.mint("█".repeat(filled)) + style.gray("░".repeat(barWidth - filled));
    lines.push(`  ${style.gray(dayNames[i])} ${bar} ${style.cream(String(count))}`);
  }

  lines.push(sep);
  console.log(fitLines(lines, width).join("\n"));
}

function computeLongestRuns(details: RunDetail[]): RunDetail[] {
  return [...details].sort((a, b) => b.elapsedMs - a.elapsedMs);
}

function computeMostComplexRuns(details: RunDetail[]): RunDetail[] {
  return [...details].sort((a, b) => b.nodeSummary.total - a.nodeSummary.total);
}

function computeFailureHotspots(details: RunDetail[]): RunDetail[] {
  return [...details]
    .filter((d) => d.nodeSummary.failed > 0)
    .sort((a, b) => {
      const rateA = a.nodeSummary.total > 0 ? a.nodeSummary.failed / a.nodeSummary.total : 0;
      const rateB = b.nodeSummary.total > 0 ? b.nodeSummary.failed / b.nodeSummary.total : 0;
      return rateB - rateA;
    });
}

function computeWeekdayActivity(details: RunDetail[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  for (const d of details) {
    const updated = Date.parse(d.updatedAt);
    if (Number.isNaN(updated)) continue;
    if (now - updated > thirtyDaysMs) continue;
    const day = new Date(updated).getDay();
    counts[day]++;
  }
  return counts;
}

async function exportRunsToMarkdown(details: RunDetail[], filePath: string): Promise<void> {
  const rows = details.map((d) => {
    const statusIcons: string[] = [];
    if (d.nodeSummary.done > 0) statusIcons.push(`${d.nodeSummary.done}✓`);
    if (d.nodeSummary.running > 0) statusIcons.push(`${d.nodeSummary.running}▶`);
    if (d.nodeSummary.failed > 0) statusIcons.push(`${d.nodeSummary.failed}✕`);
    if (d.nodeSummary.pending > 0) statusIcons.push(`${d.nodeSummary.pending}○`);
    return `| ${d.name} | ${d.status} | ${d.nodeSummary.done}/${d.nodeSummary.total} | ${formatElapsed(d.elapsedMs)} | ${formatDate(d.updatedAt)} | ${d.goalTitle ?? ""} |`;
  });

  const md = [
    "# OMK Run History",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Total runs: ${details.length}`,
    "",
    "| Run ID | Status | Progress | Elapsed | Updated | Goal |",
    "|--------|--------|----------|---------|---------|------|",
    ...rows,
    "",
  ].join("\n");

  await writeFile(filePath, md, "utf-8");
  console.log(status.ok(`Exported ${details.length} runs → ${filePath}`));
}

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists } from "../util/fs.js";
import { style, status, padEndAnsi } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { listRunCandidates } from "./hud.js";

interface NodeSummary {
  done: number;
  running: number;
  failed: number;
  pending: number;
  total: number;
}

interface RunDetail {
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
  statusFilter?: string;
  searchKeyword?: string;
  sinceMs?: number;
  untilMs?: number;
  stats?: boolean;
  exportPath?: string;
  insights?: boolean;
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

    if (options.stats) {
      renderStats(details, candidates.length);
      return;
    }

    if (options.exportPath) {
      await exportRunsToMarkdown(details, options.exportPath);
      return;
    }

    if (options.insights) {
      renderInsights(details);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(details, null, 2));
      return;
    }

    const header = style.purpleBold(`📋 ${t("runs.header")}`);
    const sep = style.gray("─────────────────────────────────────────────────────────────────");
    const colHeader = `${style.gray("#")}  ${style.gray("Run ID").padEnd(30)} ${style.gray("Status").padEnd(10)} ${style.gray("Progress").padEnd(10)} ${style.gray("Elapsed").padEnd(8)} ${style.gray("Updated")}`;

    const lines: string[] = [header, sep, colHeader, sep];

    for (let i = 0; i < details.length; i++) {
      const d = details[i];
      const num = String(i + 1).padStart(2, " ");
      const name = padEndAnsi(d.name.length > 28 ? d.name.slice(0, 25) + "…" : d.name, 28);
      const statStr = padEndAnsi(statusColor(d.status), 8);
      const progressParts: string[] = [];
      if (d.nodeSummary.done > 0) progressParts.push(style.mint(`${d.nodeSummary.done}✓`));
      if (d.nodeSummary.running > 0) progressParts.push(style.purple(`${d.nodeSummary.running}▶`));
      if (d.nodeSummary.failed > 0) progressParts.push(style.red(`${d.nodeSummary.failed}✕`));
      if (d.nodeSummary.pending > 0) progressParts.push(style.gray(`${d.nodeSummary.pending}○`));
      const progressText = progressParts.join(" ") || style.gray("—");
      const progress = d.nodeSummary.total > 0
        ? `${miniProgressBar(d.nodeSummary.done, d.nodeSummary.total)} ${progressText}`
        : style.gray("—");
      const progressStr = padEndAnsi(progress, 18);
      const elapsed = padEndAnsi(formatElapsed(d.elapsedMs), 7);
      const date = formatDate(d.updatedAt);
      const title = d.goalTitle ? style.gray(`  → ${d.goalTitle}`) : "";
      lines.push(`${num} ${name} ${statStr} ${progressStr} ${elapsed} ${date}`);
      if (title) lines.push(title);
    }

    lines.push(sep);
    lines.push(style.gray(t("runs.footerHint")));
    console.log(lines.join("\n"));
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

function renderStats(details: RunDetail[], totalCandidates: number): void {
  const total = details.length;
  if (total === 0) {
    console.log(t("runs.noRuns"));
    return;
  }

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
  const sep = style.gray("─────────────────────────────────────────────────────────────────");
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
  console.log(lines.join("\n"));
}

function renderInsights(details: RunDetail[]): void {
  if (details.length === 0) {
    console.log(t("runs.noRuns"));
    return;
  }

  const header = style.purpleBold(`🔍 ${t("runs.insightsHeader")}`);
  const sep = style.gray("─────────────────────────────────────────────────────────────────");
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
  console.log(lines.join("\n"));
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

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { uptime } from "os";
import { execSync } from "child_process";
import { getOmkPath, pathExists, getProjectRoot } from "../util/fs.js";
import { getGitStatus } from "../util/git.js";
import { getKimiUsage, formatDuration } from "../util/kimi-usage.js";
import {
  style,
  header,
  status,
  label,
  bullet,
  panel,
  gauge,
  stat,
  sparkleHeader,
  gradient,
  getSystemUsage,
  separator,
} from "../util/theme.js";

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

export async function hudCommand(): Promise<void> {
  const root = getProjectRoot();

  // ── Top banner ───────────────────────────────────────────────
  console.log(sparkleHeader("oh-my-kimichan HUD"));

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
    disk ? stat("Disk", `${(disk.used / 1024 / 1024 / 1024).toFixed(1)} / ${(disk.total / 1024 / 1024 / 1024).toFixed(1)}`, " GB") : "",
    stat("Uptime", formatUptime(Math.floor(uptime())), ""),
    "",
  ].filter(Boolean);

  console.log(panel(sysLines, gradient("System Usage")));
  console.log();

  // ── Coding Plan Usage ────────────────────────────────────────
  const kimiUsage = await getKimiUsage();
  const LIMIT_HOURS = 5;
  const limitSeconds = LIMIT_HOURS * 3600;
  const todayPercent = Math.min(100, Math.round((kimiUsage.totalSecondsToday / limitSeconds) * 100));
  const weekPercent = Math.min(100, Math.round((kimiUsage.totalSecondsWeek / (limitSeconds * 7)) * 100));

  const planLines: string[] = [
    "",
    gauge("Today    ", todayPercent, 100, 20),
    gauge("This Week", weekPercent, 100, 20),
    "",
    stat("Today Used", formatDuration(kimiUsage.totalSecondsToday), ""),
    stat("Today Sessions", `${kimiUsage.sessionCountToday}`, ""),
    stat("Week Used", formatDuration(kimiUsage.totalSecondsWeek), ""),
    stat("Week Sessions", `${kimiUsage.sessionCountWeek}`, ""),
    "",
  ];

  console.log(panel(planLines, gradient("Coding Plan")));
  console.log();

  // ── Project Status ───────────────────────────────────────────
  const projLines: string[] = [""];
  const gitStatus = await getGitStatus(root);
  projLines.push(
    `  ${style.purple("🌿 Git")}      ${gitStatus.clean ? status.ok("clean") : status.warn(`${gitStatus.changes} changes`)}`
  );

  const omkExists = await pathExists(".omk");
  projLines.push(`  ${style.purple("📁 OMK")}      ${omkExists ? status.ok("initialized") : status.warn("omk init needed")}`);

  const agentsMdExists = await pathExists(join(root, "AGENTS.md"));
  projLines.push(`  ${style.purple("📝 AGENTS")}   ${agentsMdExists ? status.ok("exists") : status.warn("missing")}`);

  const designMdExists = await pathExists(join(root, "DESIGN.md"));
  projLines.push(`  ${style.purple("🎨 DESIGN")}   ${designMdExists ? status.ok("exists") : status.info("optional")}`);

  projLines.push("");
  console.log(panel(projLines, gradient("Project Status")));
  console.log();

  // ── Latest Run ───────────────────────────────────────────────
  const runsDir = getOmkPath("runs");
  let runLines: string[] = [];

  if (await pathExists(runsDir)) {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = entries.filter((e) => e.isDirectory()).sort().reverse();

    if (runs.length > 0) {
      const latestRun = runs[0];
      const runDir = join(runsDir, latestRun.name);

      const goal = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => "N/A");
      const plan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => "N/A");
      const goalLine = goal.replace(/# Goal\n\n?/, "").split("\n")[0].trim();

      runLines = [
        "",
        `  ${style.gray("Run ID:")}   ${style.creamBold(latestRun.name)}`,
        `  ${style.gray("Goal:")}     ${style.cream(goalLine)}`,
        `  ${style.gray("Plan:")}     ${plan !== "N/A" ? style.mint("✔ generated") : style.gray("none")}`,
        "",
      ];

      // Workers
      const worktreesDir = getOmkPath(`worktrees/${latestRun.name}`);
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
    runLines = ["", `  ${style.gray("아직 실행 기록이 없습니다.")}`, ""];
  }

  console.log(panel(runLines, gradient("Latest Run")));
  console.log();

  // ── Tips ─────────────────────────────────────────────────────
  console.log(separator(50));
  console.log(style.mint("  💡 힌트:") + "  " + style.gray("omk chat") + " 대화형  |  " + style.gray("omk plan") + " 계획  |  " + style.gray("omk run") + " 실행  |  " + style.gray("omk merge") + " 병합");
  console.log(separator(50));
  console.log();
}

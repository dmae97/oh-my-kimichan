import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists } from "../util/fs.js";
import { getGitStatus } from "../util/git.js";

export async function hudCommand(): Promise<void> {
  console.log("📊 oh-my-kimichan HUD\n");

  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) {
    console.log("아직 실행 기록이 없습니다.");
    return;
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const runs = entries.filter((e) => e.isDirectory()).sort().reverse();

  if (runs.length === 0) {
    console.log("아직 실행 기록이 없습니다.");
    return;
  }

  const latestRun = runs[0];
  const runDir = join(runsDir, latestRun.name);

  const goal = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => "N/A");
  const plan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => "N/A");

  console.log(`Run: ${latestRun.name}`);
  console.log(`Goal: ${goal.replace(/# Goal\n\n?/, "").split("\n")[0]}`);
  console.log();

  const gitStatus = await getGitStatus();
  console.log(`Git Status: ${gitStatus.clean ? "clean" : `${gitStatus.changes} changes`}`);
  console.log();

  // List worktrees if any
  const worktreesDir = getOmkPath(`worktrees/${latestRun.name}`);
  if (await pathExists(worktreesDir)) {
    const workers = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
      e.filter((d) => d.isDirectory()).map((d) => d.name)
    );
    console.log("Workers:");
    for (const w of workers) {
      console.log(`  ${w}`);
    }
  }

  console.log();
  console.log("💡 힌트: omk chat으로 대화형 실행, omk merge로 결과 병합");
}

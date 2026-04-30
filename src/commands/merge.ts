import { readdir } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { getGitStatus } from "../util/git.js";
import { getCurrentBranch } from "../util/git.js";

export async function mergeCommand(options: { run?: string }): Promise<void> {
  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) {
    console.error("❌ 실행 기록이 없습니다.");
    process.exit(1);
  }

  let runId = options.run ?? "latest";
  if (runId === "latest") {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = entries.filter((e) => e.isDirectory()).sort().reverse();
    if (runs.length === 0) {
      console.error("❌ 실행 기록이 없습니다.");
      process.exit(1);
    }
    runId = runs[0].name;
  }

  const worktreesDir = getOmkPath(`worktrees/${runId}`);
  if (!(await pathExists(worktreesDir))) {
    console.log("ℹ️ 해당 run에 worktree가 없습니다. 단순 완료로 처리합니다.");
    return;
  }

  const workers = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
    e.filter((d) => d.isDirectory()).map((d) => d.name)
  );

  console.log(`🔀 Merge Run: ${runId}`);
  console.log(`   Workers: ${workers.join(", ")}\n`);

  const currentBranch = await getCurrentBranch();
  if (!currentBranch) {
    console.error("❌ Git 브랜치를 확인할 수 없습니다.");
    process.exit(1);
  }

  for (const w of workers) {
    const wtPath = join(worktreesDir, w);
    console.log(`   Merging ${w}...`);

    // Try cherry-pick or diff-based merge
    const diffResult = await runShell("git", ["-C", wtPath, "diff", currentBranch], { timeout: 15000 });
    if (diffResult.failed || !diffResult.stdout.trim()) {
      console.log(`     -> 변경사항 없음 또는 오류, 스킵`);
      continue;
    }

    // Apply diff
    const applyResult = await runShell("git", ["apply", "--check"], {
      cwd: process.cwd(),
      env: { GIT_DIFF: diffResult.stdout },
      timeout: 15000,
    });
    if (applyResult.failed) {
      console.log(`     -> 충돌 가능성, 수동 해결 필요`);
      continue;
    }

    // For MVP just show instructions
    console.log(`     -> diff ready. 수동 병합: git cherry-pick $(git -C ${wtPath} rev-parse HEAD)`);
  }

  console.log("\n✅ Merge 준비 완료. 위 안내에 따라 수동 병합하세요.");
}

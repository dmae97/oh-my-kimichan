import { readdir } from "fs/promises";
import { join } from "path";
import { getOmkPath, pathExists, getProjectRoot } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { getCurrentBranch } from "../util/git.js";
import { style, header, status, label } from "../util/theme.js";
import { t } from "../util/i18n.js";

export async function mergeCommand(options: { run?: string; runId?: string }): Promise<void> {
  const root = getProjectRoot();
  const runsDir = getOmkPath("runs");
  if (!(await pathExists(runsDir))) {
    console.error(status.error(t("merge.noRuns")));
    process.exit(1);
  }

  let runId = options.run ?? options.runId ?? "latest";
  if (runId === "latest") {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runs = entries.filter((e) => e.isDirectory()).sort().reverse();
    if (runs.length === 0) {
      console.error(status.error(t("merge.noRuns")));
      process.exit(1);
    }
    runId = runs[0].name;
  }

  const worktreesDir = getOmkPath(`worktrees/${runId}`);
  if (!(await pathExists(worktreesDir))) {
    console.log(status.info(t("merge.noWorktrees")));
    return;
  }

  const workers = await readdir(worktreesDir, { withFileTypes: true }).then((e) =>
    e.filter((d) => d.isDirectory()).map((d) => d.name)
  );

  console.log(header("Merge Run"));
  console.log(label("Run ID", runId));
  console.log(label("Workers", workers.join(", ")) + "\n");

  const currentBranch = await getCurrentBranch();
  if (!currentBranch) {
    console.error(status.error(t("merge.branchCheckFailed")));
    process.exit(1);
  }

  for (const w of workers) {
    const wtPath = join(worktreesDir, w);
    console.log(style.purpleBold(`  ▸ ${w}`));

    const diffResult = await runShell("git", ["-C", wtPath, "diff", currentBranch], { timeout: 15000 });
    if (diffResult.failed || !diffResult.stdout.trim()) {
      console.log(style.gray(t("merge.noChanges")));
      continue;
    }

    const applyResult = await runShell("git", ["apply", "--check"], {
      cwd: root,
      input: diffResult.stdout,
      timeout: 15000,
    });
    if (applyResult.failed) {
      console.log(style.orange(t("merge.conflictPossible")));
      continue;
    }

    console.log(style.mint(t("merge.diffReady")) + style.cream(`git cherry-pick $(git -C ${wtPath} rev-parse HEAD)`));
  }

  console.log("\n" + status.success(t("merge.ready")));
}

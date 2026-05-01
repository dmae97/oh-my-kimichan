import { join } from "path";
import { mkdir, readdir, access } from "fs/promises";
import { runShell } from "./shell.js";
import { getProjectRoot } from "./fs.js";

export async function createWorktree(runId: string, nodeId: string): Promise<string> {
  if (runId.includes("..") || nodeId.includes("..") || runId.startsWith("/") || runId.startsWith("\\") || nodeId.startsWith("/") || nodeId.startsWith("\\")) {
    throw new Error(`Invalid runId or nodeId`);
  }
  const root = getProjectRoot();
  const worktreePath = join(root, ".omk", "worktrees", runId, nodeId);
  await mkdir(worktreePath, { recursive: true });

  const branchName = `work/${runId}/${nodeId}`;
  const result = await runShell("git", ["worktree", "add", worktreePath, "-b", branchName], {
    cwd: root,
    timeout: 15000,
  });

  if (result.failed) {
    // If branch already exists, try using the existing branch
    const retry = await runShell("git", ["worktree", "add", worktreePath, branchName], {
      cwd: root,
      timeout: 15000,
    });
    if (retry.failed) {
      throw new Error(`Failed to create worktree at ${worktreePath}: ${retry.stderr}`);
    }
  }

  return worktreePath;
}

export async function removeWorktree(path: string): Promise<void> {
  const result = await runShell("git", ["worktree", "remove", "--force", path], { timeout: 15000 });
  if (result.failed) {
    throw new Error(`Failed to remove worktree at ${path}: ${result.stderr}`);
  }
}

export async function listWorktrees(runId: string): Promise<string[]> {
  const root = getProjectRoot();
  const worktreesDir = join(root, ".omk", "worktrees", runId);

  try {
    await access(worktreesDir);
  } catch {
    return [];
  }

  const entries = await readdir(worktreesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => join(worktreesDir, e.name));
}

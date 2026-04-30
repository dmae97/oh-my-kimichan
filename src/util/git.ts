import { runShell } from "./shell.js";

export async function isGitRepo(cwd?: string): Promise<boolean> {
  const result = await runShell("git", ["rev-parse", "--git-dir"], { cwd, timeout: 5000 });
  return !result.failed;
}

export async function getCurrentBranch(cwd?: string): Promise<string | null> {
  const result = await runShell("git", ["branch", "--show-current"], { cwd, timeout: 5000 });
  if (result.failed) return null;
  return result.stdout.trim() || null;
}

export async function gitWorktreeAdd(path: string, branch: string, cwd?: string): Promise<boolean> {
  const result = await runShell("git", ["worktree", "add", path, "-b", branch], { cwd, timeout: 15000 });
  return !result.failed;
}

export async function gitWorktreeRemove(path: string, cwd?: string): Promise<boolean> {
  const result = await runShell("git", ["worktree", "remove", "--force", path], { cwd, timeout: 15000 });
  return !result.failed;
}

export async function listWorktrees(cwd?: string): Promise<string[]> {
  const result = await runShell("git", ["worktree", "list", "--porcelain"], { cwd, timeout: 5000 });
  if (result.failed) return [];
  return result.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.replace("worktree ", ""));
}

export async function getGitStatus(cwd?: string): Promise<{ clean: boolean; changes: number }> {
  const result = await runShell("git", ["status", "--porcelain"], { cwd, timeout: 5000 });
  if (result.failed) return { clean: false, changes: -1 };
  const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);
  return { clean: lines.length === 0, changes: lines.length };
}

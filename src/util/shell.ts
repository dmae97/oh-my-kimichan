import { execa, type ExecaError } from "execa";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}

export async function runShell(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number; logPath?: string; input?: string } = {}
): Promise<ShellResult> {
  const { cwd, env, timeout = 30000, logPath, input } = options;

  try {
    const subprocess = execa(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout,
      reject: false,
      all: true,
      input,
    });

    if (logPath) {
      await mkdir(dirname(logPath), { recursive: true });
      const logStream = createWriteStream(logPath, { flags: "a" });
      subprocess.all?.pipe(logStream);
    }

    const result = await subprocess;
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      exitCode: result.exitCode ?? 1,
      failed: result.failed ?? result.exitCode !== 0,
    };
  } catch (err) {
    const e = err as ExecaError;
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.exitCode ?? 1,
      failed: true,
    };
  }
}

export async function checkCommand(command: string): Promise<boolean> {
  try {
    const result = await runShell("which", [command], { timeout: 5000 });
    return !result.failed && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getKimiVersion(): Promise<string | null> {
  const result = await runShell("kimi", ["--version"], { timeout: 10000 });
  if (result.failed) return null;
  return result.stdout.trim();
}

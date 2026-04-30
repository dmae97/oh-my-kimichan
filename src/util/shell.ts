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

function isExecaError(err: unknown): err is ExecaError {
  return (
    typeof err === "object" &&
    err !== null &&
    ("stdout" in err || "stderr" in err || "exitCode" in err)
  );
}

export async function runShell(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number; logPath?: string; input?: string } = {}
): Promise<ShellResult> {
  const { cwd, env, timeout = 30000, logPath, input } = options;
  let logStream: ReturnType<typeof createWriteStream> | undefined;

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
      logStream = createWriteStream(logPath, { flags: "a" });
      subprocess.all?.pipe(logStream);
    }

    const result = await subprocess;
    logStream?.end();
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      exitCode: result.exitCode ?? 1,
      failed: result.failed ?? result.exitCode !== 0,
    };
  } catch (err) {
    logStream?.end();
    if (isExecaError(err)) {
      return {
        stdout: String(err.stdout ?? ""),
        stderr: String(err.stderr ?? ""),
        exitCode: err.exitCode ?? 1,
        failed: true,
      };
    }
    // ExecaError가 아닌 경우 (spawn 실패 등)
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
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

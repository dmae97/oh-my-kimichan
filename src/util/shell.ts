import { execa, type ExecaError } from "execa";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { CappedOutputBuffer } from "./output-buffer.js";
import { getOmkResourceSettings } from "./resource-profile.js";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}

export interface StreamingShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  stdio?: "pipe" | "inherit";
  logPath?: string;
  input?: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
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
  options: { cwd?: string; env?: Record<string, string>; timeout?: number; maxBuffer?: number; stdio?: "pipe" | "inherit"; logPath?: string; input?: string } = {}
): Promise<ShellResult> {
  const resources = await getOmkResourceSettings();
  const { cwd, env, timeout = 30000, maxBuffer = resources.shellMaxBufferBytes, stdio = "pipe", logPath, input } = options;
  let logStream: ReturnType<typeof createWriteStream> | undefined;

  try {
    const subprocess = execa(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout,
      maxBuffer,
      buffer: stdio !== "inherit",
      stdio: stdio === "inherit" ? "inherit" : "pipe",
      reject: false,
      input,
    });

    if (logPath) {
      await mkdir(dirname(logPath), { recursive: true });
      logStream = createWriteStream(logPath, { flags: "a" });
      subprocess.stdout?.pipe(logStream, { end: false });
      subprocess.stderr?.pipe(logStream, { end: false });
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
        stderr: String(err.stderr ?? "") || (err instanceof Error ? err.message : String(err)),
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

export async function runShellStreaming(
  command: string,
  args: string[] = [],
  options: StreamingShellOptions = {}
): Promise<ShellResult> {
  const resources = await getOmkResourceSettings();
  const { cwd, env, timeout = 30000, maxBuffer = resources.shellMaxBufferBytes, stdio = "pipe", logPath, input, onStdout, onStderr } = options;
  let logStream: ReturnType<typeof createWriteStream> | undefined;
  const stdoutBuffer = new CappedOutputBuffer(maxBuffer, "stdout");
  const stderrBuffer = new CappedOutputBuffer(maxBuffer, "stderr");

  try {
    const subprocess = execa(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout,
      buffer: false,
      stdio: stdio === "inherit" ? "inherit" : "pipe",
      reject: false,
      input,
    });

    if (logPath) {
      await mkdir(dirname(logPath), { recursive: true });
      logStream = createWriteStream(logPath, { flags: "a" });
    }

    subprocess.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf-8");
      stdoutBuffer.append(line);
      logStream?.write(line);
      onStdout?.(line);
    });

    subprocess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf-8");
      stderrBuffer.append(line);
      logStream?.write(line);
      onStderr?.(line);
    });

    const result = await subprocess;
    logStream?.end();
    return {
      stdout: stdoutBuffer.toString(),
      stderr: stderrBuffer.toString(),
      exitCode: result.exitCode ?? 1,
      failed: result.failed ?? result.exitCode !== 0,
    };
  } catch (err) {
    logStream?.end();
    if (isExecaError(err)) {
      return {
        stdout: stdoutBuffer.toString() || String(err.stdout ?? ""),
        stderr: stderrBuffer.toString() || String(err.stderr ?? "") || (err instanceof Error ? err.message : String(err)),
        exitCode: err.exitCode ?? 1,
        failed: true,
      };
    }
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

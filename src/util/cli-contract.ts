/**
 * CLI Contract helpers — enforce JSON-mode stdout purity and typed command results.
 *
 * Rules:
 * - --json → stdout is exactly one JSON document, no banners/ANSI/human text.
 * - Human diagnostics go to stderr only.
 * - Command functions must NOT call process.exit; they throw CliError or return CommandResult.
 * - Only src/cli.ts adapters set process.exitCode.
 */

export interface CommandResult<T = void> {
  ok: boolean;
  exitCode: number;
  data?: T;
  diagnostics?: string[];
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly diagnostics?: string[]
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class UsageError extends CliError {
  constructor(message: string, diagnostics?: string[]) {
    super(message, 1, diagnostics);
    this.name = "UsageError";
  }
}

export class NotFoundError extends CliError {
  constructor(message: string, diagnostics?: string[]) {
    super(message, 1, diagnostics);
    this.name = "NotFoundError";
  }
}

export class VerificationError extends CliError {
  constructor(message: string, diagnostics?: string[]) {
    super(message, 1, diagnostics);
    this.name = "VerificationError";
  }
}

export class InterruptedError extends CliError {
  constructor(message: string = "Interrupted") {
    super(message, 130);
    this.name = "InterruptedError";
  }
}

/** Emit a single JSON document to stdout. */
export function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Emit error: JSON to stdout (in JSON mode), human text to stderr (always). */
export function emitError(
  message: string,
  json: boolean,
  jsonPayload?: Record<string, unknown>
): void {
  if (json) {
    console.log(JSON.stringify({ error: message, ...jsonPayload }, null, 2));
  }
  console.error(message);
}

/** Build a successful CommandResult. */
export function successResult<T>(data?: T): CommandResult<T> {
  return { ok: true, exitCode: 0, data };
}

/** Build a failed CommandResult. */
export function failureResult(
  exitCode: number,
  diagnostics?: string[]
): CommandResult {
  return { ok: false, exitCode, diagnostics };
}

/** Adapter: convert a CommandResult to CLI exit code. Does NOT call process.exit. */
export function applyExitCode(result: CommandResult): void {
  if (!result.ok && process.exitCode === undefined) {
    process.exitCode = result.exitCode;
  }
}

/** Returns true when stdout should be JSON-only (no ANSI, no human text). */
export function isJsonMode(options: { json?: boolean }): boolean {
  return Boolean(options.json);
}

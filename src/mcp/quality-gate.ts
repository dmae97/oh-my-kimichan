import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { getOmkResourceSettings } from "../util/resource-profile.js";

export type QualityGateName = "lint" | "typecheck" | "test" | "build";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface QualityGateResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface QualityGateResults {
  lint: QualityGateResult;
  typecheck: QualityGateResult;
  test: QualityGateResult;
  build: QualityGateResult;
}

interface ParsedQualitySetting {
  scriptName: string;
  packageManager?: PackageManager;
}

interface ResolvedQualityCommand {
  command: string;
  executable?: PackageManager;
  args?: string[];
  skipped?: boolean;
  blocked?: boolean;
  missing?: boolean;
}

const QUALITY_KEYS: QualityGateName[] = ["lint", "typecheck", "test", "build"];
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
const PACKAGE_MANAGERS = new Set<PackageManager>(["npm", "pnpm", "yarn", "bun"]);
const AUTO_SCRIPT_CANDIDATES: Record<QualityGateName, string[]> = {
  lint: ["lint"],
  typecheck: ["typecheck", "check"],
  test: ["test"],
  build: ["build"],
};

export function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectRoot, "bun.lockb")) || existsSync(join(projectRoot, "bun.lock"))) return "bun";
  return "npm";
}

export async function readPackageScripts(projectRoot: string): Promise<Set<string> | undefined> {
  try {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, unknown>;
    };
    if (!packageJson.scripts || typeof packageJson.scripts !== "object") return new Set();
    return new Set(
      Object.entries(packageJson.scripts)
        .filter(([, value]) => typeof value === "string")
        .map(([key]) => key)
    );
  } catch {
    return undefined;
  }
}

export function getQualitySetting(config: string, key: QualityGateName): string {
  // Match both top-level and [quality] section entries. This parser intentionally
  // accepts only the simple string settings that OMK templates generate.
  const regex = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
  return config.match(regex)?.[1]?.trim() ?? "auto";
}

export function resolveQualityCommand(
  setting: string,
  defaultScript: QualityGateName,
  detectedPackageManager: PackageManager,
  availableScripts?: Set<string>
): ResolvedQualityCommand {
  const normalized = setting.trim();
  if (normalized === "off") {
    return { command: "", skipped: true };
  }

  const parsed = normalized === "auto"
    ? { scriptName: resolveAutoScriptName(defaultScript, availableScripts) } satisfies ParsedQualitySetting
    : parseQualitySetting(normalized);

  if (!parsed || !SCRIPT_NAME_PATTERN.test(parsed.scriptName)) {
    return { command: "[blocked unsafe quality command]", blocked: true };
  }

  const packageManager = parsed.packageManager ?? detectedPackageManager;
  if (availableScripts && !availableScripts.has(parsed.scriptName)) {
    return {
      command: formatPackageScriptCommand(packageManager, parsed.scriptName),
      missing: true,
    };
  }

  return {
    command: formatPackageScriptCommand(packageManager, parsed.scriptName),
    executable: packageManager,
    args: ["run", parsed.scriptName],
  };
}

function resolveAutoScriptName(defaultScript: QualityGateName, availableScripts?: Set<string>): string {
  const candidates = AUTO_SCRIPT_CANDIDATES[defaultScript];
  if (!availableScripts) return candidates[0];
  return candidates.find((script) => availableScripts.has(script)) ?? candidates[0];
}

export async function runQualityGate(projectRoot: string, config: string): Promise<QualityGateResults> {
  const resources = await getOmkResourceSettings();
  const packageManager = detectPackageManager(projectRoot);
  const availableScripts = await readPackageScripts(projectRoot);

  const runGate = (gate: QualityGateName): QualityGateResult => {
    const command = resolveQualityCommand(getQualitySetting(config, gate), gate, packageManager, availableScripts);
    return runResolvedQualityCommand(command, projectRoot, resources.shellMaxBufferBytes);
  };

  return {
    lint: runGate("lint"),
    typecheck: runGate("typecheck"),
    test: runGate("test"),
    build: runGate("build"),
  };
}

function parseQualitySetting(setting: string): ParsedQualitySetting | null {
  if (SCRIPT_NAME_PATTERN.test(setting)) {
    return { scriptName: setting };
  }

  const parts = setting.split(/\s+/);
  if (parts.length === 3 && isPackageManager(parts[0]) && parts[1] === "run") {
    return { packageManager: parts[0], scriptName: parts[2] };
  }

  if (parts.length === 2 && parts[0] === "yarn") {
    return { packageManager: "yarn", scriptName: parts[1] };
  }

  return null;
}

function isPackageManager(value: string): value is PackageManager {
  return PACKAGE_MANAGERS.has(value as PackageManager);
}

function formatPackageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  return `${packageManager} run ${scriptName}`;
}

function runResolvedQualityCommand(command: ResolvedQualityCommand, projectRoot: string, maxBuffer: number): QualityGateResult {
  if (command.skipped) {
    return { command: "", exitCode: 0, stdout: "", stderr: "skipped (off)" };
  }
  if (command.blocked) {
    return {
      command: command.command,
      exitCode: 126,
      stdout: "",
      stderr: "blocked unsafe quality command; use auto, off, a package script name, or '<package-manager> run <script>'",
    };
  }
  if (command.missing || !command.executable || !command.args) {
    return {
      command: command.command,
      exitCode: 127,
      stdout: "",
      stderr: "package.json script not found",
    };
  }

  try {
    const stdout = execFileSync(command.executable, command.args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer,
    });
    return { command: command.command, exitCode: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; signal?: string };
    const stderr = String(e.stderr ?? "");
    const signal = e.signal ? `\nterminated by signal: ${e.signal}` : "";
    return {
      command: command.command,
      exitCode: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: `${stderr}${signal}`,
    };
  }
}

export function getQualityKeys(): QualityGateName[] {
  return [...QUALITY_KEYS];
}

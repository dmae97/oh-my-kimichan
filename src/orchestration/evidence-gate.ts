import { access } from "fs/promises";
import { constants } from "fs";
import type { DagNodeEvidence } from "./dag.js";
import { runShell } from "../util/shell.js";

/** Allowlist pattern reused from quality-gate.ts */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function resolveSafeCommand(command: string): { cmd: string; args: string[] } | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1 && SCRIPT_NAME_PATTERN.test(parts[0])) {
    return { cmd: "npm", args: ["run", parts[0]] };
  }
  if (parts.length >= 2 && PACKAGE_MANAGERS.has(parts[0]) && parts[1] === "run" && SCRIPT_NAME_PATTERN.test(parts[2] ?? "")) {
    return { cmd: parts[0], args: parts.slice(1) };
  }
  if (parts.length >= 2 && PACKAGE_MANAGERS.has(parts[0]) && SCRIPT_NAME_PATTERN.test(parts[1] ?? "")) {
    return { cmd: parts[0], args: ["run", parts[1]] };
  }
  return null;
}

export interface EvidenceGate {
  type: "file-exists" | "command-pass" | "diff-nonempty" | "summary-present";
  path?: string;
  command?: string;
  summaryMarker?: string;
}

export interface EvidenceCheckContext {
  cwd: string;
  stdout: string;
  nodeId: string;
}

export async function checkEvidenceGates(
  gates: EvidenceGate[],
  context: EvidenceCheckContext
): Promise<{ passed: boolean; evidence: DagNodeEvidence[] }> {
  const evidence: DagNodeEvidence[] = [];
  let allPassed = true;

  for (const gate of gates) {
    const result = await checkSingleGate(gate, context);
    evidence.push(result);
    if (!result.passed) allPassed = false;
  }

  return { passed: allPassed, evidence };
}

async function checkSingleGate(
  gate: EvidenceGate,
  context: EvidenceCheckContext
): Promise<DagNodeEvidence> {
  switch (gate.type) {
    case "file-exists": {
      if (!gate.path) {
        return {
          gate: gate.type,
          passed: false,
          message: `Missing "path" for file-exists gate`,
        };
      }
      try {
        await access(gate.path, constants.F_OK);
        return {
          gate: gate.type,
          passed: true,
          ref: gate.path,
          message: `File exists: ${gate.path}`,
        };
      } catch {
        return {
          gate: gate.type,
          passed: false,
          ref: gate.path,
          message: `File does not exist: ${gate.path}`,
        };
      }
    }

    case "command-pass": {
      if (!gate.command) {
        return {
          gate: gate.type,
          passed: false,
          message: `Missing "command" for command-pass gate`,
        };
      }
      const resolved = resolveSafeCommand(gate.command);
      if (!resolved) {
        return {
          gate: gate.type,
          passed: false,
          ref: gate.command,
          message: `Blocked unsafe command: ${gate.command}`,
        };
      }
      const result = await runShell(resolved.cmd, resolved.args, {
        cwd: context.cwd,
        timeout: 60_000,
      });
      if (!result.failed && result.exitCode === 0) {
        return {
          gate: gate.type,
          passed: true,
          ref: gate.command,
          message: `Command passed: ${gate.command}`,
        };
      }
      return {
        gate: gate.type,
        passed: false,
        ref: gate.command,
        message: result.exitCode !== undefined
          ? `Command failed with exit code ${result.exitCode}: ${gate.command}`
          : `Command execution failed: ${gate.command}`,
      };
    }

    case "diff-nonempty": {
      const result = await runShell("git", ["diff", "--stat"], {
        cwd: context.cwd,
        timeout: 30_000,
      });
      if (!result.failed && result.exitCode === 0) {
        const hasDiff = result.stdout.trim().length > 0;
        return {
          gate: gate.type,
          passed: hasDiff,
          message: hasDiff
            ? "Git diff is non-empty"
            : "Git diff is empty — no changes produced",
        };
      }
      return {
        gate: gate.type,
        passed: false,
        message: `Failed to check git diff: ${result.stderr || result.stdout || "unknown error"}`,
      };
    }

    case "summary-present": {
      const marker = gate.summaryMarker ?? "## Summary";
      const present = context.stdout.includes(marker);
      return {
        gate: gate.type,
        passed: present,
        ref: marker,
        message: present
          ? `Summary marker present: ${marker}`
          : `Summary marker missing: ${marker}`,
      };
    }

    default:
      return {
        gate: String(gate.type),
        passed: false,
        message: `Unknown evidence gate type: ${gate.type}`,
      };
  }
}

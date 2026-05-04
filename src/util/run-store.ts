/**
 * Canonical run store API.
 *
 * All `.omk/runs` IO must go through this module.
 * Raw `join(root, ".omk", "runs", runId)` is prohibited outside this file.
 */
import { join } from "path";
import { readdir } from "fs/promises";
import { getOmkPath } from "./fs.js";

export const RUN_ID_MAX_LENGTH = 128;
export const RESERVED_RUN_IDS = new Set(["latest"]);

/**
 * Validates a runId and returns the canonical form.
 * Rejects traversal, separators, drive syntax, UNC paths, and reserved names.
 */
export function validateRunId(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error(`Invalid runId: empty or non-string value`);
  }
  if (raw.length > RUN_ID_MAX_LENGTH) {
    throw new Error(`Invalid runId: exceeds ${RUN_ID_MAX_LENGTH} characters`);
  }
  if (raw === "." || raw === "..") {
    throw new Error(`Invalid runId: dot-only segment not allowed`);
  }
  if (RESERVED_RUN_IDS.has(raw)) {
    throw new Error(`Invalid runId: "${raw}" is reserved`);
  }
  // Allow alphanumerics, underscore, hyphen, and single dots inside the name,
  // but reject any path separators or other special characters.
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new Error(`Invalid runId: "${raw}" contains disallowed characters`);
  }
  return raw;
}

/**
 * Returns the `.omk/runs` directory path.
 */
export function getRunsDir(root?: string): string {
  return root ? join(root, ".omk", "runs") : getOmkPath("runs");
}

/**
 * Returns the full path to a run directory or an artifact inside it.
 * Validates the runId before constructing the path.
 */
export function getRunPath(runId: string, artifact?: string, root?: string): string {
  const valid = validateRunId(runId);
  const base = join(getRunsDir(root), valid);
  return artifact ? join(base, artifact) : base;
}

/**
 * Returns the path to a run artifact without validating runId.
 * Use only when runId has already been validated upstream.
 */
export function getRunArtifactPath(validRunId: string, artifact: string, root?: string): string {
  return join(getRunsDir(root), validRunId, artifact);
}

/**
 * Lists valid runIds from the runs directory.
 * Skips directories with invalid names (e.g., "latest", ".", "..").
 */
export async function listValidRunIds(root?: string): Promise<string[]> {
  const runsDir = getRunsDir(root);
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const valid: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        validateRunId(entry.name);
        valid.push(entry.name);
      } catch {
        // skip invalid run directory names
      }
    }
    return valid;
  } catch {
    return [];
  }
}

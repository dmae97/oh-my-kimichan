import { createHash } from "crypto";

export type SyncScope = "global" | "local";
export type SyncAction = "create" | "update" | "delete" | "symlink" | "blocked";

export interface SyncManifestEntry {
  path: string;
  scope: SyncScope;
  action: SyncAction;
  previousHash: string | null;
  newHash: string | null;
  backupPath: string | null;
  timestamp: string;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function simpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[i] ?? "";
    if (oldLine !== newLine) {
      result.push(`-${oldLine}`);
      result.push(`+${newLine}`);
    } else {
      result.push(` ${oldLine}`);
    }
  }
  return result.join("\n");
}

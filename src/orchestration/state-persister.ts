import { mkdir, readFile, writeFile, rename, unlink } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, join } from "path";
import type { RunState } from "../contracts/orchestration.js";

export interface StatePersister {
  load(runId: string): Promise<RunState | null>;
  save(state: RunState): Promise<void>;
}

function safePath(basePath: string, inputPath: string): string {
  if (isAbsolute(inputPath)) {
    throw new Error(`StatePersister: absolute paths are not allowed: ${inputPath}`);
  }
  const full = resolve(join(basePath, inputPath));
  const rel = relative(basePath, full);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`StatePersister: path traversal detected: ${inputPath}`);
  }
  return full;
}

export function createStatePersister(basePath: string = ".omk/runs"): StatePersister {
  return {
    async load(runId: string): Promise<RunState | null> {
      const filePath = safePath(basePath, join(runId, "state.json"));
      try {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content) as RunState;
      } catch {
        return null;
      }
    },

    async save(state: RunState): Promise<void> {
      const filePath = safePath(basePath, join(state.runId, "state.json"));
      await mkdir(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      try {
        await writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
        await rename(tempPath, filePath);
      } catch (err) {
        try { await unlink(tempPath); } catch { /* ignore cleanup error */ }
        throw err;
      }
    },
  };
}

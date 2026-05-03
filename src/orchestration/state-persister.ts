import { mkdir, readFile, writeFile, rename, unlink } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, join } from "path";
import type { RunState } from "../contracts/orchestration.js";

const SECRET_KEY_EXACT = ["apikey", "token", "password", "secret", "authorization", "bearer"];
const SECRET_KEY_SUFFIXES = ["_api_key", "_token", "_password", "_secret", "_auth", "_bearer"];

function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  return SECRET_KEY_EXACT.includes(lk) ||
         SECRET_KEY_SUFFIXES.some((s) => lk.endsWith(s));
}

function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && isSecretKey(key)) {
      result[key] = "***";
    } else {
      result[key] = redactSecrets(value);
    }
  }
  return result;
}

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
      const cloned = JSON.parse(JSON.stringify(state)) as RunState;
      const toSave: RunState = { ...(redactSecrets(cloned) as RunState), schemaVersion: 1 };
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      try {
        await writeFile(tempPath, JSON.stringify(toSave, null, 2), "utf-8");
        await rename(tempPath, filePath);
      } catch (err) {
        try { await unlink(tempPath); } catch { /* ignore cleanup error */ }
        throw err;
      }
    },
  };
}

import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  unlink,
} from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import type { GoalEvidence, GoalHistoryEntry, GoalSpec } from "../contracts/goal.js";

export interface GoalPersister {
  load(goalId: string): Promise<GoalSpec | null>;
  save(spec: GoalSpec): Promise<void>;
  list(): Promise<string[]>;
  loadEvidence(goalId: string): Promise<GoalEvidence[]>;
  saveEvidence(goalId: string, evidence: GoalEvidence[]): Promise<void>;
  appendHistory(goalId: string, entry: GoalHistoryEntry): Promise<void>;
}

function safePath(basePath: string, inputPath: string): string {
  if (isAbsolute(inputPath)) {
    throw new Error(`GoalPersister: absolute paths are not allowed: ${inputPath}`);
  }
  const full = resolve(join(basePath, inputPath));
  const rel = relative(basePath, full);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`GoalPersister: path traversal detected: ${inputPath}`);
  }
  return full;
}

function goalDir(basePath: string, goalId: string): string {
  const sanitized = goalId.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (sanitized !== goalId || sanitized.length === 0 || sanitized.length > 128) {
    throw new Error(`Invalid goalId: ${goalId}`);
  }
  return safePath(basePath, sanitized);
}

function atomicWrite(filePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    mkdir(dirname(filePath), { recursive: true })
      .then(() => writeFile(tempPath, content, "utf-8"))
      .then(() => rename(tempPath, filePath))
      .then(() => resolve())
      .catch(async (err) => {
        try {
          await unlink(tempPath);
        } catch {
          // ignore cleanup error
        }
        reject(err);
      });
  });
}

export function createGoalPersister(basePath: string = ".omk/goals"): GoalPersister {
  return {
    async load(goalId: string): Promise<GoalSpec | null> {
      const filePath = join(goalDir(basePath, goalId), "goal.json");
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(content) as unknown;
        if (!parsed || typeof parsed !== "object") {
          console.warn(`GoalPersister: corrupt JSON for ${goalId} — not an object`);
          return null;
        }
        const obj = parsed as Record<string, unknown>;
        if (obj.schemaVersion !== 1) {
          console.warn(`GoalPersister: unsupported schemaVersion for ${goalId}: ${obj.schemaVersion}`);
          return null;
        }
        return parsed as GoalSpec;
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
          return null;
        }
        console.warn(`GoalPersister: failed to load ${goalId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },

    async save(spec: GoalSpec): Promise<void> {
      spec.updatedAt = new Date().toISOString();
      const dir = goalDir(basePath, spec.goalId);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, "goal.json");
      await atomicWrite(filePath, JSON.stringify(spec, null, 2));
    },

    async list(): Promise<string[]> {
      try {
        const entries = await readdir(basePath, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const withMtime = await Promise.all(
          dirs.map(async (id) => {
            const spec = await this.load(id);
            return { id, updatedAt: spec?.updatedAt ?? "1970-01-01T00:00:00.000Z" };
          })
        );
        return withMtime
          .filter((g) => g.updatedAt !== "1970-01-01T00:00:00.000Z")
          .sort((a, b) => {
            const timeDiff = b.updatedAt.localeCompare(a.updatedAt);
            return timeDiff !== 0 ? timeDiff : b.id.localeCompare(a.id);
          })
          .map((g) => g.id);
      } catch {
        return [];
      }
    },

    async loadEvidence(goalId: string): Promise<GoalEvidence[]> {
      const filePath = join(goalDir(basePath, goalId), "evidence.json");
      try {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content) as GoalEvidence[];
      } catch {
        return [];
      }
    },

    async saveEvidence(goalId: string, evidence: GoalEvidence[]): Promise<void> {
      const dir = goalDir(basePath, goalId);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, "evidence.json");
      await atomicWrite(filePath, JSON.stringify(evidence, null, 2));
    },

    async appendHistory(goalId: string, entry: GoalHistoryEntry): Promise<void> {
      const dir = goalDir(basePath, goalId);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, "history.jsonl");
      const line = JSON.stringify(entry) + "\n";
      await writeFile(filePath, line, { flag: "a", encoding: "utf-8" });
    },
  };
}

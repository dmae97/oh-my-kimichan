import { join } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import { getProjectRoot } from "./fs.js";

export function getRunDir(runId: string): string {
  const root = getProjectRoot();
  return join(root, ".omk", "runs", runId);
}

export async function ensureRunDir(runId: string): Promise<string> {
  const dir = getRunDir(runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeRunState(runId: string, state: unknown): Promise<void> {
  const dir = await ensureRunDir(runId);
  const statePath = join(dir, "state.json");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function readRunState(runId: string): Promise<unknown> {
  const dir = getRunDir(runId);
  const statePath = join(dir, "state.json");
  try {
    const content = await readFile(statePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

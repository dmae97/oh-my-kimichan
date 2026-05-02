import { appendFile, readFile } from "fs/promises";
import { join } from "path";

export type ReplayEventType =
  | "replay-start"
  | "replay-end"
  | "node-start"
  | "node-complete"
  | "node-fallback"
  | "state-change";

export interface ReplayEvent {
  type: ReplayEventType;
  timestamp: string;
  runId: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export async function appendEvent(
  runDir: string,
  event: Omit<ReplayEvent, "timestamp">
): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = JSON.stringify({ ...event, timestamp }) + "\n";
  await appendFile(join(runDir, "events.jsonl"), line, "utf-8");
}

export async function readEvents(runDir: string): Promise<ReplayEvent[]> {
  try {
    const content = await readFile(join(runDir, "events.jsonl"), "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ReplayEvent);
  } catch {
    return [];
  }
}

/**
 * Kimi CLI session usage tracker
 * Scans ~/.kimi/sessions to compute daily coding time
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface UsageStats {
  totalSecondsToday: number;
  sessionCountToday: number;
  totalSecondsWeek: number;
  sessionCountWeek: number;
}

interface SessionTime {
  start: number;
  end: number;
  date: Date;
}

function getKstDate(ts: number): Date {
  const d = new Date(ts * 1000);
  // KST is UTC+9
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(d.getTime() + kstOffset);
}

function isSameKstDay(d1: Date, d2: Date): boolean {
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
}

function isSameKstWeek(d1: Date, d2: Date): boolean {
  // Simple week check: same year and within 7 days (inclusive)
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.abs(d1.getTime() - d2.getTime());
  return d1.getUTCFullYear() === d2.getUTCFullYear() && diff <= 7 * dayMs;
}

async function scanWireJsonl(path: string): Promise<SessionTime | null> {
  try {
    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    let start: number | undefined;
    let end: number | undefined;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (typeof obj.timestamp === "number") {
          if (start === undefined) start = obj.timestamp;
          end = obj.timestamp;
        }
      } catch {
        // ignore malformed line
      }
    }

    if (typeof start !== "number" || typeof end !== "number") return null;

    return { start, end, date: getKstDate(start) };
  } catch {
    return null;
  }
}

async function scanRunFallback(runPath: string): Promise<SessionTime | null> {
  // Fallback when wire.jsonl is missing: use filesystem timestamps
  const candidates = [
    join(runPath, "context.jsonl"),
    join(runPath, "state.json"),
    runPath,
  ];
  for (const p of candidates) {
    try {
      const s = await stat(p);
      const start = Math.floor(s.birthtimeMs / 1000);
      const end = Math.floor(Math.max(s.mtimeMs, s.ctimeMs) / 1000);
      if (typeof start === "number" && typeof end === "number" && end >= start) {
        return { start, end, date: getKstDate(start) };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function getKimiUsage(): Promise<UsageStats> {
  const sessionsDir = join(homedir(), ".kimi", "sessions");
  const nowKst = getKstDate(Date.now() / 1000);

  let totalSecondsToday = 0;
  let sessionCountToday = 0;
  let totalSecondsWeek = 0;
  let sessionCountWeek = 0;

  try {
    const sessionIds = await readdir(sessionsDir);
    for (const sessionId of sessionIds) {
      const sessionPath = join(sessionsDir, sessionId);
      const runs = await readdir(sessionPath, { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[]);
      for (const runId of runs) {
        const runPath = join(sessionPath, runId);
        const st = (await scanWireJsonl(join(runPath, "wire.jsonl"))) ??
                   (await scanRunFallback(runPath));
        if (!st) continue;

        const duration = Math.max(0, st.end - st.start);
        if (duration > 3600 * 24) continue; // Ignore sessions > 24h (likely stale)

        if (isSameKstDay(st.date, nowKst)) {
          totalSecondsToday += duration;
          sessionCountToday++;
        }
        if (isSameKstWeek(st.date, nowKst)) {
          totalSecondsWeek += duration;
          sessionCountWeek++;
        }
      }
    }
  } catch (err) {
    console.warn("[omk] Failed to scan Kimi usage:", (err as Error).message);
  }

  return {
    totalSecondsToday,
    sessionCountToday,
    totalSecondsWeek,
    sessionCountWeek,
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

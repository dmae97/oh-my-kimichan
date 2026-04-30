// Contract: src/contracts/hud.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

import type { RunState } from "./orchestration.js";

export interface MetricSnapshot {
  cpuPercent: number;
  memPercent: number;
  diskPercent?: number;
  tokenUsageToday: number;
  sessionCountToday: number;
}

export interface HudRenderer {
  render(state: RunState | null, metrics: MetricSnapshot): void;
}

export type LogHandler = (line: string, source: "stdout" | "stderr") => void;

export interface WorkerLogStream {
  runId: string;
  workerId: string;
  onLine: LogHandler;
}

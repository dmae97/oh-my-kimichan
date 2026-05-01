/**
 * Parallel Execution Live UI — real-time DAG status renderer
 *
 * Renders a compact, non-intrusive terminal panel showing:
 * - Running / done / failed / blocked nodes with role colors
 * - Progress bar and ETA
 * - Safety / approval policy chip
 * - Ensemble quorum gauge (when applicable)
 */

import type { RunState, RunProgressEstimate } from "../contracts/orchestration.js";
import {
  style,
  gradient,
  panel,
  gauge,
  stat,
  separator,
  parallelStatusBadge,
  workerLabel,
  safetyChip,
  ensembleQuorumBar,
  roleColor,
  sparkleHeader,
  padEndAnsi,
  sanitizeTerminalText,
} from "./theme.js";

let stdoutLock: Promise<void> = Promise.resolve();
async function lockedStdoutWrite(data: string): Promise<void> {
  stdoutLock = stdoutLock.then(() => {
    process.stdout.write(data);
  }).catch(() => {
    process.stdout.write(data);
  });
  await stdoutLock;
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

export interface ParallelLiveUIOptions {
  runId: string;
  approvalPolicy?: string;
  workerCount?: number;
  ensembleEnabled?: boolean;
  refreshMs?: number;
  onFrame?: (frame: string) => void;
}

export interface ParallelRenderContext {
  state: RunState;
  policy: string;
  workers: number;
  ensemble: boolean;
}

function truncate(value: string, max: number): string {
  const clean = stripAnsi(value).trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  return chars.slice(0, Math.max(1, max - 1)).join("") + "…";
}

function nodeSortRank(status: string): number {
  switch (status) {
    case "running": return 0;
    case "failed": return 1;
    case "blocked": return 2;
    case "pending": return 3;
    case "done": return 4;
    default: return 5;
  }
}

function formatEta(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "--";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function renderParallelStatusLine(ctx: ParallelRenderContext): string {
  const { state, policy, workers, ensemble } = ctx;
  const estimate = state.estimate;
  const nodes = [...state.nodes].sort((a, b) => {
    const r = nodeSortRank(a.status) - nodeSortRank(b.status);
    return r !== 0 ? r : a.id.localeCompare(b.id);
  });

  const running = nodes.filter((n) => n.status === "running");
  const done = nodes.filter((n) => n.status === "done");
  const failed = nodes.filter((n) => n.status === "failed");
  const blocked = nodes.filter((n) => n.status === "blocked");

  const lines: string[] = [];

  // Header
  lines.push(sparkleHeader("OMK Parallel Execution"));
  lines.push(`  ${style.gray("Run ID:")} ${style.creamBold(state.runId)}`);
  lines.push(`  ${safetyChip(policy)}  ${style.gray("workers:")} ${style.creamBold(String(workers))}${ensemble ? "  " + style.purple("[ensemble]") : ""}`);
  lines.push("");

  // Progress gauge
  if (estimate) {
    const pct = estimate.percentComplete ?? 0;
    lines.push(gauge("Progress", pct, 100, 24));
    lines.push(gauge("Workers ", running.length, workers, 24));
    lines.push(stat("ETA", formatEta(estimate.estimatedRemainingMs), ""));
    lines.push(stat("Nodes", `${done.length} done / ${running.length} running / ${failed.length} fail / ${blocked.length} block / ${nodes.length} total`, ""));
    lines.push("");
  }

  // Node list (compact grid)
  const nodeLines = nodes.flatMap((n) => {
    const name = truncate(n.name || n.id, 36);
    const duration = n.durationMs ? ` ${style.gray(`(${Math.round(n.durationMs / 1000)}s)`)}` : "";
    const attempts = (n.attempts && n.attempts.length > 1) ? style.orange(` ×${n.attempts.length}`) : "";
    const out = [`  ${parallelStatusBadge(n.status, n.role)}  ${name}${duration}${attempts}`];
    if (n.thinking) {
      out.push(`      ${style.gray(truncate(n.thinking, 56))}`);
    }
    return out;
  });

  lines.push(...nodeLines);
  lines.push("");

  // Ensemble quorum hint (if metadata present)
  const ensembleMeta = state.nodes
    .map((n) => n.id)
    .filter((id) => id.includes("#"))
    .length;
  if (ensemble || ensembleMeta > 0) {
    // Try to read ensemble metadata from the first node that has it
    const nodeWithMeta = state.nodes.find((n) => n.evidence && n.evidence.length > 0);
    if (nodeWithMeta) {
      lines.push(style.gray("  Ensemble candidates active across nodes."));
    }
    lines.push("");
  }

  // Footer
  lines.push(separator(60));
  lines.push(style.gray("  Ctrl+C to abort  |  omk hud --watch for full dashboard"));
  lines.push("");

  return panel(lines, gradient("Live Parallel Status"));
}

export function renderParallelFrame(
  state: RunState,
  options: Omit<ParallelLiveUIOptions, "refreshMs" | "onFrame">
): string {
  return renderParallelStatusLine({
    state,
    policy: options.approvalPolicy || "yolo",
    workers: options.workerCount || 1,
    ensemble: options.ensembleEnabled || false,
  });
}

export class ParallelLiveRenderer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastFrame = "";
  private lastFrameHash = 0;
  private readonly refreshMs: number;
  private readonly options: Omit<ParallelLiveUIOptions, "refreshMs">;

  constructor(options: ParallelLiveUIOptions) {
    this.refreshMs = options.refreshMs ?? 2000;
    const { refreshMs: _, ...rest } = options;
    this.options = rest;
  }

  start(stateProvider: () => RunState | undefined): void {
    this.stopped = false;
    this.renderNow(stateProvider);
    this.timer = setInterval(() => {
      if (!this.stopped) this.renderNow(stateProvider);
    }, this.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  renderOnce(state: RunState): string {
    const frame = renderParallelFrame(state, this.options);
    this.lastFrame = frame;
    return frame;
  }

  private renderNow(stateProvider: () => RunState | undefined): void {
    const state = stateProvider();
    if (!state) return;
    const frame = renderParallelFrame(state, this.options);
    const frameHash = hashString(frame);
    if (frameHash === this.lastFrameHash) return;
    this.lastFrameHash = frameHash;
    this.lastFrame = frame;

    if (this.options.onFrame) {
      this.options.onFrame(frame);
      return;
    }

    // Default: home cursor + erase-down for less flicker
    const output = "\x1b[H\x1b[J" + frame + "\n";
    void lockedStdoutWrite(output);
  }
}

function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

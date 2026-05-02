/**
 * Shared RunViewModel — unified state interpretation for HUD and Parallel UI.
 */

import type { RunState } from "../contracts/orchestration.js";

export type RunHealth = "ok" | "warn" | "blocked" | "failed";

export interface RunViewModelWorker {
  id: string;
  label: string;
  state: "idle" | "running" | "done" | "failed" | "blocked";
  elapsedMs: number;
  retryCount: number;
  currentNode?: string;
  lastEvidence?: { gate: string; passed: boolean; message?: string };
}

export interface RunViewModelBlocker {
  nodeId: string;
  reason: string;
  nextAction: string;
}

export interface RunViewModelActiveNode {
  id: string;
  name: string;
  role: string;
  thinking?: string;
}

export interface RunViewModelProgress {
  percent: number;
  done: number;
  total: number;
  running: number;
  failed: number;
  blocked: number;
}

export interface RunViewModel {
  health: RunHealth;
  goalTitle: string | null;
  goalScore: number | null;
  activeNode: RunViewModelActiveNode | null;
  blocker: RunViewModelBlocker | null;
  nextAction: string | null;
  progress: RunViewModelProgress;
  eta: string | null;
  changedFiles: string[];
  stateError: "ok" | "missing" | "invalid" | "corrupt" | "oldSchema";
  runId: string | null;
  workers: RunViewModelWorker[];
}

export interface BuildRunViewModelOptions {
  goalTitle?: string | null;
  changedFiles?: string[];
  workerLabels?: Record<string, string>;
}

export function parseRunStateResult(content: string): { state: RunState | null; error: RunViewModel["stateError"] } {
  try {
    const value = JSON.parse(content) as Partial<RunState>;
    if (!value || typeof value !== "object") {
      return { state: null, error: "invalid" };
    }
    if (typeof value.runId !== "string") {
      return { state: null, error: "invalid" };
    }
    if (!Array.isArray(value.nodes)) {
      return { state: null, error: "invalid" };
    }
    if (value.schemaVersion !== 1) {
      return { state: null, error: "oldSchema" };
    }
    return { state: value as RunState, error: "ok" };
  } catch {
    return { state: null, error: "corrupt" };
  }
}

export function getRunStateRecoveryHint(error: RunViewModel["stateError"], runId?: string): string {
  switch (error) {
    case "ok":
      return "";
    case "missing":
      return `No run state found. Start a new run with: omk run --run-id ${runId ?? "<run-id>"}`;
    case "invalid":
      return `Run state is invalid. Verify with: omk verify --run ${runId ?? "<run-id>"}`;
    case "corrupt":
      return `Run state file is corrupt. Check the state file or start a new run with: omk run --run-id ${runId ?? "<run-id>"}`;
    case "oldSchema":
      return `Run state schema is outdated or missing. Migrate or restart with: omk verify --run ${runId ?? "<run-id>"}`;
    default:
      return "";
  }
}

export function formatEtaMs(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "--";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function renderRunSummary(vm: RunViewModel): string {
  const goal = vm.goalTitle ?? "--";
  const progress = `${vm.progress.done}/${vm.progress.total}`;
  const health = vm.health.toUpperCase();
  const next = vm.nextAction ?? "--";
  const blocker = vm.blocker ? `${vm.blocker.reason} (${vm.blocker.nodeId})` : "none";
  return `Goal: ${goal} | Progress: ${progress} | Health: ${health} | Next: ${next} | Blocker: ${blocker}`;
}

export function buildRunViewModel(
  state: RunState | null,
  options: BuildRunViewModelOptions = {}
): RunViewModel {
  if (!state) {
    return {
      health: "warn",
      goalTitle: options.goalTitle ?? null,
      goalScore: null,
      activeNode: null,
      blocker: null,
      nextAction: null,
      progress: { percent: 0, done: 0, total: 0, running: 0, failed: 0, blocked: 0 },
      eta: null,
      changedFiles: options.changedFiles ?? [],
      stateError: "missing",
      runId: null,
      workers: [],
    };
  }

  const nodes = state.nodes;
  const running = nodes.filter((n) => n.status === "running");
  const done = nodes.filter((n) => n.status === "done");
  const failed = nodes.filter((n) => n.status === "failed");
  const blocked = nodes.filter((n) => n.status === "blocked");
  const pending = nodes.filter((n) => n.status === "pending");

  const total = nodes.length;
  const percent = total > 0 ? Math.round((done.length / total) * 100) : 0;

  let health: RunHealth = "ok";
  if (failed.length > 0) health = "failed";
  else if (blocked.length > 0) health = "blocked";
  else if (running.length > 0 && pending.length === 0 && done.length > 0) health = "warn";

  const activeNode = running[0]
    ? {
        id: running[0].id,
        name: running[0].name || running[0].id,
        role: running[0].role || "unknown",
        thinking: running[0].thinking,
      }
    : null;

  const blockerNode = failed[0] ?? blocked[0];
  const blocker: RunViewModelBlocker | null = blockerNode
    ? {
        nodeId: blockerNode.id,
        reason: blockerNode.status === "failed" ? "Node failed" : "Node blocked",
        nextAction: `omk verify --run ${state.runId}`,
      }
    : null;

  const nextAction =
    blocker?.nextAction ??
    (activeNode ? `Waiting for ${activeNode.name}` : done.length === total ? "Run complete" : "Ready");

  const isLifecycleNode = (n: (typeof nodes)[0]) =>
    n.id === "bootstrap" || n.id === "root-coordinator" || n.id === "review-merge";

  const workers = nodes
    .filter((n) => !isLifecycleNode(n))
    .map((n) => {
      const elapsed = n.durationMs ?? (n.startedAt ? Date.now() - new Date(n.startedAt).getTime() : 0);
      const lastEvidence = n.evidence?.length ? n.evidence[n.evidence.length - 1] : undefined;
      return {
        id: n.id,
        label: options.workerLabels?.[n.id] ?? n.name ?? n.id,
        state: ((n.status === "pending" ? "idle" : n.status) as RunViewModelWorker["state"]) ?? "idle",
        elapsedMs: Math.max(0, elapsed),
        retryCount: n.attempts?.length ?? 0,
        currentNode: n.status === "running" ? (n.name || n.id) : undefined,
        lastEvidence: lastEvidence
          ? { gate: lastEvidence.gate, passed: lastEvidence.passed, message: lastEvidence.message }
          : undefined,
      };
    });

  return {
    health,
    goalTitle: options.goalTitle ?? null,
    goalScore: total > 0 ? Math.round((done.length / total) * 100) : null,
    activeNode,
    blocker,
    nextAction,
    progress: {
      percent,
      done: done.length,
      total,
      running: running.length,
      failed: failed.length,
      blocked: blocked.length,
    },
    eta: state.estimate?.estimatedRemainingMs != null ? formatEtaMs(state.estimate.estimatedRemainingMs) : null,
    changedFiles: options.changedFiles ?? [],
    stateError: "ok",
    runId: state.runId,
    workers,
  };
}

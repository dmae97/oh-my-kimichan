import type { RunProgressEstimate } from "../contracts/orchestration.js";
import type { DagNode } from "./dag.js";

const DEFAULT_NODE_DURATION_MS = 180_000;
const MIN_RUNNING_REMAINING_RATIO = 0.1;

export interface EstimateRunProgressInput {
  nodes: DagNode[];
  startedAt: string;
  workerCount: number;
  now?: Date;
  fallbackDurationMs?: number;
}

export function estimateRunProgress(input: EstimateRunProgressInput): RunProgressEstimate {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const startedMs = parseTimestamp(input.startedAt) ?? nowMs;
  const workerCount = Math.max(1, Math.floor(input.workerCount));
  const fallbackDurationMs = normalizeDuration(input.fallbackDurationMs) ?? DEFAULT_NODE_DURATION_MS;

  const completedNodes = input.nodes.filter((node) => node.status === "done").length;
  const runningNodes = input.nodes.filter((node) => node.status === "running").length;
  const pendingNodes = input.nodes.filter((node) => node.status === "pending").length;
  const failedNodes = input.nodes.filter((node) => node.status === "failed").length;
  const blockedNodes = input.nodes.filter((node) => node.status === "blocked").length;
  const totalNodes = input.nodes.length;

  const completedDurations = input.nodes
    .filter((node) => node.status === "done")
    .map((node) => normalizeDuration(node.durationMs))
    .filter((duration): duration is number => duration !== undefined);
  const averageCompletedDurationMs = completedDurations.length > 0
    ? Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length)
    : undefined;
  const averageDurationMs = averageCompletedDurationMs ?? fallbackDurationMs;

  const runningRemainingMs = input.nodes
    .filter((node) => node.status === "running")
    .map((node) => estimateRunningRemaining(node, nowMs, averageDurationMs));
  const maxRunningRemainingMs = runningRemainingMs.length === 0 ? 0 : Math.max(...runningRemainingMs);
  const pendingWaves = pendingNodes === 0 ? 0 : Math.ceil(pendingNodes / workerCount);
  const estimatedRemainingMs = Math.round(maxRunningRemainingMs + pendingWaves * averageDurationMs);
  const estimatedCompletedAt = estimatedRemainingMs > 0
    ? new Date(nowMs + estimatedRemainingMs).toISOString()
    : now.toISOString();

  return {
    elapsedMs: Math.max(0, nowMs - startedMs),
    completedNodes,
    runningNodes,
    pendingNodes,
    failedNodes,
    blockedNodes,
    totalNodes,
    workerCount,
    percentComplete: totalNodes === 0 ? 100 : Math.round((completedNodes / totalNodes) * 100),
    fallbackDurationMs,
    averageCompletedDurationMs,
    estimatedRemainingMs,
    estimatedCompletedAt,
    confidence: estimateConfidence(completedDurations.length, totalNodes),
    updatedAt: now.toISOString(),
  };
}

function estimateRunningRemaining(node: DagNode, nowMs: number, averageDurationMs: number): number {
  const startedAtMs = parseTimestamp(node.startedAt);
  if (startedAtMs === undefined) return averageDurationMs;

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const minimumRemainingMs = Math.round(averageDurationMs * MIN_RUNNING_REMAINING_RATIO);
  return Math.max(averageDurationMs - elapsedMs, minimumRemainingMs);
}

function estimateConfidence(completedSampleSize: number, totalNodes: number): RunProgressEstimate["confidence"] {
  if (completedSampleSize === 0) return "low";
  if (completedSampleSize >= 2 || completedSampleSize >= Math.ceil(totalNodes / 2)) return "high";
  return "medium";
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

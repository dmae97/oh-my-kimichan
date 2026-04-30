// Contract: src/contracts/orchestration.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

import type { Dag, DagNode } from "../orchestration/dag.js";

export type ApprovalPolicy = "interactive" | "auto" | "yolo" | "block";

export interface TaskResult {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  metadata?: Record<string, unknown>;
}

export interface RunOptions {
  runId: string;
  workers: number;
  approvalPolicy: ApprovalPolicy;
  worktreeRoot?: string;
}

export type EstimateConfidence = "low" | "medium" | "high";

export interface RunProgressEstimate {
  elapsedMs: number;
  completedNodes: number;
  runningNodes: number;
  pendingNodes: number;
  failedNodes: number;
  blockedNodes: number;
  totalNodes: number;
  workerCount: number;
  percentComplete: number;
  fallbackDurationMs: number;
  averageCompletedDurationMs?: number;
  estimatedRemainingMs?: number;
  estimatedCompletedAt?: string;
  confidence: EstimateConfidence;
  updatedAt: string;
}

export interface RunState {
  runId: string;
  nodes: DagNode[];
  startedAt: string;
  completedAt?: string;
  estimate?: RunProgressEstimate;
}

export interface RunResult {
  state: RunState;
  success: boolean;
}

export interface TaskRunner {
  run(node: DagNode, env: Record<string, string>): Promise<TaskResult>;
}

export interface DagExecutor {
  execute(dag: Dag, runner: TaskRunner, options: RunOptions): Promise<RunResult>;
  onStateChange(handler: (state: RunState) => void): () => void;
}

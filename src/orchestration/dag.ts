import { TaskDagGraph } from "./task-graph.js";
import { mergeDagNodeRouting, selectTaskRouting } from "./routing.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked" | "skipped";
export type DagContextBudget = "tiny" | "small" | "normal";
export type DagOutputGate = "file-exists" | "test-pass" | "review-pass" | "command-pass" | "summary" | "none";

export interface DagNodeInput {
  name: string;
  ref: string;
  from?: string;
  required?: boolean;
}

export interface DagNodeOutput {
  name: string;
  ref?: string;
  gate?: DagOutputGate;
  required?: boolean;
}

export interface DagNodeRouting {
  skills?: string[];
  mcpServers?: string[];
  tools?: string[];
  contextBudget?: DagContextBudget;
  readOnly?: boolean;
  evidenceRequired?: boolean;
  rationale?: string;
  rejected?: Array<{ id: string; reason: string }>;
}

export interface DagNodeFailurePolicy {
  retryable?: boolean;
  blockDependents?: boolean;
  fallbackRole?: string;
  skipOnFailure?: boolean;
}

export interface DagNodeEvidence {
  gate: string;
  passed: boolean;
  ref?: string;
  message?: string;
}

export interface DagNodeAttempt {
  attempt: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status?: "done" | "failed";
}

export interface DagNode {
  id: string;
  name: string;
  role: string;
  dependsOn: string[];
  status: TaskStatus;
  worktree?: string;
  retries: number;
  maxRetries: number;
  timeoutMs?: number;
  timeoutPreset?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempts?: DagNodeAttempt[];
  priority?: number;
  cost?: 1 | 2 | 3;
  inputs?: DagNodeInput[];
  outputs?: DagNodeOutput[];
  routing?: DagNodeRouting;
  failurePolicy?: DagNodeFailurePolicy;
  blockedReason?: string;
  evidence?: DagNodeEvidence[];
  /** Live "thinking" text exposed while the node is running (e.g. ensemble progress). */
  thinking?: string;
}

export interface Dag {
  nodes: DagNode[];
}

export type DagNodeDefinition = Omit<DagNode, "status" | "retries">;

export function createDag(def: { nodes: DagNodeDefinition[] }): Dag {
  const nodes = def.nodes.map((n) => {
    validateNodeDefinition(n);
    return {
      ...n,
      routing: mergeDagNodeRouting(selectTaskRouting(n), n.routing),
      failurePolicy: {
        retryable: true,
        blockDependents: true,
        skipOnFailure: false,
        ...(n.failurePolicy ?? {}),
      },
      status: "pending" as const,
      retries: 0,
    };
  });
  validateInputDependencies(nodes);
  new TaskDagGraph(nodes);
  return { nodes };
}

export function getRunnableNodes(dag: Dag): DagNode[] {
  return new TaskDagGraph(dag.nodes).runnableNodes();
}

export function getNodeById(dag: Dag, id: string): DagNode | undefined {
  return new TaskDagGraph(dag.nodes).getNode(id);
}

export function updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void {
  const node = getNodeById(dag, id);
  if (node) {
    node.status = status;
    if (status === "failed") {
      node.retries += 1;
      if (node.retries < node.maxRetries) {
        node.status = "pending";
      } else {
        const shouldBlock = node.failurePolicy?.blockDependents !== false && !(node.outputs?.every((o) => o.required === false));
        if (shouldBlock) {
          blockDependents(dag, id, `dependency failed: ${id}`);
        }
      }
    }
  }
}

export function isDagComplete(dag: Dag): boolean {
  return dag.nodes.every((n) => n.status === "done" || n.status === "skipped");
}

export function isDagFailed(dag: Dag): boolean {
  return dag.nodes.some((n) => {
    if (n.status === "blocked") return true;
    if (n.status === "failed" && n.retries >= n.maxRetries) {
      if (n.failurePolicy?.blockDependents === false) return false;
      if (n.outputs?.every((o) => o.required === false)) return false;
      return true;
    }
    return false;
  });
}

export function dependsOnRequiredOutput(dependent: DagNode, failedId: string): boolean {
  const inputsFromFailed = dependent.inputs?.filter((input) => input.from === failedId) ?? [];
  if (inputsFromFailed.length > 0) {
    return inputsFromFailed.some((input) => input.required !== false);
  }
  return dependent.dependsOn.includes(failedId);
}

export function skipNode(dag: Dag, id: string): void {
  const node = getNodeById(dag, id);
  if (!node || node.status === "done" || node.status === "running") return;
  node.status = "skipped";
  node.blockedReason = `skipped because ${id} was skipped or failed with skipOnFailure`;
  const queue: Array<{ childId: string; skipSourceId: string }> = dag.nodes
    .filter((n) => n.dependsOn.includes(id))
    .map((n) => ({ childId: n.id, skipSourceId: id }));

  while (queue.length > 0) {
    const { childId, skipSourceId } = queue.shift()!;
    const child = dag.nodes.find((n) => n.id === childId);
    if (!child || child.status === "done" || child.status === "running" || child.status === "skipped") continue;
    if (!dependsOnRequiredOutput(child, skipSourceId)) continue;
    child.status = "skipped";
    child.blockedReason = `dependency skipped: ${id}`;
    for (const next of dag.nodes) {
      if (next.dependsOn.includes(childId)) queue.push({ childId: next.id, skipSourceId: childId });
    }
  }
}

function validateNodeDefinition(node: DagNodeDefinition): void {
  if (!Number.isInteger(node.maxRetries) || node.maxRetries < 1) {
    throw new TypeError(`DAG node "${node.id}" maxRetries must be a positive integer`);
  }
  if (node.priority !== undefined && !Number.isFinite(node.priority)) {
    throw new TypeError(`DAG node "${node.id}" priority must be finite when provided`);
  }
  if (node.cost !== undefined && ![1, 2, 3].includes(node.cost)) {
    throw new TypeError(`DAG node "${node.id}" cost must be 1, 2, or 3 when provided`);
  }
}

function validateInputDependencies(nodes: DagNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const input of node.inputs ?? []) {
      if (!input.from || !ids.has(input.from)) continue;
      if (!node.dependsOn.includes(input.from)) {
        throw new Error(`DAG hidden dependency: node "${node.id}" input "${input.name}" references "${input.from}" but dependsOn does not include it`);
      }
    }
  }
}

function blockDependents(dag: Dag, failedId: string, reason: string): void {
  const nodeById = new Map(dag.nodes.map((node) => [node.id, node]));
  const queue: Array<{ id: string; blockerId: string }> = dag.nodes
    .filter((node) => node.dependsOn.includes(failedId))
    .map((node) => ({ id: node.id, blockerId: failedId }));

  while (queue.length > 0) {
    const { id, blockerId } = queue.shift()!;
    const node = nodeById.get(id);
    if (!node || node.status === "done" || node.status === "running" || node.status === "blocked") continue;
    if (node.failurePolicy?.blockDependents === false) continue;
    if (blockerId === failedId && !dependsOnRequiredOutput(node, failedId)) continue;
    node.status = "blocked";
    node.blockedReason = reason;
    for (const child of dag.nodes) {
      if (child.dependsOn.includes(id)) queue.push({ id: child.id, blockerId: id });
    }
  }
}

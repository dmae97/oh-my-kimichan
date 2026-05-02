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
        blockDependents(dag, id, `dependency failed: ${id}`);
      }
    }
  }
}

export function isDagComplete(dag: Dag): boolean {
  return dag.nodes.every((n) => n.status === "done" || n.status === "skipped");
}

export function isDagFailed(dag: Dag): boolean {
  return dag.nodes.some((n) => n.status === "blocked" || (n.status === "failed" && n.retries >= n.maxRetries));
}

export function skipNode(dag: Dag, id: string): void {
  const node = getNodeById(dag, id);
  if (!node || node.status === "done" || node.status === "running") return;
  node.status = "skipped";
  node.blockedReason = `skipped because ${id} was skipped or failed with skipOnFailure`;
  const queue = dag.nodes.filter((n) => n.dependsOn.includes(id)).map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const childId = queue.shift()!;
    if (seen.has(childId)) continue;
    seen.add(childId);
    const child = dag.nodes.find((n) => n.id === childId);
    if (!child || child.status === "done" || child.status === "running" || child.status === "skipped") continue;
    const hasOtherPendingDeps = child.dependsOn.some((depId) => {
      const dep = dag.nodes.find((n) => n.id === depId);
      return dep && dep.status !== "done" && dep.status !== "skipped";
    });
    if (hasOtherPendingDeps) continue;
    child.status = "skipped";
    child.blockedReason = `dependency skipped: ${id}`;
    for (const next of dag.nodes) {
      if (next.dependsOn.includes(childId)) queue.push(next.id);
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
  const queue = dag.nodes.filter((node) => node.dependsOn.includes(failedId)).map((node) => node.id);
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById.get(id);
    if (!node || node.status === "done" || node.status === "running" || node.status === "blocked") continue;
    if (node.failurePolicy?.blockDependents === false) continue;
    node.status = "blocked";
    node.blockedReason = reason;
    for (const child of dag.nodes) {
      if (child.dependsOn.includes(id)) queue.push(child.id);
    }
  }
}

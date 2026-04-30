import { TaskDagGraph } from "./task-graph.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked";

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
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempts?: DagNodeAttempt[];
}

export interface Dag {
  nodes: DagNode[];
}

export function createDag(def: { nodes: Omit<DagNode, "status" | "retries">[] }): Dag {
  const nodes = def.nodes.map((n) => ({
    ...n,
    status: "pending" as const,
    retries: 0,
  }));
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
      }
    }
  }
}

export function isDagComplete(dag: Dag): boolean {
  return dag.nodes.every((n) => n.status === "done");
}

export function isDagFailed(dag: Dag): boolean {
  return dag.nodes.some((n) => n.status === "failed" && n.retries >= n.maxRetries);
}

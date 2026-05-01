import type { Dag, DagNode, TaskStatus } from "./dag.js";
import { getTaskDagGraph } from "./task-graph.js";

export interface Scheduler {
  getRunnableNodes(dag: Dag): DagNode[];
  updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void;
  isComplete(dag: Dag): boolean;
  isFailed(dag: Dag): boolean;
  getNodeStatus(dag: Dag, id: string): TaskStatus | undefined;
}

export function createScheduler(): Scheduler {
  return {
    getRunnableNodes(dag: Dag): DagNode[] {
      return getTaskDagGraph(dag).runnableNodes().slice();
    },

    updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void {
      const node = getTaskDagGraph(dag).getNode(id);
      if (!node) return;

      node.status = status;

      if (status === "failed") {
        node.retries += 1;
        if (node.retries < node.maxRetries) {
          node.status = "pending";
        } else {
          blockDependents(dag, node.id, `dependency failed: ${node.id}`);
        }
      }
    },

    isComplete(dag: Dag): boolean {
      return dag.nodes.every((n) => n.status === "done");
    },

    isFailed(dag: Dag): boolean {
      return dag.nodes.some((n) => n.status === "blocked" || (n.status === "failed" && n.retries >= n.maxRetries));
    },

    getNodeStatus(dag: Dag, id: string): TaskStatus | undefined {
      return getTaskDagGraph(dag).getNode(id)?.status;
    },
  };
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
    if (!node || node.status === "done" || node.status === "running") continue;
    if (node.failurePolicy?.blockDependents === false) continue;
    node.status = "blocked";
    node.blockedReason = reason;
    for (const child of dag.nodes) {
      if (child.dependsOn.includes(id)) queue.push(child.id);
    }
  }
}

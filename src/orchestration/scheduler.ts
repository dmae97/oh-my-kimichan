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
      return getTaskDagGraph(dag).runnableNodes();
    },

    updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void {
      const node = getTaskDagGraph(dag).getNode(id);
      if (!node) return;

      node.status = status;

      if (status === "failed") {
        node.retries += 1;
        if (node.retries < node.maxRetries) {
          node.status = "pending";
        }
      }
    },

    isComplete(dag: Dag): boolean {
      return dag.nodes.every((n) => n.status === "done");
    },

    isFailed(dag: Dag): boolean {
      return dag.nodes.some((n) => n.status === "failed" && n.retries >= n.maxRetries);
    },

    getNodeStatus(dag: Dag, id: string): TaskStatus | undefined {
      return getTaskDagGraph(dag).getNode(id)?.status;
    },
  };
}

import type { Dag, DagNode, TaskStatus } from "./dag.js";

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
      return dag.nodes.filter((n) => {
        if (n.status !== "pending") return false;
        const deps = dag.nodes.filter((d) => n.dependsOn.includes(d.id));
        return deps.every((d) => d.status === "done");
      });
    },

    updateNodeStatus(dag: Dag, id: string, status: TaskStatus): void {
      const node = dag.nodes.find((n) => n.id === id);
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
      return dag.nodes.find((n) => n.id === id)?.status;
    },
  };
}

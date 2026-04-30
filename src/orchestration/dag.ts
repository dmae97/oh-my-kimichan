export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked";

export interface DagNode {
  id: string;
  name: string;
  role: string;
  dependsOn: string[];
  status: TaskStatus;
  worktree?: string;
  retries: number;
  maxRetries: number;
}

export interface Dag {
  nodes: DagNode[];
}

export function createDag(def: { nodes: Omit<DagNode, "status" | "retries">[] }): Dag {
  return {
    nodes: def.nodes.map((n) => ({
      ...n,
      status: "pending",
      retries: 0,
    })),
  };
}

export function getRunnableNodes(dag: Dag): DagNode[] {
  return dag.nodes.filter((n) => {
    if (n.status !== "pending") return false;
    const deps = dag.nodes.filter((d) => n.dependsOn.includes(d.id));
    return deps.every((d) => d.status === "done");
  });
}

export function getNodeById(dag: Dag, id: string): DagNode | undefined {
  return dag.nodes.find((n) => n.id === id);
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

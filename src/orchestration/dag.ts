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
  // 순환 의존성 감지
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const nodeMap = new Map(def.nodes.map((n) => [n.id, n]));

  function visit(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const cycle = path.slice(path.indexOf(id)).concat(id).join(" -> ");
      throw new Error(`DAG circular dependency detected: ${cycle}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        if (!nodeMap.has(dep)) {
          throw new Error(`DAG missing dependency: node "${id}" depends on unknown "${dep}"`);
        }
        visit(dep, [...path, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const n of def.nodes) {
    visit(n.id, []);
  }

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

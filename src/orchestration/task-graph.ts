import type { Dag, DagNode } from "./dag.js";

export class TaskDagGraph {
  private readonly nodeById = new Map<string, DagNode>();
  private readonly predecessorIds = new Map<string, string[]>();
  private readonly successorIds = new Map<string, string[]>();
  private readonly order = new Map<string, number>();
  private topologicalIds?: string[];

  constructor(nodes: DagNode[]) {
    nodes.forEach((node, index) => {
      if (this.nodeById.has(node.id)) {
        throw new Error(`DAG duplicate node id: ${node.id}`);
      }
      this.nodeById.set(node.id, node);
      this.predecessorIds.set(node.id, [...node.dependsOn]);
      this.successorIds.set(node.id, []);
      this.order.set(node.id, index);
    });

    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!this.nodeById.has(dep)) {
          throw new Error(`DAG missing dependency: node "${node.id}" depends on unknown "${dep}"`);
        }
        this.successorIds.get(dep)?.push(node.id);
      }
    }

    // Validate once up front. The cached order is reused by the scheduler.
    this.topologicalOrder();
  }

  getNode(id: string): DagNode | undefined {
    return this.nodeById.get(id);
  }

  predecessors(id: string): DagNode[] {
    return (this.predecessorIds.get(id) ?? [])
      .map((depId) => this.nodeById.get(depId))
      .filter((node): node is DagNode => node !== undefined);
  }

  successors(id: string): DagNode[] {
    return (this.successorIds.get(id) ?? [])
      .map((nodeId) => this.nodeById.get(nodeId))
      .filter((node): node is DagNode => node !== undefined);
  }

  topologicalOrder(): DagNode[] {
    if (!this.topologicalIds) {
      this.topologicalIds = this.computeTopologicalIds();
    }
    return this.topologicalIds
      .map((id) => this.nodeById.get(id))
      .filter((node): node is DagNode => node !== undefined);
  }

  runnableNodes(): DagNode[] {
    return this.topologicalOrder().filter((node) => (
      node.status === "pending" && this.predecessors(node.id).every((dep) => dep.status === "done")
    ));
  }

  private computeTopologicalIds(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodeById.keys()) {
      inDegree.set(id, this.predecessorIds.get(id)?.length ?? 0);
    }

    const queue = [...inDegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort((a, b) => this.compareOrder(a, b));
    const result: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);
      for (const successor of this.successorIds.get(id) ?? []) {
        const nextDegree = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, nextDegree);
        if (nextDegree === 0) {
          queue.push(successor);
          queue.sort((a, b) => this.compareOrder(a, b));
        }
      }
    }

    if (result.length !== this.nodeById.size) {
      throw new Error(`DAG circular dependency detected: ${this.findCycle().join(" -> ")}`);
    }

    return result;
  }

  private findCycle(): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
      if (visiting.has(id)) {
        return [...stack.slice(stack.indexOf(id)), id];
      }
      if (visited.has(id)) return null;

      visiting.add(id);
      stack.push(id);
      for (const next of this.successorIds.get(id) ?? []) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      return null;
    };

    for (const id of this.nodeById.keys()) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
    return ["unknown"];
  }

  private compareOrder(a: string, b: string): number {
    return (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0);
  }
}

const GRAPH_CACHE = new WeakMap<Dag, TaskDagGraph>();

export function getTaskDagGraph(dag: Dag): TaskDagGraph {
  let graph = GRAPH_CACHE.get(dag);
  if (!graph) {
    graph = new TaskDagGraph(dag.nodes);
    GRAPH_CACHE.set(dag, graph);
  }
  return graph;
}

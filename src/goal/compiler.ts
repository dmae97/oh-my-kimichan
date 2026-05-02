import type { DagNodeDefinition } from "../orchestration/dag.js";
import type { RunState } from "../contracts/orchestration.js";
import type { GoalSpec } from "../contracts/goal.js";

export function compileGoalToDagNodes(goal: GoalSpec): DagNodeDefinition[] {
  const nodes: DagNodeDefinition[] = [
    {
      id: "bootstrap",
      name: `Prepare goal run: ${goal.title}`,
      role: "omk",
      dependsOn: [],
      maxRetries: 1,
    },
    {
      id: "goal-coordinator",
      name: `Coordinate: ${goal.title}`,
      role: "orchestrator",
      dependsOn: ["bootstrap"],
      maxRetries: 1,
      outputs: [{ name: "execution plan", gate: "summary" }],
      routing: { evidenceRequired: true },
    },
  ];

  // Map expected artifacts to artifact nodes
  const artifactNodes: DagNodeDefinition[] = goal.expectedArtifacts.map((artifact, index) => ({
    id: `artifact-${index + 1}`,
    name: `Produce artifact: ${artifact.name}`,
    role: "coder",
    dependsOn: ["goal-coordinator"],
    maxRetries: 2,
    outputs: [
      {
        name: artifact.name,
        ref: artifact.path,
        gate: artifact.gate ?? "summary",
      },
    ],
    routing: { evidenceRequired: true },
  }));

  if (artifactNodes.length > 0) {
    nodes.push(...artifactNodes);
  }

  // Add a verify node that depends on all artifact nodes (or coordinator if no artifacts)
  const verifyDeps = artifactNodes.length > 0 ? artifactNodes.map((n) => n.id) : ["goal-coordinator"];
  nodes.push({
    id: "goal-verify",
    name: `Verify goal success criteria: ${goal.title}`,
    role: "reviewer",
    dependsOn: verifyDeps,
    maxRetries: 1,
    outputs: [{ name: "verification report", gate: "review-pass" }],
    routing: { evidenceRequired: true },
  });

  return nodes;
}

export function attachGoalToRunState(runState: RunState, goal: GoalSpec): RunState {
  return {
    ...runState,
    schemaVersion: 1,
    goalId: goal.goalId,
    goalSnapshot: {
      title: goal.title,
      objective: goal.objective,
      successCriteria: goal.successCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        requirement: c.requirement,
      })),
    },
  };
}

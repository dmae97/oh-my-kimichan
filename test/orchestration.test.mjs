import test from "node:test";
import assert from "node:assert/strict";

import { createDag } from "../dist/orchestration/dag.js";
import { createScheduler } from "../dist/orchestration/scheduler.js";
import { createEnsembleTaskRunner } from "../dist/orchestration/ensemble.js";
import { createExecutor } from "../dist/orchestration/executor.js";
import { estimateRunProgress } from "../dist/orchestration/eta.js";

test("task graph returns runnable nodes in deterministic topological order", () => {
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
      { id: "review", name: "Review", role: "reviewer", dependsOn: ["code"], maxRetries: 1 },
    ],
  });
  const scheduler = createScheduler();

  assert.deepEqual(scheduler.getRunnableNodes(dag).map((node) => node.id), ["plan"]);
  scheduler.updateNodeStatus(dag, "plan", "done");
  assert.deepEqual(scheduler.getRunnableNodes(dag).map((node) => node.id), ["code"]);
});

test("task graph rejects cycles with a useful error", () => {
  assert.throws(
    () => createDag({
      nodes: [
        { id: "a", name: "A", role: "planner", dependsOn: ["b"], maxRetries: 1 },
        { id: "b", name: "B", role: "coder", dependsOn: ["a"], maxRetries: 1 },
      ],
    }),
    /circular dependency/
  );
});

test("ensemble runner calls role-specific candidates and aggregates quorum", async () => {
  const calls = [];
  const baseRunner = {
    async run(node, env) {
      calls.push({ node, env });
      return {
        success: env.OMK_ENSEMBLE_CANDIDATE_ID !== "edge-cases",
        stdout: `candidate=${env.OMK_ENSEMBLE_CANDIDATE_ID}\nconfidence: 0.9`,
        stderr: "",
      };
    },
  };
  const runner = createEnsembleTaskRunner(baseRunner, {
    enabled: true,
    maxCandidatesPerNode: 2,
    maxParallel: 1,
    quorumRatio: 0.5,
  });

  const result = await runner.run(
    { id: "node-1", name: "Implement", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 1 },
    { OMK_RUN_ID: "test" }
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.env.OMK_ENSEMBLE_CANDIDATE_ID), ["implement", "edge-cases"]);
  assert.match(result.stdout, /OMK Ensemble Result/);
  assert.equal(result.metadata.ensemble.winner, "implement");
});

test("ensemble runner tolerates one candidate throwing when quorum still passes", async () => {
  const baseRunner = {
    async run(node, env) {
      if (env.OMK_ENSEMBLE_CANDIDATE_ID === "edge-cases") {
        throw new Error("candidate crashed");
      }
      return {
        success: true,
        stdout: `candidate=${env.OMK_ENSEMBLE_CANDIDATE_ID}\nconfidence: 0.8`,
        stderr: "",
      };
    },
  };
  const runner = createEnsembleTaskRunner(baseRunner, {
    enabled: true,
    maxCandidatesPerNode: 2,
    maxParallel: 1,
    quorumRatio: 0.5,
  });

  const result = await runner.run(
    { id: "node-2", name: "Implement", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 1 },
    { OMK_RUN_ID: "test" }
  );

  assert.equal(result.success, true);
  assert.match(result.stderr, /\[edge-cases] candidate crashed/);
  assert.equal(result.metadata.ensemble.winner, "implement");
});

test("ETA estimator uses completed durations and worker count", () => {
  const estimate = estimateRunProgress({
    startedAt: "2026-05-01T00:00:00.000Z",
    now: new Date("2026-05-01T00:00:05.000Z"),
    workerCount: 2,
    nodes: [
      {
        id: "plan",
        name: "Plan",
        role: "planner",
        dependsOn: [],
        status: "done",
        retries: 0,
        maxRetries: 1,
        durationMs: 1000,
      },
      {
        id: "code",
        name: "Code",
        role: "coder",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
      {
        id: "review",
        name: "Review",
        role: "reviewer",
        dependsOn: [],
        status: "pending",
        retries: 0,
        maxRetries: 1,
      },
    ],
  });

  assert.equal(estimate.averageCompletedDurationMs, 1000);
  assert.equal(estimate.estimatedRemainingMs, 1000);
  assert.equal(estimate.percentComplete, 33);
  assert.equal(estimate.confidence, "medium");
});

test("executor records agent timings and passes ETA environment", async () => {
  const savedStates = [];
  const seenEnv = [];
  const executor = createExecutor({
    ensemble: false,
    persister: {
      async load() {
        return null;
      },
      async save(state) {
        savedStates.push(JSON.parse(JSON.stringify(state)));
      },
    },
  });
  const dag = createDag({
    nodes: [
      { id: "plan", name: "Plan", role: "planner", dependsOn: [], maxRetries: 1 },
      { id: "code", name: "Code", role: "coder", dependsOn: ["plan"], maxRetries: 1 },
    ],
  });
  const runner = {
    async run(_node, env) {
      seenEnv.push({ ...env });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { success: true, stdout: "", stderr: "" };
    },
  };

  const result = await executor.execute(dag, runner, {
    runId: "eta-test",
    workers: 1,
    approvalPolicy: "yolo",
  });

  assert.equal(result.success, true);
  assert.equal(result.state.estimate.completedNodes, 2);
  assert.equal(result.state.estimate.estimatedRemainingMs, 0);
  assert.ok(result.state.nodes.every((node) => typeof node.startedAt === "string"));
  assert.ok(result.state.nodes.every((node) => typeof node.completedAt === "string"));
  assert.ok(result.state.nodes.every((node) => typeof node.durationMs === "number"));
  assert.ok(result.state.nodes.every((node) => node.attempts?.length === 1));
  assert.ok(seenEnv.every((env) => typeof env.OMK_ETA_REMAINING_MS === "string"));
  assert.ok(savedStates.some((state) => state.estimate?.runningNodes === 1));
});

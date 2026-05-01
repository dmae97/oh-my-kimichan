import type { Dag, DagNode } from "./dag.js";
import type { DagExecutor, RunOptions, RunProgressEstimate, RunResult, RunState, TaskRunner, TaskResult } from "../contracts/orchestration.js";
import { createScheduler } from "./scheduler.js";
import type { StatePersister } from "./state-persister.js";
import { createStatePersister } from "./state-persister.js";
import { createEnsembleTaskRunner, type EnsemblePolicy } from "./ensemble.js";
import { estimateRunProgress } from "./eta.js";
import { dagNodeRoutingEnv } from "./routing.js";

export interface ExecutorOptions {
  persister?: StatePersister;
  ensemble?: false | EnsemblePolicy;
}

export function createExecutor(executorOptions: ExecutorOptions = {}): DagExecutor {
  const scheduler = createScheduler();
  const persister = executorOptions.persister ?? createStatePersister();
  const stateChangeHandlers: Array<(state: RunState) => void> = [];
  const nodeStartHandlers: Array<(node: DagNode) => void> = [];
  const nodeCompleteHandlers: Array<(node: DagNode, result: TaskResult) => void> = [];
  let commitQueue: Promise<void> = Promise.resolve();
  let commitQueueDepth = 0;
  const MAX_COMMIT_QUEUE_DEPTH = 10;

  function buildState(dag: Dag, options: RunOptions): RunState {
    const startedAt = new Date().toISOString();
    return {
      runId: options.runId,
      nodes: dag.nodes.map((n) => ({ ...n })),
      startedAt,
      estimate: estimateRunProgress({
        nodes: dag.nodes,
        startedAt,
        workerCount: options.workers,
      }),
    };
  }

  function refreshState(state: RunState, dag: Dag, options: RunOptions): void {
    state.nodes = dag.nodes.map((n) => ({ ...n, attempts: n.attempts?.map((attempt) => ({ ...attempt })) }));
    state.estimate = estimateRunProgress({
      nodes: dag.nodes,
      startedAt: state.startedAt,
      workerCount: options.workers,
    });
  }

  function cloneState(state: RunState): RunState {
    return {
      ...state,
      nodes: state.nodes.map((n) => ({ ...n, attempts: n.attempts?.map((attempt) => ({ ...attempt })) })),
      estimate: state.estimate ? { ...state.estimate } : undefined,
    };
  }

  async function commitState(state: RunState): Promise<void> {
    const snapshot = cloneState(state);
    if (commitQueueDepth >= MAX_COMMIT_QUEUE_DEPTH) {
      emit(snapshot);
      return;
    }
    commitQueueDepth++;
    commitQueue = commitQueue
      .then(async () => {
        await persister.save(snapshot);
        emit(snapshot);
      })
      .catch(() => {
        // swallow persist/emit errors so chain continues
      })
      .finally(() => {
        commitQueueDepth--;
      });
    await commitQueue;
  }

  function emit(state: RunState): void {
    for (const h of stateChangeHandlers) {
      try {
        h(state);
      } catch {
        // ignore handler errors
      }
    }
  }

  function markNodeStarted(node: DagNode): void {
    const startedAt = new Date().toISOString();
    const attemptNumber = node.retries + 1;
    node.startedAt = startedAt;
    node.completedAt = undefined;
    node.durationMs = undefined;
    const attempts = node.attempts ?? [];
    attempts.push({ attempt: attemptNumber, startedAt });
    node.attempts = attempts;
  }

  function markNodeFinished(node: DagNode, status: "done" | "failed"): void {
    const completedAt = new Date().toISOString();
    const startedAtMs = Date.parse(node.startedAt ?? completedAt);
    const completedAtMs = Date.parse(completedAt);
    const durationMs = Math.max(0, completedAtMs - startedAtMs);
    const latestAttempt = node.attempts?.[node.attempts.length - 1];

    if (latestAttempt) {
      latestAttempt.completedAt = completedAt;
      latestAttempt.durationMs = durationMs;
      latestAttempt.status = status;
    }

    if (status === "done") {
      node.completedAt = completedAt;
      node.durationMs = durationMs;
    }
  }

  function etaEnv(estimate: RunProgressEstimate | undefined): Record<string, string> {
    if (!estimate) return {};
    return {
      OMK_ETA_REMAINING_MS: String(estimate.estimatedRemainingMs ?? 0),
      OMK_ETA_COMPLETED_AT: estimate.estimatedCompletedAt ?? "",
      OMK_ETA_CONFIDENCE: estimate.confidence,
      OMK_PROGRESS_PERCENT: String(estimate.percentComplete),
      OMK_PROGRESS_NODES: `${estimate.completedNodes}/${estimate.totalNodes}`,
    };
  }

  function emitNodeStart(node: DagNode): void {
    for (const h of nodeStartHandlers) {
      try { h(node); } catch { /* ignore */ }
    }
  }

  function emitNodeComplete(node: DagNode, result: TaskResult): void {
    for (const h of nodeCompleteHandlers) {
      try { h(node, result); } catch { /* ignore */ }
    }
  }

  async function runNode(
    node: DagNode,
    dag: Dag,
    runner: TaskRunner,
    options: RunOptions,
    state: RunState
  ): Promise<void> {
    scheduler.updateNodeStatus(dag, node.id, "running");
    markNodeStarted(node);
    refreshState(state, dag, options);
    await commitState(state);
    emitNodeStart(node);

    const env: Record<string, string> = {
      OMK_NODE_ID: node.id,
      OMK_RUN_ID: options.runId,
      OMK_ROLE: node.role,
      ...dagNodeRoutingEnv(node),
      ...etaEnv(state.estimate),
    };

    let result: TaskResult;
    node.thinking = undefined;

    // Wire live thinking from runner into the node so parallel UI can surface it.
    const originalOnThinking = runner.onThinking;
    runner.onThinking = (thinking: string) => {
      node.thinking = thinking;
    };

    // Sync thinking back to state.nodes periodically so the live UI
    // can show ensemble / runner progress while the node is running.
    const progressTimer = setInterval(() => {
      const stateNode = state.nodes.find((sn) => sn.id === node.id);
      if (stateNode) stateNode.thinking = node.thinking;
      emit(cloneState(state));
    }, 500);

    const nodeTimeoutMs = options.nodeTimeoutMs ?? 0;
    try {
      const runPromise = runner.run(node, env);
      if (nodeTimeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Node ${node.id} timed out after ${nodeTimeoutMs}ms`)), nodeTimeoutMs);
        });
        result = await Promise.race([runPromise, timeoutPromise]);
      } else {
        result = await runPromise;
      }
      if (result.success) {
        markNodeFinished(node, "done");
        scheduler.updateNodeStatus(dag, node.id, "done");
      } else {
        markNodeFinished(node, "failed");
        scheduler.updateNodeStatus(dag, node.id, "failed");
      }
    } catch (error: unknown) {
      result = {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      markNodeFinished(node, "failed");
      scheduler.updateNodeStatus(dag, node.id, "failed");
    } finally {
      clearInterval(progressTimer);
      runner.onThinking = originalOnThinking;
      const stateNode = state.nodes.find((sn) => sn.id === node.id);
      if (stateNode) stateNode.thinking = node.thinking;
    }

    emitNodeComplete(node, result);
    refreshState(state, dag, options);
    await commitState(state);
  }

  return {
    onStateChange(handler: (state: RunState) => void): () => void {
      stateChangeHandlers.push(handler);
      return () => {
        const idx = stateChangeHandlers.indexOf(handler);
        if (idx !== -1) stateChangeHandlers.splice(idx, 1);
      };
    },

    onNodeStart(handler: (node: DagNode) => void): () => void {
      nodeStartHandlers.push(handler);
      return () => {
        const idx = nodeStartHandlers.indexOf(handler);
        if (idx !== -1) nodeStartHandlers.splice(idx, 1);
      };
    },

    onNodeComplete(handler: (node: DagNode, result: TaskResult) => void): () => void {
      nodeCompleteHandlers.push(handler);
      return () => {
        const idx = nodeCompleteHandlers.indexOf(handler);
        if (idx !== -1) nodeCompleteHandlers.splice(idx, 1);
      };
    },

    async execute(dag: Dag, runner: TaskRunner, options: RunOptions): Promise<RunResult> {
      if (!Number.isFinite(options.workers) || options.workers < 1) {
        throw new TypeError(`options.workers must be a positive integer, got ${options.workers}`);
      }
      const effectiveRunner = executorOptions.ensemble === false
        ? runner
        : createEnsembleTaskRunner(runner, executorOptions.ensemble ?? {});
      const state = buildState(dag, options);
      await commitState(state);

      const runningMap = new Map<string, Promise<void>>();
      let resolveDone: (value: RunResult) => void;
      const donePromise = new Promise<RunResult>((resolve) => {
        resolveDone = resolve;
      });

      async function tick(): Promise<void> {
        if (scheduler.isComplete(dag)) {
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state);
          resolveDone({ state, success: true });
          return;
        }

        if (scheduler.isFailed(dag)) {
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state);
          resolveDone({ state, success: false });
          return;
        }

        const runnable = scheduler.getRunnableNodes(dag);
        const availableSlots = Math.max(0, options.workers - runningMap.size);
        const toRun = runnable
          .filter((node) => !runningMap.has(node.id))
          .slice(0, availableSlots);

        for (const node of toRun) {
          const promise = runNode(node, dag, effectiveRunner, options, state)
            .catch(() => {
              // runNode already marks node as failed on runner errors;
              // swallow persist/emit errors to allow tick() to continue
            })
            .finally(() => {
              runningMap.delete(node.id);
              void tick();
            });
          runningMap.set(node.id, promise);
        }

        if (runningMap.size === 0 && toRun.length === 0 && runnable.length === 0) {
          // Deadlock or nothing to do — treat as failure
          state.completedAt = new Date().toISOString();
          refreshState(state, dag, options);
          await commitState(state);
          resolveDone({ state, success: false });
        }
      }

      void tick();
      return donePromise;
    },
  };
}

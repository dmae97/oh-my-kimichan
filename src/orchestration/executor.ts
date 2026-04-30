import type { Dag, DagNode } from "./dag.js";
import type { DagExecutor, RunOptions, RunResult, RunState, TaskRunner } from "../contracts/orchestration.js";
import { createScheduler } from "./scheduler.js";
import type { StatePersister } from "./state-persister.js";
import { createStatePersister } from "./state-persister.js";

export interface ExecutorOptions {
  persister?: StatePersister;
}

export function createExecutor(executorOptions: ExecutorOptions = {}): DagExecutor {
  const scheduler = createScheduler();
  const persister = executorOptions.persister ?? createStatePersister();
  const stateChangeHandlers: Array<(state: RunState) => void> = [];

  function buildState(dag: Dag, options: RunOptions): RunState {
    return {
      runId: options.runId,
      nodes: dag.nodes.map((n) => ({ ...n })),
      startedAt: new Date().toISOString(),
    };
  }

  async function persist(state: RunState): Promise<void> {
    await persister.save(state);
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

  async function runNode(
    node: DagNode,
    dag: Dag,
    runner: TaskRunner,
    options: RunOptions,
    state: RunState
  ): Promise<void> {
    scheduler.updateNodeStatus(dag, node.id, "running");
    state.nodes = dag.nodes.map((n) => ({ ...n }));
    await persist(state);
    emit(state);

    const env: Record<string, string> = {
      OMK_NODE_ID: node.id,
      OMK_RUN_ID: options.runId,
      OMK_ROLE: node.role,
    };

    try {
      const result = await runner.run(node, env);
      if (result.success) {
        scheduler.updateNodeStatus(dag, node.id, "done");
      } else {
        scheduler.updateNodeStatus(dag, node.id, "failed");
      }
    } catch {
      scheduler.updateNodeStatus(dag, node.id, "failed");
    }

    state.nodes = dag.nodes.map((n) => ({ ...n }));
    await persist(state);
    emit(state);
  }

  return {
    onStateChange(handler: (state: RunState) => void): () => void {
      stateChangeHandlers.push(handler);
      return () => {
        const idx = stateChangeHandlers.indexOf(handler);
        if (idx !== -1) stateChangeHandlers.splice(idx, 1);
      };
    },

    async execute(dag: Dag, runner: TaskRunner, options: RunOptions): Promise<RunResult> {
      if (!Number.isFinite(options.workers) || options.workers < 1) {
        throw new TypeError(`options.workers must be a positive integer, got ${options.workers}`);
      }
      const state = buildState(dag, options);
      await persist(state);
      emit(state);

      const running = new Set<Promise<void>>();
      let resolveDone: (value: RunResult) => void;
      const donePromise = new Promise<RunResult>((resolve) => {
        resolveDone = resolve;
      });

      async function tick(): Promise<void> {
        if (scheduler.isComplete(dag)) {
          state.completedAt = new Date().toISOString();
          await persist(state);
          emit(state);
          resolveDone({ state, success: true });
          return;
        }

        if (scheduler.isFailed(dag)) {
          state.completedAt = new Date().toISOString();
          await persist(state);
          emit(state);
          resolveDone({ state, success: false });
          return;
        }

        const runnable = scheduler.getRunnableNodes(dag);
        const availableSlots = Math.max(0, options.workers - running.size);
        const toRun = runnable.slice(0, availableSlots);

        for (const node of toRun) {
          const promise = runNode(node, dag, runner, options, state)
            .catch(() => {
              // runNode already marks node as failed on runner errors;
              // swallow persist/emit errors to allow tick() to continue
            })
            .finally(() => {
              running.delete(promise);
              void tick();
            });
          running.add(promise);
        }

        if (running.size === 0 && toRun.length === 0 && runnable.length === 0) {
          // Deadlock or nothing to do — treat as failure
          state.completedAt = new Date().toISOString();
          await persist(state);
          emit(state);
          resolveDone({ state, success: false });
        }
      }

      void tick();
      return donePromise;
    },
  };
}

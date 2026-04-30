# Worker B Manifest: Engine Layer

## Identity
- **Role:** Engine Worker
- **Phase:** 1 (Parallel with Platform)
- **Worktree:** `.omk/worktrees/engine`
- **Branch:** `work/engine`

## Owned Files (Read/Write)
```
src/orchestration/
  dag.ts              (modify)
  executor.ts         (new)
  scheduler.ts        (new)
  state-persister.ts  (new)
src/kimi/
  wire-client.ts      (modify)
src/safety/
  approval-policy.ts  (modify)
  guard-hooks.ts      (new)
```

## Forbidden Files (Import-Only)
- `src/cli.ts`
- `src/commands/*.ts`
- `src/util/*.ts`
- `src/mcp/*.ts`
- `src/memory/*.ts`

## Contract Imports (Read-Only)
- `src/contracts/orchestration.ts`
- `src/contracts/safety.ts`
- `src/contracts/hud.ts`

## Goal
Build the core execution engine that turns the existing DAG data structure into an actual parallel task executor.

## Acceptance Criteria
1. `src/orchestration/executor.ts` exports `createExecutor(): DagExecutor`
2. Executor runs DAG nodes in parallel up to `options.workers` concurrency
3. Executor persists state to `.omk/runs/<id>/state.json` after each node completion
4. `src/orchestration/scheduler.ts` manages runnable node queue with dependency resolution
5. `src/kimi/wire-client.ts` implements `TaskRunner` contract (or adapter exported)
6. `src/safety/approval-policy.ts` implements `PolicyEngine` contract
7. `src/safety/guard-hooks.ts` provides Node.js equivalent of bash shell guards
8. `npm run check` passes in this worktree

## Integration Contract
- Worker A (Commands) will import `createExecutor` from `src/orchestration/executor.ts`
- Worker C (Platform) will provide `createWorktree()` and `getRunDir()` via `src/util/*`
- Do NOT modify `src/commands/run.ts` — Worker A handles the integration

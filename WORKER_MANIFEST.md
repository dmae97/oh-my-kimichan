# Worker C Manifest: Platform Layer

## Identity
- **Role:** Platform Worker
- **Phase:** 1 (Parallel with Engine)
- **Worktree:** `.omk/worktrees/platform`
- **Branch:** `work/platform`

## Owned Files (Read/Write)
```
src/util/
  fs.ts
  shell.ts
  git.ts
  theme.ts
  kimi-runner.ts
  kimi-usage.ts
src/util/worktree.ts      (new)
src/util/run-dir.ts       (new)
src/memory/memory-store.ts
src/mcp/omk-project-server.ts
```

## Forbidden Files (Import-Only)
- `src/cli.ts`
- `src/commands/*.ts`
- `src/orchestration/*.ts`
- `src/kimi/*.ts`
- `src/safety/*.ts`

## Contract Imports (Read-Only)
- `src/contracts/orchestration.ts`
- `src/contracts/safety.ts`
- `src/contracts/hud.ts`

## Goal
Enhance the platform layer with worktree management, run directory utilities, streaming shell execution, and expanded MCP tools.

## Acceptance Criteria
1. `src/util/worktree.ts` exports `createWorktree(runId, nodeId): Promise<string>`
2. `src/util/run-dir.ts` exports `getRunDir(runId): string` and `writeRunState(runId, state)`
3. `src/util/shell.ts` adds `runShellStreaming()` with line-by-line callbacks
4. `src/util/git.ts` adds `listWorktrees()`, `removeWorktree(path)`
5. `src/util/kimi-runner.ts` exports a `TaskRunner`-compatible adapter function
6. `src/mcp/omk-project-server.ts` adds tools: `omk_list_worktrees`, `omk_run_quality_gate`
7. All existing util APIs remain backward-compatible
8. `npm run check` passes in this worktree

## Integration Contract
- Worker B (Engine) will import worktree/run-dir utilities
- Worker A (Commands) will use `runShellStreaming` for HUD live logs
- Do NOT modify `src/orchestration/*` or `src/kimi/*`

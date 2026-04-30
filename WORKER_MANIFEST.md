# Integration Manifest

## Merged Workers

| Worker | Branch | Status |
|--------|--------|--------|
| B Engine | `work/engine` | Merged |
| C Platform | `work/platform` | Merged |

## Files Added

### Contracts (Phase 0)
- `src/contracts/orchestration.ts`
- `src/contracts/safety.ts`
- `src/contracts/hud.ts`

### Engine (Worker B)
- `src/orchestration/executor.ts`
- `src/orchestration/scheduler.ts`
- `src/orchestration/state-persister.ts`
- `src/safety/guard-hooks.ts`

### Platform (Worker C)
- `src/util/worktree.ts`
- `src/util/run-dir.ts`
- `src/util/kimi-runner.ts` — combined with existing `runKimiInteractive`

### Modified
- `src/kimi/wire-client.ts` — `createKimiTaskRunner`
- `src/safety/approval-policy.ts` — `createPolicyEngine`
- `src/util/shell.ts` — `runShellStreaming`
- `src/util/git.ts` — `removeWorktree`
- `src/util/fs.ts` — `getRunPath`
- `src/memory/memory-store.ts` — `readRunMemory`, `writeRunMemory`
- `src/mcp/omk-project-server.ts` — `omk_list_worktrees`, `omk_run_quality_gate`

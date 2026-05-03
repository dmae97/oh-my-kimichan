# Changelog

## v1.0.0 — Kimi-native orchestration & chat harness (2025-05-03)

OMK reaches 1.0 as a stable Kimi CLI orchestration and chat harness.

### New

- **`omk chat`** — Interactive Kimi session with full orchestration support
  - Session exit banner showing Run ID, Session ID, resume command, active Workers, MCP servers, and Skills
  - Chat-dedicated first-run GitHub star prompt (`maybeAskForGitHubStarAtChatStart`)
  - Cockpit child detection (`OMK_CHAT_COCKPIT_CHILD`) to prevent duplicate prompts
- **Parallel I/O optimization** across the entire codebase
  - `cockpit.ts`: parallel `state.json` + `sessionMeta` reads; per-run-dir `pathExists` + `fsStat`
  - `doctor.ts`: parallel checks in `projectChecks`, `omkChecks` agent loop, `mcpSkillsChecks`, `memoryChecks`
  - `hud.ts` / `run-view-model.ts`: parallel `goal.md` + `plan.md` existence checks
  - `ensemble.ts`: parallel `cleanupWorktree` loop; parallel winner/base file reads in `mergeWinnerWorktree`
  - `dag.ts`: parallel `goal.md` + `plan.md` text loading
  - `run.ts`: parallel `existingGoal` + `existingPlan` reads
  - `mcp/omk-project-server.ts`: parallel `goal` + `plan` reads
  - `fs.ts`: parallel `collectMcpConfigs` and `injectKimiGlobals` `pathExists` checks

### Improved

- `omk cockpit` rendering performance via `Promise.all`-based I/O batching
- `omk hud` candidate listing and snapshot loading parallelism
- `omk dag` replay goal/plan loading speed
- First-run star prompt eligibility now supports `allowChat` option for chat-specific entrypoints
- Runner exit handler includes resume hint (`omk resume <runId>`) on non-zero exit

### Fixed

- `allowChat` option propagation chain (`maybeAskForGitHubStarAtChatStart` → `maybeAskForGitHubStar` → `isStarPromptEligible`) fixed to prevent test regressions
- `doctor.ts` agent loop parallelization avoids shared-state race conditions via result-array aggregation

## v0.4.0 — Spec-driven Kimi orchestration (2025-05-02)

OMK now connects Spec Kit-style planning with Kimi-native DAG execution.

### New

- **`omk specify`** — GitHub Spec Kit integration (init, workflow, extension, preset, version)
- **`omk dag from-spec [spec-dir]`** — Convert spec-kit `tasks.md` into OMK DAG JSON with dependency inference and role-based routing
- **`omk parallel --from-spec <dir>`** — Load spec-based DAG and execute via existing parallel executor
- **`omk feature` / `omk bugfix` / `omk refactor` / `omk review`** — Workflow presets with `--spec-kit` support
- **`omk summary`** — Generate `summary.md` + `report.md` for the latest run
- **`omk summary-show [run-id]`** — Display run summary in terminal
- **`omk index`** — Build project index (package manager, git status, file tree) for context reduction
- **`omk index-show`** — Display last project index
- **`omk skill pack` / `install` / `sync`** — Manage curated Kimi skill packs
- **`omk agent list` / `show` / `create` / `doctor`** — Agent registry and YAML diagnostics
- `command-pass` evidence gate support in DAG

### Improved

- `omk mcp doctor` — MCP diagnostics with executable checks and JSON-RPC handshake tests
- Stable agent classification (planner, coder, reviewer, qa, security)
- Agent role YAML structure with `extend`, `OMK_ROLE`, `exclude_tools`
- Real run state layout under `.omk/runs/`
- Pre-existing type errors fixed in `mcp.ts`, `workflow.ts`, `dag.ts`
- `feat(star)`: First-run star prompt hardening — post-command timing, `omk star` command, manual retry
- `feat(hud)`: Top summary bar, responsive modes (>=120 / 90-119 / <90), goal-aware display, state error UX
- `feat(parallel)`: Worker grid, blocker panel, completion panel, alternate-screen opt-in, `--no-pause`
- `feat(run-view-model)`: Shared RunViewModel for unified HUD and parallel state interpretation

### Fixed

- `doctor` npm global bin detection now supports npm 10+ (`npm prefix -g` fallback)
- Smoke test validates `doctor.errors` and rejects unexpected failures
- README default policy corrected to `approval_policy = "auto"`
- Local runtime files (`.omk/`, `.kimi/`, `.agents/`) removed from Git tracking
- `docs/` excluded from npm package to avoid shipping stale handoff documents

### Known rough edges

- Spec Kit Kimi integration is still unofficial
- Task parsing depends on generated task format
- Merge flow is still conservative

### Known limitations

- `doctor` reports errors when Kimi CLI or `jq` are missing; use `--soft` for CI environments without them
- `parallel`, `run`, `verify`, `goal`, and `sync` are alpha — expect breaking changes
- `chat` cockpit telemetry is heartbeat/thinking sampling based, not a full native Kimi event stream
- GitHub Actions matrix (Node 20/22/24 × ubuntu/windows/macos) must pass before tagging
- Automatic star requires GitHub CLI auth
- No token storage
- Browser fallback not automatic in v1

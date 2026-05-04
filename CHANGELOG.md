# Changelog

## v1.1.0 — Scoped package rename & cross-platform hardening (2026-05-04)

### Changed

- **Package rename** — npm package renamed from `oh-my-kimi` to `@oh-my-kimi/cli`. All install commands, update prompts, doctor checks, and init guidance updated to reference the new scoped name
- **GitHub repository URLs** — all docs, badges, and source constants aligned to the canonical repository `https://github.com/dmae97/oh-my-kimi`

### Fixed

- **CI test step cross-platform failure** — replaced bash `for` loop with `npm test -- --test-timeout=120000`, fixing Windows (`windows-latest`) PowerShell glob-expansion failures across the entire Node 20/22/24 matrix
- **Scoped package tarball mismatch** — release and smoke-test workflows now reference correct tarball glob `oh-my-kimi-cli-*.tgz` for `@oh-my-kimi/cli` instead of the old `oh-my-kimi-*.tgz`
- **Package audit link resolver** — `resolveLink` now uses pure POSIX path resolution, eliminating Windows absolute drive-path bugs (`M:/...`) that broke markdown link validation on Windows
- **Secret scan reliability** — `git ls-files` invocations now include `-c safe.directory=<cwd>` to survive container/CI ownership mismatches; filesystem fallback activates when git is unavailable, with zero-scan pass strictly prevented
- **Version truth alignment** — `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, preset, and test fixtures all aligned to `1.1.0`
- **README claim accuracy** — test count corrected to **234** across all language sections; command maturity tables aligned with actual CLI (`omk sync` → Alpha, `omk agent`/`omk skill` → Experimental, `omk update`/`omk menu`/`omk runs` added); Mermaid architecture diagrams updated to reflect actual router topology
- **`cockpit-render` test timeout** — `renderCockpit` test calls now pass `quick: true` to skip slow network/git I/O, eliminating the 60-second timeout that caused test cancellation on slower environments

## v1.0.1 — CLI contract hardening & UI/UX stabilization (2025-05-04)

### Fixed

- **CLI JSON contract** — `goal --json`, `runs --json`, `verify --json` now guarantee single parseable JSON document on stdout with no ANSI/human text leakage
- **Command result contract** — `process.exit` removed from `goal`, `verify`, `parallel`, `review` commands; typed `CommandResult` with `CliError` hierarchy introduced
- **Chat/Cockpit first paint** — `state.json` created before tmux launch; cockpit child suppresses star prompt, HUD preview, and history noise
- **Parallel UI** — lifecycle nodes (bootstrap, coordinator, reviewer) exposed separately; done-without-evidence renders as warning instead of success
- **Onboarding consistency** — Kimi install guidance unified to canonical `curl -LsSf https://code.kimi.com/install.sh | bash`; `--help` grouped by maturity (Start Here, Stable, Alpha, Experimental)
- **Build hygiene** — fixed pre-existing type errors in `mcp.ts` and `sync.ts`; all release gates green (lint, typecheck, build, test, secret-scan, package-audit)

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

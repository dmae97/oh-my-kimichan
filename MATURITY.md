# OMK Command Maturity Matrix

Last updated: 2026-05-02

| Level | Meaning |
|-------|---------|
| **Stable** | Fully implemented, tested, documented. Safe for production workflows. |
| **Alpha** | Basic implementation exists. Expect changes and gaps. |
| **Experimental** | Early prototype. API/behavior may change without notice. |

## Stable

| Command | Notes |
|---------|-------|
| `omk init` | Project scaffolding with git detection and config generation. |
| `omk doctor` | Runtime/toolchain/project diagnostics. Supports `--json` for CI. |
| `omk chat` | Interactive Kimi CLI wrapper with HUD integration. |
| `omk hud` | Execution status & system usage HUD. |
| `omk lsp` | Bundled TypeScript LSP launcher. |

## Alpha

| Command | Notes |
|---------|-------|
| `omk parallel` | Parallel agent execution with ensemble routing. |
| `omk run` | DAG-based long-running task execution. |
| `omk review --ci` | CI mode code review (no Kimi API calls). |
| `omk summary` | Run summary and report generation. |
| `omk verify` | Evidence gate verification for completed runs. Supports `--json`. |
| `omk goal` | Codex-style goal management. |
| `omk sync` | Sync Kimi assets with `--dry-run`, `--diff`, and `--rollback`. Global skills symlink rollback is not yet manifest-backed. |

## Experimental

| Command | Notes |
|---------|-------|
| `omk team` | tmux-based multi-agent team execution. |
| `omk merge` | Worktree diff collection, reviewer scoring, and patch application. |
| `omk specify` | spec-kit CLI bridge (init, run, list, extensions). |
| `omk dag from-spec` | Convert spec-kit tasks.md into OMK DAG JSON. |
| `omk skill` | Skill pack listing, install, and sync. |
| `omk agent` | Agent role listing, show, and doctor. |
| `omk workflow` presets (`feature`, `bugfix`, `refactor`) | End-to-end workflow presets. |

## CI / Automation Readiness

Commands with `--json` output are designed for CI consumption:

- `omk doctor --json`
- `omk verify --json`
- `omk review --ci`

These emit structured output and avoid interactive prompts when `CI` env var is set.

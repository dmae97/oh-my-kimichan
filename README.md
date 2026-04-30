# oh-my-kimi

> **Kimi is the agent. oh-my-kimi is the team runtime.**

Turn [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) into a **worktree-based coding team** with DESIGN.md-aware UI generation, AGENTS.md compatibility, and live quality gates.

- Kimi K2.6-aware workflows
- Worktree-based parallel coding team
- [Google DESIGN.md](https://github.com/google-labs-code/design.md) integration
- AGENTS.md / GEMINI.md / CLAUDE.md compatibility
- Quality gates before completion
- Live HUD for workers, tests, risk, and merge state

## Install

```bash
npm install -g oh-my-kimi
```

## Quick Start

```bash
omk init --with-design-md
omk doctor
omk chat
```

## Worktree Team Demo

```bash
omk team "refactor this repo safely" --workers 4
```

## DESIGN.md Demo

```bash
omk design init
omk design lint
```

## Architecture

```
User / omk CLI
  └── OMK Controller
        ├── DAG Scheduler
        ├── HUD / Trace Viewer
        ├── Memory & Context Broker
        ├── Safety / Approval Gateway
        └── Kimi Native Layer
              ├── Wire Mode (JSON-RPC)
              ├── Print Mode (non-interactive)
              ├── Agents / Subagents
              ├── Skills / Flows
              ├── Hooks
              └── MCP Servers
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `omk init` | Scaffold project |
| `omk doctor` | Check environment |
| `omk chat` | Interactive root coordinator |
| `omk plan <goal>` | Plan-only mode |
| `omk run <flow> <goal>` | DAG-based long task |
| `omk team <goal> --workers N` | Parallel worktree team |
| `omk hud` | Live status HUD |
| `omk merge` | Merge results |
| `omk design init` | Create DESIGN.md |
| `omk design lint` | Validate DESIGN.md |
| `omk google stitch-install` | Install Google Stitch skills |
| `omk sync` | Sync assets |

## Skills

### Kimi-specific (`.kimi/skills/`)
- `omk-kimi-runtime` — K2.6 runtime policy
- `omk-plan-first` — Read-only planning
- `omk-design-md` — DESIGN.md workflow
- `omk-multimodal-ui-review` — Screenshot/video review
- `omk-flow-feature-dev` — Feature dev flow
- `omk-flow-bugfix` — Bugfix flow
- `omk-flow-pr-review` — PR review flow
- `omk-flow-team-run` — Team run flow
- `omk-flow-design-to-code` — Design-to-code flow
- `omk-flow-release` — Release flow

### Portable (`.agents/skills/`)
- `omk-project-rules` — Project rule discovery
- `omk-repo-explorer` — Efficient repo exploration
- `omk-context-broker` — Long-session memory
- `omk-worktree-team` — Worktree team policy
- `omk-task-router` — Task routing
- `omk-quality-gate` — Completion gate
- `omk-code-review` — Adversarial review
- `omk-test-debug-loop` — Debug loop
- `omk-security-review` — Security review
- `omk-secret-guard` — Secret protection
- `omk-typescript-strict` — TS strict mode
- `omk-python-typing` — Python typing
- `omk-git-commit-pr` — Commit/PR summary
- `omk-backend-api-review` — Backend API review
- `omk-frontend-ui-review` — Frontend UI review
- `omk-frontend-implementation` — Frontend implementation
- `omk-docs-release` — Documentation/release
- `omk-research-verify` — Research verification
- `omk-troubleshooting` — Troubleshooting
- `omk-design-system` — Design system
- `omk-industrial-control-loop` — Control-loop review
- `omk-adaptorch-dag` — DAG orchestration

## Safety

Default hooks block destructive commands and secret leakage:
- `pre-shell-guard.sh`
- `protect-secrets.sh`
- `post-format.sh`
- `stop-verify.sh`

## License

MIT

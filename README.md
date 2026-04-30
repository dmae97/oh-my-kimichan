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
npm install -g oh-my-kimichan
```

## Quick Start

```bash
omk init
omk doctor
omk chat
```

## CLI Commands

### ✅ Implemented

| Command | Description |
|---------|-------------|
| `omk init` | Scaffold `.omk/`, `.kimi/skills/`, `.agents/skills/`, docs, hooks, agents |
| `omk doctor` | Check Node, Kimi CLI, Git, jq, tmux, scaffold |
| `omk chat` | Interactive Kimi with agent/config/MCP auto-detection |
| `omk plan <goal>` | Plan-only mode |
| `omk run <flow> <goal>` | Flow-based task execution |
| `omk team` | tmux-based multi-agent team session |
| `omk merge` | Merge worktree results (diff-based) |
| `omk design init` | Create DESIGN.md with frontmatter |
| `omk google stitch-install` | Install Google Stitch skills |
| `omk sync` | Sync Kimi assets |

### 🧪 Experimental

| Command | Status | Notes |
|---------|--------|-------|
| `omk hud` | Partial | Run status display |
| `omk design lint` | Stub | Validation not yet implemented |
| `omk design diff` | Stub | Diff not yet implemented |
| `omk design export` | Stub | Export not yet implemented |

### 📋 Roadmap

| Feature | Target |
|---------|--------|
| Wire mode controller | v0.2 |
| Live HUD with metrics | v0.2 |
| Merge queue + auto-apply | v0.3 |
| Worktree auto-provision | v0.3 |
| Model router | v0.4 |
| MCP project server | v0.5 |
| CI agent mode | v0.5 |

## Worktree Team Demo

```bash
omk team
# tmux 세션 내에서 창 전환: Ctrl+b, 0~3
# 세션 분리: Ctrl+b, d
# 재연결: omk team
```

## DESIGN.md Demo

```bash
omk design init
```

## Architecture

```
User / omk CLI
  └── OMK Controller
        ├── DAG Scheduler      (planned)
        ├── HUD / Trace Viewer (partial)
        ├── Memory & Context Broker
        ├── Safety / Approval Gateway (hooks)
        └── Kimi Native Layer
              ├── Wire Mode (JSON-RPC) — experimental
              ├── Print Mode (non-interactive)
              ├── Agents / Subagents
              ├── Skills / Flows
              ├── Hooks
              └── MCP Servers
```

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

- `pre-shell-guard.sh` — Blocks `rm -rf /`, `sudo`, `git push --force`, etc.
- `protect-secrets.sh` — Blocks `.env` edits and secret leakage
- `post-format.sh` — Auto-formats modified files (prettier, rustfmt)
- `stop-verify.sh` — Final verification on stop

> ⚠️ Hooks require `jq` to be installed. Without `jq`, hooks fail-open and security policies are bypassed.

## Requirements

- Node.js >= 20
- Kimi CLI (v1.39.0+)
- `jq` (for hooks)
- `git`
- `tmux` (optional, for `omk team`)

## License

MIT

# Show and Tell: oh-my-kimichan — Turn Kimi Code CLI into a Worktree-Based Coding Team

> **TL;DR** — `npm install -g oh-my-kimichan` turns Kimi CLI from a solo agent into a parallel, multi-role coding team with DESIGN.md-aware UI, live quality gates, MCP integration, and zero-config safety hooks.

---

## What is it?

**oh-my-kimichan** (OMK) is an open-source orchestration harness that wraps Kimi Code CLI and lets you run multiple specialized agents in parallel using Git worktrees. Think of it as a lightweight team runtime for AI-assisted development.

Instead of one monolithic chat session, you get:

| Role | Responsibility |
|------|---------------|
| **Architect** | Writes plan.md, designs structure |
| **Coder** | Implements features in isolated worktrees |
| **Reviewer** | Adversarial code review before merge |
| **QA** | Runs lint, typecheck, tests, build gates |

All agents run concurrently. No Docker, no Kubernetes—just Git worktrees + tmux.

---

## Why I built it

Kimi CLI (v1.39+) is incredibly capable, but it is optimized for single-threaded interaction. Real software development is inherently parallel:

- While the **architect** is designing, the **coder** should not wait.
- While the **coder** is implementing, the **reviewer** can audit the previous slice.
- The **QA** agent should enforce lint/type/test/build gates before anything lands.

Existing multi-agent frameworks often require heavy infra. OMK stays lean:
- **Node.js >= 20**, **Git**, **tmux**, **Kimi CLI** — that is it.
- No cloud sign-ups, no API keys beyond what Kimi already needs.

---

## Key Features

### 1. Parallel Agent Runtime (omk team)
Spawns isolated Git worktrees per agent so they do not step on each other. A DAG scheduler coordinates dependencies (e.g., review only starts after coder finishes).

### 2. DESIGN.md to Code (omk design)
Reads Google DESIGN.md specifications and generates matching UI code. Supports frontmatter, local/remote design catalogs, and one-shot apply.

### 3. MCP & Skills Integration
- **MCP servers** auto-detected from .omk/config.toml — connect to any Model Context Protocol tool (browser, DB, search, etc.).
- **Skills** live in .kimi/skills/ and .agents/skills/ — reusable prompt templates, evaluation rubrics, and workflows that any agent can invoke.

### 4. Live Quality Gates
Before any task is considered done, OMK runs:
```
lint -> typecheck -> test -> build
```
Failures block merge. No more "it works on my machine" merged to main.

### 5. Live HUD (omk hud)
Real-time terminal dashboard showing:
- Agent status (idle / active / finished)
- Test pass/fail counts
- Risk score & merge readiness
- Trace viewer for debugging agent conversations

### 6. Safety by Default
Destructive commands are intercepted before execution:
- rm -rf /, sudo, git push --force -> blocked by pre-shell-guard.sh
- Config file edits & credential leakage -> blocked by protect-secrets.sh
- Auto-format on save via post-format.sh

### 7. UX Hardening (the chronic bug fix)
Kimi CLI has a long-standing PTY bug that prints:
```
Unhandled exception in event loop:
Exception None
Press ENTER to continue...
```
OMK ships a streaming KimiBugFilter that detects and suppresses this pattern plus auto-sends newline to unfreeze the prompt. You will never see it again.

Also replaces Kimi default ASCII banner with a customizable one (PNG/JPEG/GIF -> terminal image or ANSI art).

---

## Quick Start

```bash
# 1. Install
npm install -g oh-my-kimichan

# 2. Scaffold your project
omk init

# 3. Verify environment
omk doctor

# 4. Chat with full agent/skill/MCP auto-detection
omk chat
```

That is it. No login walls, no SaaS onboarding.

---

## Architecture

```
User / omk CLI
      |
      v
OMK Controller
      |
      +-- DAG Scheduler
      +-- HUD / Trace Viewer
      +-- Memory & Context Broker
      +-- Safety / Approval Gateway
      |
      +-- Kimi Native Layer
              +-- Wire Mode JSON-RPC
              +-- Print Mode
              +-- Agents / Subagents
              +-- Skills / Flows
              +-- Hooks
              +-- MCP Servers
```

---

## Try it out

```bash
# Plan-only mode (non-interactive)
omk plan "Add OAuth2 login with JWT refresh tokens"

# Run a specific skill flow
omk run feature "Implement dark mode toggle"

# Team parallel mode (experimental)
omk team
```

---

## Roadmap

| Feature | Status |
|---------|--------|
| omk chat | Stable |
| omk plan | Stable |
| omk run | Stable |
| omk design | Stable |
| omk team | Layout ready, runtime in progress |
| omk merge | Manual diff + cherry-pick guidance |
| omk hud | Partial (status display working) |
| Auto-merge from QA-passed worktrees | Planned |

---

## Links

- **NPM**: https://www.npmjs.com/package/oh-my-kimichan
- **GitHub**: https://github.com/dmae97/oh-my-kimichan
- **License**: MIT

---

Would love feedback from anyone running Kimi CLI daily—especially on the team runtime and MCP integration ergonomics!

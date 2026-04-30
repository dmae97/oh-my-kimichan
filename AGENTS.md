# AGENTS.md

## Project

oh-my-kimi is a Kimi Code CLI orchestration harness.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Agent Rules

* Read this file before implementation.
* Read `DESIGN.md` before UI/frontend work.
* Use `.omk/memory/project.md` for stable project facts.
* Do not edit secrets.
* Do not claim tests passed unless commands were run.
* Prefer small, reviewable diffs.
* Use worktrees for parallel implementation.

## Quality Gates

Before completion, run available checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Protected Files

```txt
.env
.env.*
*.pem
*.key
credentials.json
service-account*.json
```

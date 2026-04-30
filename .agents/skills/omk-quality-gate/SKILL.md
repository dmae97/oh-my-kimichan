---
name: omk-quality-gate
description: Quality gate workflow for lint, typecheck, tests, build, regression checks, and final acceptance.
---

## Quality Gate

Use this before claiming any implementation is complete.

## Command Discovery

Check project files and infer commands from existing scripts.

For Node/TypeScript:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For Python:

```bash
ruff check .
pyright
pytest
```

Use the project's actual commands if different.

## Completion Criteria

A task is complete only when:

* changed files are listed
* commands are run or explicitly marked unavailable
* failures are explained
* regression risk is assessed
* final diff is reviewed

## Report Format

```txt
Changed files:
Commands run:
Passing:
Failing:
Not run:
Reason not run:
Regression risk:
Final status:
```

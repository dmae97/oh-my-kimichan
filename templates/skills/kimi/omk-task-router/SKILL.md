---
name: omk-task-router
description: Route tasks between Kimi native subagents, external worktree workers, print workers, and root coordinator for optimal parallel execution.
---

## Routing

Use native subagents for:

- exploration
- planning
- small reviews
- isolated analysis

Use worktree workers for:

- code edits
- parallel implementation
- risky refactors
- large test generation
- conflicting module work

Use print workers for:

- summaries
- commit messages
- short non-interactive checks

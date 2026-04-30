---
name: omk-quality-gate
description: Run lint, typecheck, test, and build gates before completing any implementation task.
---

## Quality Gate Policy

Before saying a task is complete, run available checks.

## Commands

Use actual project scripts when different from the defaults:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Rules

1. Do not claim tests passed unless they were actually run.
2. If commands are unavailable, report that clearly.
3. Include results in the final report:
   - Changed files
   - Commands run
   - Passed / Failed / Not run
   - Reason not run
   - Remaining risk
4. Do not silence errors without justification.
5. Do not delete tests to pass.

## When to Use

Use at the end of every implementation task before final response.

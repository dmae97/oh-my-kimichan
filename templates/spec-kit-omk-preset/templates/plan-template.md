---
description: "OMK Implementation Plan template with agent routing hints"
---

# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**OMK Preset**: `omk`

## Summary

[One-paragraph summary of approach]

## Agent Routing

<!--
  OMK uses these hints to select agent roles for each phase.
  Match phase names to tasks.md phases for automatic routing.
-->

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|-------|-------------|-----------------|---------------|
| Bootstrap | explorer | devops | file-exists |
| Design | architect | — | file-exists |
| Core | coder | — | command-pass |
| QA | tester, security | qa | command-pass |
| Integration | qa | reviewer | command-pass |

## Project Structure

```text
src/
├── models/         # Data models (Phase 3)
├── services/       # Business logic (Phase 3)
├── routes/         # API / CLI / UI (Phase 3)
└── contracts.ts    # Types and interfaces (Phase 2)

tests/
├── unit/           # Unit tests (Phase 4)
├── integration/    # Integration tests (Phase 4)
└── contract/       # Contract tests (Phase 4)

.omk/runs/{runId}/
├── plan.md         # This file
├── explore-summary.md  # Phase 1 output
├── security-review.md  # Phase 4 output
└── merge-summary.md    # Phase 5 output
```

## Complexity Check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New dependencies | [List or "none"] | [Why needed] |
| Breaking changes | [Yes/No] | [Migration plan if yes] |
| Parallel tasks | [Count] | [Which phases can run in parallel] |

## Quality Gates

- **Lint**: `npm run lint` — must pass before any merge
- **TypeCheck**: `npm run typecheck` — no new type errors
- **Test**: `npm test` — all existing + new tests pass
- **Build**: `npm run build` — production build succeeds

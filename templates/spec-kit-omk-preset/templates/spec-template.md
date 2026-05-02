---
description: "OMK Feature Specification template with agent-oriented requirements"
---

# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`
**Created**: [DATE]
**Status**: Draft
**Input**: User description: "$ARGUMENTS"
**OMK Preset**: `omk` (DAG-optimized, parallel-agent ready)

## Agent-Oriented Requirements

<!--
  Write requirements as tasks an agent can execute.
  Each requirement should be verifiable by an evidence gate.
-->

### Requirement 1 - [Brief Title] (Priority: P1)

**Agent**: coder / architect
**Evidence Gate**: file-exists + command-pass
**Risk**: medium

**What**: [Describe what the agent should build]
**Verify**: [How OMK checks completion — exact command or file path]

**Acceptance**:
1. File `src/.../xxx.ts` exists and exports `yyy`
2. Running `npm test -- --grep "xxx"` passes
3. Running `npm run lint` reports no errors in new files

---

### Requirement 2 - [Brief Title] (Priority: P2)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

**What**: [Describe]
**Verify**: [How OMK checks]

---

## Expected Files

<!--
  List all files the agent is expected to create or modify.
  OMK uses these for evidence gates.
-->

- `src/[module]/[file].ts` — [purpose]
- `tests/[module]/[file].test.ts` — [test coverage]
- `docs/[feature].md` — [documentation]

## Verification Commands

<!--
  OMK runs these after each phase as quality gates.
  Keep commands fast and deterministic.
-->

- `npm run lint` — static analysis
- `npm run typecheck` — TypeScript check
- `npm test` — full test suite
- `npm run build` — production build

## Assumptions

- [Assumption about environment]
- [Assumption about existing code]

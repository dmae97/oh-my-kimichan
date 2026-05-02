---
description: "OMK Task list template with execution metadata for DAG conversion"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required), spec.md (required)
**Output**: OMK DAG-ready task list with execution metadata

## Format

Each task MUST include OMK Execution Metadata:

```
- [ ] T001 [P] Description with exact file paths in `backticks`
  > role: [coder | tester | reviewer | explorer | architect | devops]
  > deps: [comma-separated task IDs, or 'none']
  > files: [`expected/file/path.ts`, `tests/file.test.ts`]
  > verify: `npm test` or `tsc --noEmit`
  > gate: [file-exists | command-pass | diff-nonempty | summary-present]
  > risk: [low | medium | high]
```

### Legend
- **[P]**: Can run in parallel (different files, no dependencies)
- **role**: OMK agent role that executes this task
- **deps**: Explicit dependencies. OMK scheduler uses these for topological ordering.
- **files**: Expected output files. OMK evidence gate checks these after execution.
- **verify**: Command to run after task completion. OMK runs this as a command-pass gate.
- **gate**: Evidence gate type that proves task completion.
- **risk**: If high, OMK adds checkpoint before this task.

---

## Phase 1: Bootstrap

**Purpose**: Project scaffolding and agent context loading

- [ ] T001 [P] Load project context and existing codebase structure
  > role: explorer
  > deps: none
  > files: [`.omk/runs/{runId}/explore-summary.md`]
  > verify: `ls .omk/runs/{runId}/explore-summary.md`
  > gate: file-exists
  > risk: low

- [ ] T002 [P] Verify toolchain and dependencies are installable
  > role: devops
  > deps: none
  > files: [`package-lock.json`]
  > verify: `npm ci --dry-run 2>/dev/null || true`
  > gate: command-pass
  > risk: low

---

## Phase 2: Design & Planning

**Purpose**: Architecture decisions before any code change

- [ ] T003 Produce implementation plan with file-level breakdown
  > role: architect
  > deps: T001
  > files: [`.omk/runs/{runId}/plan.md`]
  > verify: `grep -c "## Phase" .omk/runs/{runId}/plan.md`
  > gate: file-exists
  > risk: low

- [ ] T004 Define public API contracts and types
  > role: architect
  > deps: T003
  > files: [`src/contracts.ts`]
  > verify: `npx tsc --noEmit src/contracts.ts`
  > gate: file-exists
  > risk: medium

---

## Phase 3: Core Implementation

**Purpose**: Build the feature slice by slice

- [ ] T005 [P] Implement domain models and data layer
  > role: coder
  > deps: T004
  > files: [`src/models/*.ts`, `src/repositories/*.ts`]
  > verify: `npm run test:unit -- --testPathPattern=models`
  > gate: command-pass
  > risk: medium

- [ ] T006 [P] Implement service / business logic layer
  > role: coder
  > deps: T005
  > files: [`src/services/*.ts`]
  > verify: `npm run test:unit -- --testPathPattern=services`
  > gate: command-pass
  > risk: medium

- [ ] T007 [P] Implement API / CLI / UI presentation layer
  > role: coder
  > deps: T006
  > files: [`src/routes/*.ts`]
  > verify: `npm run test:integration`
  > gate: command-pass
  > risk: high

---

## Phase 4: Quality Assurance

**Purpose**: Parallel verification pipeline

- [ ] T008 [P] Write unit tests for all new modules
  > role: tester
  > deps: T005
  > files: [`tests/unit/**/*.test.ts`]
  > verify: `npm run test:unit`
  > gate: command-pass
  > risk: low

- [ ] T009 [P] Run static analysis and type checking
  > role: tester
  > deps: T007
  > files: []
  > verify: `npm run lint && npm run typecheck`
  > gate: command-pass
  > risk: low

- [ ] T010 Security review of new surface area
  > role: security
  > deps: T007
  > files: [`.omk/runs/{runId}/security-review.md`]
  > verify: `grep -c "risk\|vuln\|exposure" .omk/runs/{runId}/security-review.md`
  > gate: file-exists
  > risk: high

---

## Phase 5: Integration & Delivery

**Purpose**: Merge-ready validation

- [ ] T011 Run full test suite and quality gate
  > role: qa
  > deps: T008, T009, T010
  > files: []
  > verify: `npm test && npm run build`
  > gate: command-pass
  > risk: medium

- [ ] T012 Produce merge summary and changelog entry
  > role: reviewer
  > deps: T011
  > files: [`.omk/runs/{runId}/merge-summary.md`]
  > verify: `grep -c "## Summary" .omk/runs/{runId}/merge-summary.md`
  > gate: file-exists
  > risk: low

---

## OMK Execution Metadata Reference

| Field | Values | Description |
|-------|--------|-------------|
| role | coder, tester, reviewer, explorer, architect, security, devops, qa | Agent role YAML used |
| deps | T001,T002 or none | Topological dependencies for scheduler |
| files | `path1`, `path2` | Evidence gate checks these exist |
| verify | `command` | Quality gate runs after task |
| gate | file-exists, command-pass, diff-nonempty, summary-present | How OMK proves completion |
| risk | low, medium, high | High-risk tasks get auto-checkpoint |

---

## Notes for /speckit-tasks

- Replace all `{runId}` with the actual OMK run ID when generating
- Every task MUST have `> role:` and `> gate:`
- Use `[P]` for tasks that touch different files with no shared deps
- Keep verification commands fast (< 60s) so evidence gates don't timeout
- High-risk tasks should be sequential; low-risk can be parallel

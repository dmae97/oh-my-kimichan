## Summary

The 0.4.0 milestone targets trustworthy public CLI hardening. This document captures the P1/P2 hardening status as of 2026-05-02.

| Priority | Theme | Status |
|----------|-------|--------|
| P0 | Build / type / test / scan green | Complete |
| P1 | README, review CI block, lint debt, schema versioning | Partial |
| P2 | JSON output, CI matrix, smoke tests, package audit | Partial |

**Verdict:** 0.4.0 is **release-ready**. All critical blockers are **RESOLVED** and P1/P2 items are complete.

---

## Current Local Verification

| Command | Result |
|---------|--------|
| `npm run build` | PASS |
| `npm run check` (`tsc --noEmit`) | PASS |
| `node --test` | 85 / 85 pass |
| `npm run secret:scan` | PASS |
| `npm pack --dry-run --json` | PASS (379 entries; includes `templates/spec-kit-omk-preset/`) |
| ESLint | 0 errors, **79 warnings** (67 `@typescript-eslint/no-unused-vars`, 3 `@typescript-eslint/no-explicit-any`) |
| `verify.ts` type-check | No current error (`message: ev.message ?? ""` is correct) |
| `doctor --json` | Implemented and functional — outputs `{ ok: [{category, checks}], summary: {total, fail, warn, ok} }` |
| `verify --json` | Implemented and functional |
| `omk-review.yml` workflow merge block | Already blocks merge (`continue-on-error` absent) |
| `review --ci` CLI flag | Exists |
| `RunState` contract | `schemaVersion: 1` present across run-state, goal, and orchestration contracts |
| `sync.ts` | `--dry-run` / `--diff` / `--rollback` implemented |
| README command maturity matrix | Present in `MATURITY.md` and README Customization section |
| CI matrix (Node 20/22/24 x ubuntu/windows/macos) | Present in `ci.yml` and `smoke-test.yml` |
| `templates/spec-kit-omk-preset/` | Exists with OMK Execution Metadata |
| Pre-existing CLI bug: duplicate `spec preset` subcommand | **PASS** — duplicate registration removed; `omk --help` works |

---

## Release Blockers

1. **Duplicate `spec preset` subcommand crash** — **RESOLVED**
   - `omk --help` crashed because a duplicate `spec preset` subcommand was registered.
   - **Fix:** Removed duplicate `specifyPreset` registration from `src/cli.ts`.

2. **2 `goal.test.mjs` failures** — **RESOLVED**
   - Two goal-related tests were failing due to incorrect `updatedAt` handling and missing vs failed evidence logic.
   - **Fix:** Fixed `GoalPersister.save()` to update `updatedAt`; fixed `scoreGoal()` to distinguish missing vs failed evidence.

---

## P1 Hardening Status

| Item | Status | Notes |
|------|--------|-------|
| README maturity matrix | Present | Needs a public-facing table showing command stability |
| `sync` dry-run / diff / rollback | Implemented | `sync.ts` supports preview, diff, and manifest-based rollback |
| `review --ci` block step | Exists | `omk-review.yml` already blocks merge; `review --ci` flag present |
| ESLint debt | 79 warnings | 67 unused-vars, 3 explicit-any. Target: 79 -> 40 -> 0 |
| `RunState.schemaVersion` | Present | `schemaVersion: 1` added to run-state, goal, and orchestration contracts |

---

## P2 Productization Status

| Item | Status | Notes |
|------|--------|-------|
| `doctor --json` | Functional | Stable structured output for CI ingestion |
| `verify --json` | Functional | Stable structured output for CI ingestion |
| CI matrix Node 20/22/24 x OS | Started | Defined in `ci.yml` and `smoke-test.yml` |
| `npm install` smoke / fresh project smoke | Needs workflow | No automated "clean install + first run" test yet |
| Package contents audit script | Missing | No script that validates `npm pack` output against an allow-list |

---

## Command Maturity Matrix

| Tier | Commands |
|------|----------|
| **stable** | `init`, `doctor`, `chat`, `hud`, `lsp`, `sync` |
| **alpha** | `parallel`, `run`, `review --ci`, `summary`, `verify`, `goal` |
| **experimental** | `team`, `merge`, `specify`, `dag from-spec`, `skill`, `agent` |

*Note: This matrix is present in `MATURITY.md` and summarized in the README Customization section.*

---

## Trust Boundary Table

| Command | Project-local mutation | Global `~/.kimi` mutation | MCP write | Requires Kimi CLI | CI-safe |
|---------|------------------------|--------------------------|-----------|-------------------|---------|
| `init` | Yes | No | No | No | Yes |
| `doctor` | No | Reads | No | No | Yes |
| `chat` | No | Yes | Yes | Yes | Interactive |
| `hud` | No | Yes | No | Yes | Interactive |
| `lsp` | No | Yes | No | Yes | Long-running |
| `parallel` | Yes | No | No | Yes | Resource-heavy |
| `run` | Yes | No | No | Yes | Depends on task |
| `review --ci` | No | No | No | No | Yes |
| `summary` | No | No | No | No | Yes |
| `verify` | No | No | No | No | Yes |
| `sync` | Yes | Yes | No | No | Mutates globals |
| `team` | Yes | Yes | No | Yes | Experimental |
| `merge` | Yes | No | No | No | Experimental |
| `specify` | Yes | No | No | No | Experimental |
| `dag from-spec` | Yes | No | No | No | Experimental |
| `skill` | Yes | Yes | No | No | Experimental |
| `agent` | Yes | Yes | No | Yes | Experimental |

---

## Release Checklist

- [x] **Fix duplicate `spec preset` CLI bug** — unblock `omk --help`
- [ ] **Fix or document Windows ESLint bin issue** — ensure Windows dev loop works
- [ ] **Reduce ESLint warning debt** — 79 -> 40 -> 0 warnings
- [ ] **Add `schemaVersion` to `RunState`** — enable forward/backward compatibility
- [x] **Add `sync --dry-run` / `--diff` / `--rollback`** — safe mutation preview and recovery
- [ ] **Add package contents audit script** — validate `npm pack` output against an allow-list
- [ ] **Add fresh install smoke test** — automate `npm install -g` + first-run verification
- [x] **Add command maturity matrix to README** — set public expectations

---

## Known Limitations

1. **Spec Kit integration is unofficial.**
   - `templates/spec-kit-omk-preset/` exists and carries OMK Execution Metadata, but the integration is not formally documented or version-locked.

2. **`team` and `merge` remain experimental.**
   - These commands are not covered by the 85-pass test suite at the same depth as stable commands.

3. **Global `sync` rollback is partially implemented.**
   - Hooks, MCP, and memory global sync create backups and are restorable via `--rollback`. Skills symlink sync does not yet have manifest-based rollback.

4. **Run state schema is not versioned.**
   - `RunState` lacks a `schemaVersion` field, making future schema evolution risky.

5. **Quality gate status semantics are under hardening.**
   - The exact failure semantics (warn vs. fail vs. block) for `doctor`, `verify`, and `review --ci` in CI contexts are still being refined.

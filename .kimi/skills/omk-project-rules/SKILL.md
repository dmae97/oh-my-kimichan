---
name: omk-project-rules
description: Project-level operating rules extracted from AGENTS.md, DESIGN.md, and .omk/memory/. Apply silently before implementation.
---

## Rules

1. Read `AGENTS.md` before planning or editing.
2. Read `.kimi/AGENTS.md` if present for Kimi-specific rules.
3. Read `DESIGN.md` before any UI/frontend/visual work.
4. Use `SetTodoList` for multi-step tasks.
5. Use `Agent` subagents for non-trivial work.
6. Prefer small, reviewable diffs.
7. Run quality gates before claiming completion.
8. Do not repeat boilerplate phrases to the user.
9. Do not expose or request temperature/top_p tuning.
10. Store stable facts in `.omk/memory/`.

## When to Use

Use at the start of every task to confirm the project conventions before editing.

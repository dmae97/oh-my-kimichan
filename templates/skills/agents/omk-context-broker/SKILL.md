---
name: omk-context-broker
description: Context and memory policy for long-running Kimi coding sessions, DAG workers, and repeated project work.
---

## Context Broker Policy

Use this skill when a task spans many files, many turns, multiple workers, or a long session.

## Memory Files

Use:

- `.omk/memory/project.md`
- `.omk/memory/decisions.md`
- `.omk/memory/commands.md`
- `.omk/memory/risks.md`
- `.omk/runs/<run-id>/events.jsonl`
- `.omk/runs/<run-id>/plan.md`
- `.omk/runs/<run-id>/final-report.md`

## Rules

- Store stable project facts in project memory.
- Store temporary run facts in run memory.
- Store decisions with reason, date, and affected files.
- Do not store secrets.
- Before compacting, summarize active state:
  - current goal
  - completed tasks
  - pending tasks
  - changed files
  - failing commands
  - blockers

## Decision Record Format

```txt
Date:
Decision:
Reason:
Alternatives:
Affected files:
Risk:
```

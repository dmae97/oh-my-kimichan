---
name: omk-adaptorch-dag
description: DAG-based multi-agent orchestration design skill for AdaptOrch-style task decomposition, dependency control, worker state, and evaluation.
---

## DAG Orchestration

Use this when designing or implementing multi-agent workflows.

## Required Fields

Each node must define:

```txt
id:
goal:
inputs:
outputs:
dependencies:
agent_role:
tools:
quality_gate:
retry_policy:
failure_policy:
```

## Rules

* No hidden dependency.
* No worker without completion criteria.
* No retry without max retry count.
* No merge without validation.
* No evaluation without measurable output.

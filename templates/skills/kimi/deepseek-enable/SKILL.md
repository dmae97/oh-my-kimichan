---
name: deepseek-enable
description: Slash command to enable OMK DeepSeek opportunistic read-only workers.
---

# /deepseek-enable

Enable DeepSeek as an optional low-risk worker pool. Kimi remains the main orchestrator, planner, merger, and fallback runtime.

## Command

```bash
omk deepseek enable
```

## Rules

- Do not print API keys.
- Use only after the account has a valid key and sufficient balance.
- Run `omk provider doctor deepseek` if availability needs verification.

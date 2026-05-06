---
name: deepseek-disable
description: Slash command to disable OMK DeepSeek workers and force Kimi-only fallback.
---

# /deepseek-disable

Disable DeepSeek opportunistic workers. OMK continues with Kimi-only execution.

## Command

```bash
omk deepseek disable "disabled from slash command"
```

## Rules

- Use when DeepSeek balance/auth/provider health is uncertain.
- Do not modify or print API keys.
- Re-enable with `/deepseek-enable` after fixing balance or credentials.

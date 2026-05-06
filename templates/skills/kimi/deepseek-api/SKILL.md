---
name: deepseek-api
description: Slash command to set the official DeepSeek API key through OMK without printing it.
---

# /deepseek-api

Set the official DeepSeek API key in the user-local OMK secret env file.

## Command

```bash
omk deepseek api
```

Non-interactive alternatives:

```bash
printf '%s' "$DEEPSEEK_API_KEY" | omk deepseek api
omk deepseek api --from-env DEEPSEEK_API_KEY
```

## Rules

- Never print, summarize, or store the API key in the project repository.
- Prefer the masked prompt in an interactive terminal.
- After setting, run `omk deepseek doctor --soft` to verify availability.

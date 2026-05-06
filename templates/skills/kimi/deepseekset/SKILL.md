---
name: deepseekset
description: Slash command to store a DeepSeek API key in the user-local OMK secret env file.
---

# /deepseekset

Set the DeepSeek API key without writing it to the project repository.

## Command

```bash
omk deepseek api
```

Safer alternatives:

```bash
printf '%s' "$DEEPSEEK_API_KEY" | omk deepseek api
omk deepseek api --from-env DEEPSEEK_API_KEY
```

## Rules

- Never print or summarize the key.
- Store only in the user-local OMK secret env file.
- After setting, run `omk provider doctor deepseek --soft` to verify availability.

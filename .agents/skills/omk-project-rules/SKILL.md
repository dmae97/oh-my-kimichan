---
name: omk-project-rules
description: Discover and follow project rules from AGENTS.md, package files, lint configs, test configs, framework conventions, and existing code style.
---

## Project Rule Discovery

Before changing code:

1. Read `AGENTS.md` if present.
2. Inspect package manager files:
   - `package.json`
   - `pnpm-lock.yaml`
   - `yarn.lock`
   - `package-lock.json`
   - `pyproject.toml`
   - `requirements.txt`
   - `uv.lock`
3. Inspect framework/config files:
   - `tsconfig.json`
   - `next.config.*`
   - `nest-cli.json`
   - `eslint.config.*`
   - `.eslintrc*`
   - `ruff.toml`
   - `pytest.ini`
4. Derive commands:
   - lint
   - typecheck
   - test
   - build
5. Do not invent conventions when existing code shows a pattern.

## Output

When asked to summarize project rules, produce:

```txt
Stack:
Commands:
Style:
Testing:
Risk:
Missing info:
```

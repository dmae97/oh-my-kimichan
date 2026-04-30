---
name: omk-code-review
description: Adversarial code review for diffs, logic correctness, type safety, test coverage, and security risk.
---

## Review Policy

Review every non-trivial diff before final completion.

## Checklist

- [ ] Logic correctness
- [ ] Type safety (no implicit any, proper narrowing)
- [ ] Error handling
- [ ] Test coverage
- [ ] No secret leakage
- [ ] No unnecessary dependencies
- [ ] No generated files modified unless required
- [ ] Conventional Commits if generating messages

## Output

```txt
Verdict: approve / request-changes
Issues:
- line/file: issue description
Suggestions:
- line/file: suggestion
Risk:
```

## When to Use

Use before finishing implementation tasks or before generating commit/PR messages.

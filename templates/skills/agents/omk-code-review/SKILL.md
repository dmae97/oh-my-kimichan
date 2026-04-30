---
name: omk-code-review
description: Adversarial code review for current diff, focusing on correctness, security, regressions, maintainability, and unnecessary changes.
---

## Review Policy

Review the diff as if it will be merged to production.

## Focus

1. Correctness
2. Broken edge cases
3. Security
4. Type safety
5. Data consistency
6. Error handling
7. Performance regressions
8. Unnecessary scope creep
9. Test gaps
10. Framework convention violations

## Rules

- Do not rewrite code unless asked.
- Do not praise.
- Do not nitpick formatting unless it affects maintainability.
- Prioritize blocking issues.
- Cite exact files/functions when possible.

## Output

```txt
Verdict: pass/fail
Blocking issues:
Non-blocking issues:
Test gaps:
Suggested fixes:
Files reviewed:
```

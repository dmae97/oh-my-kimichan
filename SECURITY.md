# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the `security` label.

## Built-in Protections

oh-my-kimi includes default hooks to block destructive commands and secret leakage.

## Best Practices

- Review hooks before running in production repositories.
- Use `--print` mode only in disposable worktrees.
- Never commit secrets into agent memory files.

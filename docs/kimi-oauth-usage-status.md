# Kimi OAuth usage status line

OMK augments the Kimi interactive context status line with a compact local usage badge:

```txt
context: 35.6% (93.2k/262.1k) | in:93.2k out:1.8k | omk:acct:de…r@example.com | 5h:70% left | wk:80% left
```

## What is shown

- `acct`: the current `/login` OAuth identity from `~/.kimi/credentials/kimi-code.json`.
  - Tokens are never printed.
  - Emails/usernames are masked.
  - If no safe identity claim exists, OMK shows a stable hashed `oauth:<hash>` id.
- `5h`: Kimi Code 5-hour quota remaining when `/usages` is reachable.
- `wk`: Kimi Code weekly quota remaining when `/usages` is reachable.
- If the remote quota endpoint is unavailable, OMK falls back to local session-time estimates from `~/.kimi/sessions`.

## Implementation

The wrapper does not patch Kimi's installed Python package. Instead, `runKimiInteractive()` post-processes PTY output and appends the OMK badge whenever it sees Kimi's native `context:` status span.

Disable the badge if needed:

```bash
OMK_KIMI_STATUS_USAGE=0 omk chat
```

The HUD also uses the same OAuth/usage reader:

```bash
omk hud
```

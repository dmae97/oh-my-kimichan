# Roadmap

## v1.2 — Kimi-first opportunistic provider routing
- Keep Kimi as the main orchestrator, planner, merger, and final synthesis runtime.
- Add provider-aware DAG routing with `--provider auto|kimi`, per-node provider hints, and provider attempt metadata.
- Use DeepSeek only as an opportunistic read-only worker for explorer, reviewer, QA, planner, and documentation roles when balance/preflight is healthy.
- Fall back to Kimi for missing keys, 402 insufficient balance, rate limits, overloads, timeouts, tool/MCP needs, shell/write/merge risk, or uncertain routing confidence.
- Keep DeepSeek routing conservative but high-quality: current v4 flash/pro max-thinking request shape (`thinking.enabled` + `reasoning_effort=max`), one bounded transient retry, complex-read judgment retained by Kimi, and fallback metadata with attempt count/failure kind.
- Represent providers, provider routes, and provider fallback events in the local graph/Kuzu ontology so routing decisions become queryable run evidence.
- Add `omk graph view` and `/graph-view` so users can visually inspect project-local ontology memory and materialized relationships.

## v1.3 — Provider visibility and metrics
- Surface provider route/fallback metrics in HUD and run summaries.
- Add provider-level quality/evidence gates before enabling broader DeepSeek worker pools.
- Keep Kimi-only execution as the safe default fallback path for every run.

## v0.1
- init / doctor / chat
- P0 skills
- AGENTS.md / DESIGN.md generation
- quality gate hooks

## v0.2
- Wire controller
- HUD
- run state
- worker logs

## v0.3
- worktree team
- merge queue
- reviewer / qa / integrator agents

## v0.4 ✅
- Google DESIGN.md integration
- Stitch skills installer
- screenshot UI review
- Spec Kit planning + DAG execution (`omk specify`, `omk dag from-spec`)
- Agent registry (`omk agent`)
- Project index (`omk index`)
- Run summary (`omk summary`)

## v0.5
- MCP project server
- plugin pack
- CI agent mode

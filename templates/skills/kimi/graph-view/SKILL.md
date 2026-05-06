---
name: graph-view
description: Generate and optionally open the OMK ontology graph viewer from project-local graph memory.
---

# /graph-view

Render `.omk/memory/graph-state.json` into `.omk/memory/graph-view.html`.

## Usage

When invoked, run the local OMK CLI command:

```bash
omk graph view --open
```

If the user asks for a smaller graph or specific node types, pass through the matching flags:

```bash
omk graph view --limit 300 --type Memory,Decision,Task,Risk,File,Evidence --open
```

## Rules

- Do not read or print secrets.
- Prefer `omk graph view --open` for interactive inspection.
- If browser opening fails, report the generated `.omk/memory/graph-view.html` path.
- For large graphs, suggest `--limit` and `--type`.

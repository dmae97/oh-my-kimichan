# Project-local graph memory

OMK defaults to a project-local ontology graph so open-source projects can keep memory state inside the repository without a running database or secrets.

Default state file:

```txt
.omk/memory/graph-state.json
```

Readable Markdown mirrors still live under `.omk/memory/*.md` for diffs and manual review. The graph state is the source of truth; the Markdown files are human-facing mirrors.

## Backend policy

`omk init` and `omk sync` write this policy to `.omk/config.toml` and `~/.kimi/omk.memory.toml`:

```toml
[memory]
backend = "local_graph"    # local_graph | kuzu
scope = "project-session"
strict = true
mirror_files = true
migrate_files = true

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"
```

`strict = true` means memory write failures are surfaced instead of silently dropping recall state. Local graph memory has no password or daemon requirement. Use `backend = "kuzu"` when you want the embedded Kuzu graph backend.

## Ontology mind map

Each write is decomposed into an ontology-based mind map. OMK creates nodes such as:

- `Project`, `Session`, `Memory`, `MemoryVersion`
- `Goal`, `Topic`, `Decision`, `Task`, `Risk`
- `Command`, `File`, `Evidence`, `Constraint`
- `Question`, `Answer`, `Concept`

Relationship types include:

- `HAS_SESSION`, `HAS_MEMORY`, `WROTE`, `UPDATES`
- `HAS_GOAL`, `HAS_TOPIC`, `HAS_DECISION`, `HAS_TASK`, `HAS_RISK`
- `HAS_COMMAND`, `HAS_FILE`, `HAS_EVIDENCE`, `HAS_CONSTRAINT`
- `HAS_QUESTION`, `HAS_ANSWER`, `HAS_CONCEPT`, `PART_OF`, `TOUCHES_FILE`

This lets the agent split long notes into a detailed project/session mind map without adding a runtime dependency.

## MCP tools

The built-in `omk-project` MCP server exposes graph memory tools:

- `omk_read_memory`
- `omk_write_memory`
- `omk_read_run_memory`
- `omk_write_run_memory`
- `omk_search_memory`
- `omk_memory_status`
- `omk_memory_ontology`
- `omk_memory_mindmap`
- `omk_graph_query`

## GraphQL-lite examples

OMK intentionally uses a small GraphQL-style dialect instead of adding a GraphQL server dependency:

```graphql
query {
  ontology { classes relationTypes }
}
```

```graphql
query {
  memory(path: "project.md") { path content }
}
```

```graphql
query {
  mindmap(query: "decision", limit: 30) { root nodes edges }
}
```

```graphql
query {
  nodes(type: "Task", query: "release", limit: 20) { id type label }
}
```

## Optional embedded Kuzu

Kuzu is the supported embedded graph database backend for projects that want Cypher-style graph queries without an external daemon:

```toml
[memory]
backend = "kuzu"
```

Kuzu stores its database under `.omk/memory/kuzu.db` and uses the same ontology decomposition as local graph memory.

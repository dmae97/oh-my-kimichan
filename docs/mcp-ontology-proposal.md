# Codex/OMK Goal + Ontology Graph MCP Proposal

This proposal is superseded by the current local graph + embedded Kuzu memory policy.

Current direction:

- `local_graph` remains the default, daemon-free ontology graph backend.
- `kuzu` is the supported embedded graph database backend for Cypher-style graph queries.
- External graph database credential blocks are not part of the runtime path.
- MCP memory tools (`omk_memory_mindmap`, `omk_graph_query`, `omk_search_memory`) should target local graph or Kuzu only.

See [`docs/local-graph-memory.md`](./local-graph-memory.md) for the active configuration and query examples.

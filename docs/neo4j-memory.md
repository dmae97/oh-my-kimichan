# Graph memory and Kuzu

OMK uses project-local ontology graph memory by default and supports the embedded Kuzu backend for Cypher-style graph queries. See [`docs/local-graph-memory.md`](./local-graph-memory.md) for the current memory policy, mind-map ontology, and MCP query examples.

Neo4j support has been removed from the runtime path; stale `[neo4j]` config blocks are ignored and should be deleted from local config files.

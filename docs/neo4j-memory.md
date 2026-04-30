# Graph memory and optional Neo4j

OMK now defaults to project-local ontology graph memory. See [`docs/local-graph-memory.md`](./local-graph-memory.md) for the default open-source setup, mind-map ontology, and GraphQL-lite MCP queries.

External Neo4j is optional. Enable it only when you want a running Neo4j server as the graph backend:

```toml
[memory]
backend = "neo4j"

[neo4j]
uri_env = "OMK_NEO4J_URI"
username_env = "OMK_NEO4J_USERNAME"
password_env = "OMK_NEO4J_PASSWORD"
database_env = "OMK_NEO4J_DATABASE"
uri = "bolt://localhost:7687"
username = "neo4j"
database = "neo4j"
auth = "basic"
```

Credentials must stay in environment variables or a secret manager. Never commit Neo4j passwords or memory secrets.

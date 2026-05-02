# Codex/OMK Goal + Neo4j Ontology Graph MCP Proposal

## 1. Summary

OMK's **Goal** feature provides structured goal intake, evidence collection, scoring, and control-loop orchestration. Today, Goal state lives in local files (`.omk/runs/*/goal.md`, `plan.md`) and in the project-local graph memory backend (`.omk/memory/graph-state.json`). This proposal outlines an architecture that:

1. **Uses Skills** to orchestrate goal workflows: intake → planning → execution → evidence → scoring → close.
2. **Uses MCP** as the canonical interface for Goal/Evidence/RunState/QualityGate access, ensuring any agent (Kimi, Codex, human) interacts with the same state machine.
3. **Expands the ontology graph** to model `Goal`, `Criterion`, `Evidence`, `Task`, `Risk`, `Decision`, and their relationships, backed by either the existing project-local graph or an optional Neo4j server.
4. **Provides a read-only GraphiQL developer UI** for ontology exploration, while restricting writes to validated MCP tools.

The design preserves OMK's existing defaults—no database daemon required, no secrets in repo—while making Neo4j a first-class optional backend for teams that need multi-agent, multi-session graph analytics.

---

## 2. MCP Profile Design

OMK defines five MCP profiles. Each profile is a curated set of MCP servers enabled for a specific context. Profiles are declared in `.omk/config.toml` under `[mcp.profiles]` and selected via `OMK_MCP_PROFILE` (default: `default`).

### 2.1 default

The baseline profile for every OMK project. It is safe to enable in CI, shared workspaces, and local development without additional credentials.

| Server | Purpose | Tools/Resources |
|--------|---------|-----------------|
| `omk-project` | Project state, memory, ontology, quality | `omk_read_memory`, `omk_write_memory`, `omk_graph_query`, `omk_run_quality_gate`, `omk_save_checkpoint`, `omk_list_runs`, `omk_get_project_info`, plus resource URIs for `goal://`, `run://`, `config://` |
| `mcp-inspector` | Dev verification only | Inspector UI for validating tool schema and responses; never auto-enabled in production |

**Security posture:** `omk_write_config` is opt-in via `OMK_MCP_ALLOW_WRITE_CONFIG=1`. `omk_graph_query` is read-only by design. All memory writes decompose into ontology nodes before persistence.

### 2.2 docs

Enabled when the task involves reading external documentation, API references, or release notes.

| Server | Purpose |
|--------|---------|
| `openaiDeveloperDocs` | OpenAI API/platform documentation (context7-compatible) |
| `context7` | Library/API doc retrieval via vector index |
| `fetch` / `web-reader` | Raw URL fetching with markdown extraction |

**Policy:** These servers are read-only. No project state is exposed to them. URLs must be allow-listed in `.omk/config.toml` when `OMK_ENV=ci`.

### 2.3 repo

Enabled when the task requires repository mutation history, issue tracking, or PR review.

| Server | Purpose |
|--------|---------|
| `github` | Issues, PRs, comments, labels, milestones |
| local git via CLI Skill | `git log`, `git diff`, `git blame`, worktree operations |

**Policy:** The `github` MCP requires `GITHUB_TOKEN` and respects repository-level token scopes. Local git operations never push; push is gated behind `OMK_GIT_ALLOW_PUSH=1` and a confirmation prompt.

### 2.4 browser

**NOT auto-enabled by default.** Enabled explicitly for UI verification, E2E flows, screenshot comparison, and visual regression.

| Server | Purpose |
|--------|---------|
| `playwright` | Browser automation, screenshot, DOM snapshot, trace recording |

**Policy:** Browser MCP runs in a sandboxed context. Screenshots are written to `.omk/screenshots/` and never uploaded automatically. Network interception is disabled unless `OMK_BROWSER_ALLOW_INTERCEPT=1`.

### 2.5 graph

The advanced graph profile for teams running a shared Neo4j instance.

| Server | Purpose |
|--------|---------|
| `omk-project-graph` | Project-specific Neo4j ontology adapter; provides the same `omk_graph_query` interface but routes to Neo4j Cypher |
| `neo4j-mcp` | Raw Cypher execution, schema introspection, index management (dev/admin mode only) |

**Policy:** `neo4j-mcp` requires `OMK_NEO4J_URI`, `OMK_NEO4J_USERNAME`, `OMK_NEO4J_PASSWORD`. It is never exposed to untrusted agents. `omk-project-graph` enforces read-only queries unless the caller has the `graph:write` capability.

---

## 3. Recommended Skills

Skills are the orchestration layer. Each skill is a reusable workflow template stored in `.kimi/skills/` or `.omk/skills/`. The Goal system delegates to these skills rather than embedding workflow logic in the MCP server.

| Skill | Purpose | When Used |
|-------|---------|-----------|
| `goal-intake` | Normalize raw natural-language goal into a typed `GoalSpec` | At session start, or when the user provides a new objective |
| `goal-control-loop` | Evidence collection, criterion scoring, missing-criteria detection, next-action recommendation | After each plan step, or on `omk_run_quality_gate` invocation |
| `repo-explorer` | Read-only exploration of repo files, tests, commands, and dependency graphs | During planning and evidence gathering |
| `quality-gate` | Enforce lint/typecheck/test/build/secret-scan policy before goal close | Before status transitions to `verifying` or `done` |
| `test-debug-loop` | fail → minimal fix → re-verify | When `quality-gate` reports a test failure |
| `security-review` | Audit MCP tool calls, secret exposure, shell injection, Neo4j auth, and GraphQL mutation safety | Before any `high` risk goal enters `verifying` |
| `docs-release` | Align README, MATURITY, CHANGELOG, and release notes with goal artifacts | When goal status reaches `done` |
| `neo4j-ontology` | Model Project/Goal/Evidence/Decision/Task/Risk nodes and relationships in Neo4j | When `backend = "neo4j"` or `"dual"` |
| `graph-query-review` | Review Cypher/GraphQL-lite queries for safety (no `DELETE`, no `SET` without `WHERE`) and performance (index usage) | Before executing user-provided queries via `omk_graph_query` |
| `mcp-server-dev` | Validate MCP tool/resource/prompt schema against the 2024-11-05 spec using `mcp-inspector` | During OMK development and server upgrades |

### Skill ↔ MCP Interaction Model

```
User Goal → goal-intake Skill → writes GoalSpec via omk_write_memory
                ↓
     goal-control-loop Skill ← reads GoalSpec + Evidence via omk_read_memory / omk_graph_query
                ↓
        quality-gate Skill → invokes omk_run_quality_gate
                ↓
     security-review Skill (if risk=high) → audits via omk_graph_query + local rules
                ↓
        docs-release Skill → updates files, writes Evidence via omk_write_memory
```

Skills are stateless; all mutable state flows through the `omk-project` MCP tools. This ensures that swapping a Skill implementation (e.g., from heuristic to LLM-based) does not corrupt project history.

---

## 4. Neo4j Ontology + GraphiQL

### 4.1 Core Model

The ontology expands the existing local-graph node/edge schema to fully represent the Goal lifecycle and project structure. The model is compatible with both the local JSON graph backend and Neo4j.

#### Node Types

| Node Label | Key Properties | Description |
|------------|----------------|-------------|
| `Project` | `projectId`, `workspaceRootHash`, `schemaVersion`, `name`, `createdAt` | Root of every graph |
| `Goal` | `goalId`, `title`, `status`, `riskLevel`, `planRevision`, `createdAt`, `updatedAt` | A user objective with success criteria |
| `Criterion` | `criterionId`, `description`, `requirement`, `weight`, `inferred` | Success criterion attached to a Goal |
| `Evidence` | `evidenceId`, `passed`, `message`, `checkedAt`, `evidenceType` | Outcome of evaluating a criterion or artifact |
| `Task` | `taskId`, `description`, `status`, `priority` | Planned work item |
| `Risk` | `riskId`, `description`, `level`, `mitigation` | Identified project risk |
| `Decision` | `decisionId`, `description`, `rationale`, `decidedAt` | Architecture or design decision |
| `File` | `path`, `hash`, `language` | Source file touched during a run |
| `Symbol` | `name`, `kind`, `line` | Function, class, variable, etc. |
| `Test` | `testId`, `name`, `status`, `durationMs` | Individual test case result |
| `Command` | `command`, `exitCode`, `durationMs` | Executed shell command |
| `Commit` | `sha`, `message`, `author`, `timestamp` | Git commit |
| `MCPServer` | `serverName`, `profile`, `version` | Active MCP server in a run |
| `Skill` | `skillName`, `version`, `invokedAt` | Skill invoked during execution |
| `Memory` | `path`, `contentHash`, `sessionId` | Project memory entry |
| `Session` | `sessionId`, `startedAt`, `endedAt` | Agent execution session |

#### Relationship Types

```cypher
(Project)-[:HAS_GOAL]->(Goal)
(Project)-[:HAS_TASK]->(Task)
(Project)-[:HAS_RISK]->(Risk)
(Project)-[:HAS_DECISION]->(Decision)
(Project)-[:HAS_SESSION]->(Session)
(Project)-[:HAS_MEMORY]->(Memory)

(Goal)-[:HAS_CRITERION]->(Criterion)
(Goal)-[:HAS_EVIDENCE]->(Evidence)
(Goal)-[:DEPENDS_ON]->(Goal)           // goal chaining

(Criterion)-[:EVALUATED_BY]->(Evidence)
(Evidence)-[:GENERATED_IN]->(Session)

(Task)-[:DEPENDS_ON]->(Task)           // task DAG
(Task)-[:SATISFIES]->(Criterion)
(Task)-[:TOUCHES_FILE]->(File)
(Task)-[:INVOKES_SKILL]->(Skill)

(File)-[:CONTAINS_SYMBOL]->(Symbol)
(File)-[:TESTED_BY]->(Test)
(File)-[:CHANGED_IN]->(Commit)

(Session)-[:USED_MCP]->(MCPServer)
(Session)-[:RAN_COMMAND]->(Command)
(Session)-[:PRODUCED]->(Evidence)

(Skill)-[:REQUIRES_MCP]->(MCPServer)
```

#### Example: Full Goal Subgraph

```cypher
MATCH (p:Project {projectId: $pid})-[:HAS_GOAL]->(g:Goal {goalId: $gid})
OPTIONAL MATCH (g)-[:HAS_CRITERION]->(c:Criterion)
OPTIONAL MATCH (c)-[:EVALUATED_BY]->(e:Evidence)
OPTIONAL MATCH (g)-[:HAS_EVIDENCE]->(ge:Evidence)
RETURN g, collect(DISTINCT c) AS criteria, collect(DISTINCT e) AS criterionEvidence, collect(DISTINCT ge) AS goalEvidence
```

### 4.2 Write Path

All graph mutations are **restricted to validated MCP tools**. Direct Cypher `CREATE`/`SET`/`DELETE` is never exposed to agent Skills.

| Operation | MCP Tool | Validation |
|-----------|----------|------------|
| Create Goal | `omk_goal_create` | Schema validation against `GoalSpec`; `projectId` injected server-side |
| Add Evidence | `omk_evidence_add` | `goalId` must exist; `criterionId` must belong to goal; `passed` is boolean only |
| Update Memory | `omk_write_memory` | Path traversal guard (`safePath`); content decomposed into ontology nodes by `MemoryStore` |
| Write Run Memory | `omk_write_run_memory` | Same as above, scoped to `runId` |
| Save Checkpoint | `omk_save_checkpoint` | Git diff + todo state; no arbitrary file writes |

**Implementation detail:** The `omk-project` MCP server already decomposes memory writes into ontology nodes (see `src/memory/local-graph-memory-store.ts`). This proposal extends the decomposition rules to emit `Goal`, `Criterion`, `Evidence`, `Task`, and `Risk` nodes when the memory path matches `goal/*.md` or `runs/*/goal.md`.

### 4.3 Read Path

| Operation | Interface | Access |
|-----------|-----------|--------|
| GraphQL-lite query | `omk_graph_query` | All agents; read-only |
| Cypher query (Neo4j backend) | `omk_graph_query` with `dialect: "cypher"` | Agents with `graph:read` capability |
| GraphiQL developer UI | `http://localhost:7474/omk/graphiql` (Neo4j) or bundled dev server (local graph) | Human developers only; auto-generated from live ontology |

The existing GraphQL-lite dialect (see `docs/local-graph-memory.md`) is preserved:

```graphql
query {
  ontology { classes relationTypes }
}
```

```graphql
query {
  goal(goalId: "add-auth-2026-05-02T10-44-30Z") {
    title
    status
    criteria { description requirement weight }
    evidence { passed message checkedAt }
  }
}
```

```graphql
query {
  mindmap(query: "risk", limit: 20) { root nodes edges }
}
```

For Neo4j backends, `omk_graph_query` transparently translates a safe subset of GraphQL-lite into Cypher, or accepts raw Cypher when the caller declares `dialect: "cypher"`.

### 4.4 Project Isolation

Every node in the graph carries three isolation properties:

| Property | Type | Constraint | Purpose |
|----------|------|------------|---------|
| `projectId` | string | indexed, equality-filtered | Logical project boundary |
| `workspaceRootHash` | string | indexed | Derived from `sha256(projectRoot)`; prevents collisions when two repos share a name |
| `schemaVersion` | string | range-filtered | Ontology schema version (e.g., `"omk-ontology-v2"`) |

**Constraints (Neo4j):**
```cypher
CREATE CONSTRAINT goal_unique IF NOT EXISTS
FOR (g:Goal) REQUIRE (g.projectId, g.goalId) IS UNIQUE;

CREATE CONSTRAINT criterion_unique IF NOT EXISTS
FOR (c:Criterion) REQUIRE (c.projectId, c.criterionId) IS UNIQUE;
```

**Local graph equivalent:** In-memory `Map` indexes on `(projectId, nodeType, id)` with O(1) lookup.

---

## 5. Implementation Phases

| Phase | Deliverable | MCP Changes | Skill Changes | Risk |
|-------|-------------|-------------|---------------|------|
| **P0** | `omk-project` MCP tools for goal, evidence, run, quality | Add `omk_goal_create`, `omk_goal_read`, `omk_goal_update_status`, `omk_evidence_add`, `omk_list_goals`; extend `omk_read_run` to return `evidence` array | `goal-intake` calls `omk_goal_create`; `goal-control-loop` calls `omk_evidence_add` + `omk_goal_update_status` | Low: builds on existing `omk-project-server.ts` |
| **P1** | Resource + Prompt support in `omk-project` MCP | Add `resources/list`, `resources/read`, `prompts/list`, `prompts/get` handlers; expose `goal://{goalId}`, `run://{runId}`, `memory://{path}` as resources; expose `prompt://goal-summary` and `prompt://evidence-template` | `goal-control-loop` fetches `prompt://evidence-template` before asking the model to format evidence | Low: MCP spec already supports resources/prompts |
| **P2** | Neo4j ontology model + read-only graph query | Extend `LocalGraphMemoryStore` decomposition rules to emit Goal/Criterion/Evidence/Task/Risk nodes; add `Neo4jOntologyStore` adapter implementing the same `MemoryStore` interface; add `omk_graph_query` Cypher passthrough behind capability gate | `neo4j-ontology` Skill validates schema migration; `graph-query-review` Skill audits queries | Medium: schema migration must be backward-compatible |
| **P3** | GraphiQL developer UI | Bundled dev server (`omk graphiql`) serving a read-only GraphiQL instance over local graph; optional Neo4j Browser link when backend is Neo4j | None | Low: UI is read-only wrapper |
| **P4** | Skill templates for goal-intake, control-loop, quality-gate | Ship `goal-intake`, `goal-control-loop`, `quality-gate` as default Skills in `templates/skills/`; add `omk init --with-goal-skills` flag | None | Low: templates are additive |

### P0 Detail: Goal + Evidence MCP Tools

The following tools extend the existing `omk-project-server.ts`:

```typescript
// omk_goal_create
interface CreateGoalArgs {
  rawPrompt: string;
  title?: string;
  objective?: string;
  successCriteria?: Array<{ description: string; requirement?: "required" | "optional"; weight?: number }>;
  constraints?: string[];
  nonGoals?: string[];
  expectedArtifacts?: Array<{ name: string; path?: string; gate?: "file-exists" | "command-pass" | "summary" }>;
}
// Returns: { goalId: string; spec: GoalSpec }

// omk_goal_read
interface ReadGoalArgs { goalId: string; }
// Returns: { spec: GoalSpec; evidence: GoalEvidence[]; score: GoalScore }

// omk_goal_update_status
interface UpdateGoalStatusArgs { goalId: string; status: GoalStatus; planRevision?: number; runId?: string; }
// Returns: { spec: GoalSpec }

// omk_evidence_add
interface AddEvidenceArgs {
  goalId: string;
  criterionId: string;
  passed: boolean;
  message?: string;
  ref?: string;
  evidenceType?: "criterion" | "artifact" | "constraint";
}
// Returns: { evidenceId: string; checkedAt: string }

// omk_list_goals
interface ListGoalsArgs { status?: GoalStatus; limit?: number; }
// Returns: { goals: Array<{ goalId: string; title: string; status: string; updatedAt: string }> }
```

### P1 Detail: Resources and Prompts

**Resources:**

| URI | MIME Type | Content |
|-----|-----------|---------|
| `goal://{goalId}` | `application/json` | Full `GoalSpec` + evidence + score |
| `run://{runId}` | `application/json` | `goal.md`, `plan.md`, `todos`, and checkpoint list |
| `memory://{path}` | `text/markdown` | Raw memory file from `.omk/memory/` |
| `config://default` | `text/toml` | `.omk/config.toml` (sanitized) |
| `ontology://current` | `application/json` | Current ontology classes and relation types |

**Prompts:**

| URI | Description |
|-----|-------------|
| `prompt://goal-summary` | Formatted summary of a goal for model context windows |
| `prompt://evidence-template` | Template for structuring evidence before `omk_evidence_add` |
| `prompt://quality-gate-report` | Human-readable quality gate failure report |

### P2 Detail: Neo4j Ontology Adapter

The existing `MemoryStore` abstraction (see `src/memory/memory-store.ts`) already supports pluggable backends. This phase adds a `Neo4jOntologyStore` that:

1. Implements the same `read`, `write`, `search`, `graphQuery`, `mindmap` interface.
2. Decomposes memory writes into Cypher `MERGE` statements for the ontology nodes.
3. Uses parameterized queries to prevent injection.
4. Falls back to the local JSON graph if Neo4j is unreachable and `strict = false`.

```typescript
// src/memory/neo4j-ontology-store.ts (extension of existing neo4j-memory-store.ts)
class Neo4jOntologyStore implements MemoryBackend {
  async write(path: string, content: string): Promise<void> {
    const nodes = decomposeToOntology(path, content);
    const tx = this.session.beginTransaction();
    for (const node of nodes) {
      await tx.run(
        `MERGE (n:${node.type} {projectId: $projectId, id: $id})
         SET n += $props`,
        { projectId: this.projectId, id: node.id, props: node.properties }
      );
    }
    for (const edge of nodes.flatMap((n) => n.edges)) {
      await tx.run(
        `MATCH (a {projectId: $projectId, id: $from}), (b {projectId: $projectId, id: $to})
         MERGE (a)-[r:${edge.type}]->(b)
         SET r += $props`,
        { projectId: this.projectId, from: edge.from, to: edge.to, props: edge.properties }
      );
    }
    await tx.commit();
  }
}
```

### P3 Detail: GraphiQL Developer UI

For the local graph backend:

```bash
omk graphiql
# → starts http://localhost:7474/omk/graphiql
# → read-only; executes omk_graph_query against the local JSON graph
# → schema explorer generated from live ontology classes/relations
```

For Neo4j:
```bash
omk graphiql --backend neo4j
# → opens Neo4j Browser (or a bundled read-only GraphiQL) connected to the configured instance
# → write operations disabled at the MCP layer, not just the UI layer
```

### P4 Detail: Skill Templates

New templates shipped under `templates/skills/goal/`:

```
templates/skills/
├── goal/
│   ├── goal-intake/
│   │   └── SKILL.md
│   ├── goal-control-loop/
│   │   └── SKILL.md
│   └── quality-gate/
│       └── SKILL.md
```

Each Skill template contains:
- **Purpose**: When to invoke.
- **MCP Tools**: Required `omk-project` tools.
- **Prompts**: System instructions for the model.
- **State Machine**: Valid transitions and preconditions.

---

## 6. Security Considerations

| Threat | Mitigation |
|--------|------------|
| Path traversal in memory writes | Existing `safePath` guard + `realpath` resolution |
| Cypher injection | Parameterized queries only; no string interpolation |
| Arbitrary graph mutation | Writes only through validated MCP tools; `omk_graph_query` is read-only |
| Secret leakage into graph | Secrets are never decomposed into ontology nodes; memory paths matching `*.secret.*` or `.env*` are rejected |
| Neo4j credential exposure | Credentials in env vars only; `OMK_NEO4J_PASSWORD` never logged |
| Privilege escalation via `neo4j-mcp` | `neo4j-mcp` requires `graph:admin` capability; not granted to default agents |

---

## 7. Migration Path

1. **Existing projects** continue to work without changes. The local JSON graph backend remains the default.
2. **Enable Goal tracking** by running `omk init --with-goal-skills`. This adds the new MCP tools and Skill templates.
3. **Enable Neo4j** by setting `backend = "neo4j"` or `"dual"` in `.omk/config.toml` and providing environment variables.
4. **Schema migration** is handled by `schemaVersion` on every node. Old nodes without the new Goal/Criterion types are lazily upgraded on first write.

---

## 8. Appendix: Relation to Existing OMK Components

| Component | Current State | Proposal Change |
|-----------|--------------|-----------------|
| `src/goal/intake.ts` | Heuristic goal normalization | Skill calls `omk_goal_create`; logic stays, output goes to MCP |
| `src/goal/control-loop.ts` | Evaluates progress via local scoring | Skill orchestrates; MCP provides canonical evidence store |
| `src/goal/evidence.ts` | Stub criterion checks + artifact gates | Full gate implementation; evidence persisted via `omk_evidence_add` |
| `src/mcp/omk-project-server.ts` | 30+ tools for memory, config, quality, checkpoints | Add 5 Goal/Evidence tools + resources/prompts |
| `src/memory/local-graph-memory-store.ts` | JSON graph with Project/Session/Memory/Task nodes | Extend decomposition to Goal/Criterion/Evidence/Risk |
| `src/memory/neo4j-memory-store.ts` | Basic Neo4j adapter | Upgrade to `Neo4jOntologyStore` with full ontology mapping |
| `.kimi/skills/omk-quality-gate` | Runs lint/test/typecheck/build | Invokes `omk_run_quality_gate`; reads settings via MCP |
| `.kimi/skills/omk-plan-first` | Planning workflow | Can query `goal://{goalId}` resource for context |

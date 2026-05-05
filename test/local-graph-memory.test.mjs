import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadMemorySettings } from "../dist/memory/memory-config.js";
import { MemoryStore } from "../dist/memory/memory-store.js";

test("local graph memory is the default backend", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-default-"));
  try {
    const settings = await loadMemorySettings(projectRoot, { OMK_MEMORY_FORCE: "0" });

    assert.equal(settings.backend, "local_graph");
    assert.equal(settings.localGraph.ontology, "omk-ontology-mindmap-v1");
    assert.match(settings.localGraph.path, /graph-state\.json$/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("stale Neo4j config is ignored without warnings", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-legacy-"));
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(
      join(projectRoot, ".omk", "config.toml"),
      '[memory]\nbackend = "neo4j"\n\n[neo4j]\nusername = "legacy-user"\n'
    );

    const settings = await loadMemorySettings(projectRoot, { OMK_MEMORY_FORCE: "0" });
    assert.equal(settings.backend, "local_graph");
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = previousWarn;
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("local graph memory writes ontology mindmaps and GraphQL-lite results", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-local-graph-"));
  const graphPath = join(projectRoot, ".omk", "memory", "graph-state.json");
  const env = {
    OMK_MEMORY_BACKEND: "local_graph",
    OMK_MEMORY_FORCE: "0",
    OMK_MEMORY_STRICT: "true",
    OMK_LOCAL_GRAPH_PATH: graphPath,
  };
  const store = new MemoryStore(join(projectRoot, ".omk", "memory"), {
    projectRoot,
    sessionId: "test-session",
    source: "node-test",
    env,
  });

  try {
    await store.write(
      "project.md",
      `# Goal: local graph memory\n\n- Decision: keep memory in .omk/memory/graph-state.json\n- Task: expose omk_graph_query\n- Risk: never store secrets\n\n\`\`\`bash\nnpm run check\n\`\`\``
    );

    assert.equal(existsSync(graphPath), true);
    assert.match(await store.read("project.md"), /local graph memory/);

    const ontology = await store.ontology();
    assert.ok(ontology?.classes.includes("Decision"));

    const mindmap = await store.mindmap("Decision", 20);
    assert.ok(mindmap?.nodes.some((node) => node.type === "Decision"));
    assert.ok(mindmap?.edges.some((edge) => edge.type === "HAS_DECISION" || edge.type === "HAS_CONCEPT"));

    const graphQuery = await store.graphQuery('query { mindmap(query: "Task", limit: 10) { nodes edges } ontology { classes } }');
    assert.equal(graphQuery.extensions.dialect, "omk-graphql-lite-v1");
    assert.match(JSON.stringify(graphQuery.data), /Task/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

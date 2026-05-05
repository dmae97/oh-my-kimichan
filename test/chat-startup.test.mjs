import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { ensureChatStartupArtifacts, formatChatStartupDate } = await import("../dist/util/chat-startup.js");

test("chat startup creates dated docs and local ontology graph", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-chat-startup-"));
  const now = new Date("2026-05-05T12:00:00");
  const date = formatChatStartupDate(now);

  try {
    const report = await ensureChatStartupArtifacts({
      root: projectRoot,
      runId: "chat-bootstrap-test",
      now,
      env: { OMK_MEMORY_FORCE: "0" },
    });

    assert.equal(date, "2026-05-05");
    assert.ok(report.created.includes(`docs/${date}/plan.md`));
    assert.equal(existsSync(join(projectRoot, "docs", date, "improvements.md")), true);
    assert.equal(existsSync(join(projectRoot, "docs", date, "critical-issues.md")), true);
    assert.equal(existsSync(join(projectRoot, "docs", date, "init-checklist.md")), true);

    const graphPath = join(projectRoot, ".omk", "memory", "graph-state.json");
    assert.equal(existsSync(graphPath), true);
    const graph = JSON.parse(await readFile(graphPath, "utf-8"));
    assert.equal(graph.ontology.version, "omk-ontology-mindmap-v1");
    assert.ok(
      graph.nodes.some((node) => node.type === "Memory" && node.path === `daily/${date}/plan.md`),
      "daily plan should be indexed in the ontology graph"
    );

    const checklist = await readFile(join(projectRoot, "docs", date, "init-checklist.md"), "utf-8");
    assert.match(checklist, /Required Init Checklist/);
    assert.match(checklist, /graph-state\.json/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("chat startup is idempotent and does not overwrite daily docs", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-chat-startup-idempotent-"));
  const now = new Date("2026-05-05T12:00:00");
  const date = formatChatStartupDate(now);
  const planPath = join(projectRoot, "docs", date, "plan.md");

  try {
    await ensureChatStartupArtifacts({
      root: projectRoot,
      runId: "chat-bootstrap-test",
      now,
      env: { OMK_MEMORY_FORCE: "0" },
    });
    await writeFile(planPath, "# User edited plan\n", "utf-8");

    const second = await ensureChatStartupArtifacts({
      root: projectRoot,
      runId: "chat-bootstrap-test-2",
      now,
      env: { OMK_MEMORY_FORCE: "0" },
    });

    assert.equal(await readFile(planPath, "utf-8"), "# User edited plan\n");
    assert.ok(second.existing.includes(`docs/${date}/plan.md`));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

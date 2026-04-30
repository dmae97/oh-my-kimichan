import test from "node:test";
import assert from "node:assert/strict";

import { buildHudSidebar, parseGitStatusPorcelain, renderHudColumns } from "../dist/commands/hud.js";

test("HUD parses porcelain git changes for changed file sidebar", () => {
  const changes = parseGitStatusPorcelain(" M README.md\nA  src/new.ts\nR  old.ts -> src/renamed.ts\n?? test/hud-sidebar.test.mjs\n");

  assert.deepEqual(changes, [
    { status: "M", path: "README.md" },
    { status: "A", path: "src/new.ts" },
    { status: "R", path: "src/renamed.ts" },
    { status: "??", path: "test/hud-sidebar.test.mjs" },
  ]);
});

test("HUD sidebar renders run TODOs and changed files", () => {
  const sidebar = buildHudSidebar(
    {
      runId: "test-run",
      startedAt: new Date(0).toISOString(),
      nodes: [
        { id: "plan", name: "Plan the work", role: "planner", dependsOn: [], status: "done", retries: 0, maxRetries: 1 },
        { id: "code", name: "Implement HUD sidebar", role: "coder", dependsOn: ["plan"], status: "running", retries: 0, maxRetries: 1 },
      ],
    },
    [{ status: "M", path: "src/commands/hud.ts" }]
  );

  assert.match(sidebar, /TODO/);
  assert.match(sidebar, /Implement HUD sidebar/);
  assert.match(sidebar, /Changed Files/);
  assert.match(sidebar, /src\/commands\/hud\.ts/);
});

test("HUD layout can place sidebar beside main panels on wide terminals", () => {
  const layout = renderHudColumns(["LEFT"], "RIGHT", 120);
  assert.match(layout, /LEFT\s+RIGHT/);
});

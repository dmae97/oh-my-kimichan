import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function checkIgnored(path) {
  return spawnSync("git", ["check-ignore", "-q", path], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
}

test("gitignore ignores generated daily docs without hiding authored docs", async () => {
  const gitignore = await readFile(".gitignore", "utf-8");
  assert.doesNotMatch(gitignore, /^\/docs\/$/m);

  assert.equal(checkIgnored("docs/new-guide.md").status, 1);
  assert.equal(checkIgnored("docs/2026-05-05/plan.md").status, 0);
  assert.equal(checkIgnored("docs/2026-05-05-plan.md").status, 0);
  assert.equal(checkIgnored("docs/2026-05-05-critical-issues-and-improvements.md").status, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveQualityCommand, runQualityGate } from "../dist/mcp/quality-gate.js";

test("quality gate blocks shell command strings from config", () => {
  const command = resolveQualityCommand("npm run lint && touch /tmp/omk-pwned", "lint", "npm", new Set(["lint"]));

  assert.equal(command.command, "[blocked unsafe quality command]");
  assert.equal(command.blocked, true);
});

test("quality gate accepts package script names and package-manager run syntax", () => {
  const availableScripts = new Set(["lint"]);

  assert.deepEqual(
    resolveQualityCommand("lint", "lint", "npm", availableScripts),
    { command: "npm run lint", executable: "npm", args: ["run", "lint"] }
  );
  assert.deepEqual(
    resolveQualityCommand("pnpm run lint", "lint", "npm", availableScripts),
    { command: "pnpm run lint", executable: "pnpm", args: ["run", "lint"] }
  );
});

test("quality gate maps auto typecheck to check when typecheck script is absent", () => {
  const availableScripts = new Set(["check"]);

  assert.deepEqual(
    resolveQualityCommand("auto", "typecheck", "npm", availableScripts),
    { command: "npm run check", executable: "npm", args: ["run", "check"] }
  );
});

test("runQualityGate reports blocked config without executing the injected command", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-quality-gate-"));
  const marker = join(projectRoot, "pwned");

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          type: "module",
          scripts: {
            lint: "node -e \"console.log('lint ok')\"",
          },
        },
        null,
        2
      )
    );

    const result = await runQualityGate(
      projectRoot,
      `[quality]
lint = "npm run lint && touch pwned"
typecheck = "off"
test = "off"
build = "off"
`
    );

    assert.equal(result.lint.exitCode, 126);
    assert.match(result.lint.stderr, /blocked unsafe quality command/);
    assert.equal(existsSync(marker), false);
    assert.equal(result.typecheck.exitCode, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

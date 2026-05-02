import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveQualityCommand, runQualityGate, printQualityGateResults } from "../dist/mcp/quality-gate.js";

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
    assert.equal(result.lint.status, "blocked");
    assert.equal(result.lint.failureType, "mcp-error");
    assert.match(result.lint.stderr, /blocked unsafe quality command/);
    assert.equal(existsSync(marker), false);
    assert.equal(result.typecheck.exitCode, 0);
    assert.equal(result.typecheck.status, "skipped");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runQualityGate treats non-empty stdout as passed when exitCode is 0", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-quality-gate-stdout-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          type: "module",
          scripts: {
            lint: "node -e \"console.log('warning: unused import')\"",
          },
        },
        null,
        2
      )
    );

    const result = await runQualityGate(
      projectRoot,
      `[quality]
lint = "lint"
typecheck = "off"
test = "off"
build = "off"
`
    );

    assert.equal(result.lint.exitCode, 0);
    assert.equal(result.lint.status, "passed");
    assert.equal(result.lint.failureType, null);
    assert.match(result.lint.stdout, /warning/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runQualityGate classifies stderr failure separately", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-quality-gate-stderr-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          type: "module",
          scripts: {
            lint: "node -e \"console.error('lint error'); process.exit(1)\"",
          },
        },
        null,
        2
      )
    );

    const result = await runQualityGate(
      projectRoot,
      `[quality]
lint = "lint"
typecheck = "off"
test = "off"
build = "off"
`
    );

    assert.equal(result.lint.exitCode, 1);
    assert.equal(result.lint.status, "failed");
    assert.equal(result.lint.failureType, "exit-code");
    assert.match(result.lint.stderr, /lint error/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runQualityGate saves logs to .omk/logs/quality-gate/", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-quality-gate-log-"));

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
lint = "lint"
typecheck = "off"
test = "off"
build = "off"
`
    );

    assert.ok(result.lint.logPath, "logPath should be set");
    assert.ok(existsSync(result.lint.logPath), "log file should exist");

    const logContent = await readFile(result.lint.logPath, "utf-8");
    assert.match(logContent, /gate: lint/);
    assert.match(logContent, /status: passed/);
    assert.match(logContent, /failureType: none/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runQualityGate runs all configured gates", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-quality-gate-all-gates-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          type: "module",
          scripts: {
            lint: "node -e \"console.log('lint')\"",
            typecheck: "node -e \"console.log('typecheck')\"",
            test: "node -e \"console.log('test')\"",
            build: "node -e \"console.log('build')\"",
          },
        },
        null,
        2
      )
    );

    const result = await runQualityGate(
      projectRoot,
      `[quality]
lint = "lint"
typecheck = "typecheck"
test = "test"
build = "build"
`
    );

    // All gates should have completed (passed)
    assert.equal(result.lint.status, "passed");
    assert.equal(result.typecheck.status, "passed");
    assert.equal(result.test.status, "passed");
    assert.equal(result.build.status, "passed");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("printQualityGateResults formats output correctly", async () => {
  const results = {
    lint: { command: "npm run lint", exitCode: 0, stdout: "", stderr: "", status: "passed", failureType: null },
    typecheck: { command: "npm run typecheck", exitCode: 1, stdout: "", stderr: "error", status: "failed", failureType: "exit-code" },
    test: { command: "", exitCode: 0, stdout: "", stderr: "skipped (off)", status: "skipped", failureType: null },
    build: { command: "npm run build", exitCode: 0, stdout: "", stderr: "", status: "passed", failureType: null, logPath: "/tmp/build.log" },
  };

  const text = printQualityGateResults(results);
  assert.match(text, /✓ lint: passed/);
  assert.match(text, /✗ typecheck: failed \(exit-code\)/);
  assert.match(text, /○ test: skipped/);
  assert.match(text, /✓ build: passed/);
  assert.match(text, /\[log: \/tmp\/build\.log\]/);

  const printText = printQualityGateResults(results, true);
  assert.match(printText, /\{"qualityGates":/);
});

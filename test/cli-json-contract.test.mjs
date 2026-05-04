import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { goalListCommand, goalShowCommand, goalVerifyCommand } from "../dist/commands/goal.js";
import { runsCommand } from "../dist/commands/runs.js";
import { verifyCommand } from "../dist/commands/verify.js";
import { reviewCommand } from "../dist/commands/workflow.js";
import { CliError } from "../dist/util/cli-contract.js"; 

async function tempCwd() {
  const dir = await mkdtemp(join(tmpdir(), "omk-cli-"));
  await mkdir(join(dir, ".omk"), { recursive: true });
  return dir;
}

function captureOutput() {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

// ── goal --json contract ──────────────────────────────────────

test("goal list --json skips alpha warning and outputs parseable JSON", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  try {
    await goalListCommand({ json: true });
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(Array.isArray(parsed), "should be an array");
  assert.equal(cap.stderr.length, 0, "should not emit to stderr");
  assert.ok(!cap.stdout[0].includes("alpha"), "should not contain alpha warning");
});

test("goal show --json on missing goal emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await goalShowCommand("nonexistent", { json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.ok(parsed.error.includes("not found"), "error should mention not found");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

test("goal verify --json on missing goal emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await goalVerifyCommand("nonexistent", { json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

// ── runs --json contract ──────────────────────────────────────

test("runs --json on fresh project emits empty JSON array", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  const prevRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = cwd;
  process.chdir(cwd);
  const cap = captureOutput();

  try {
    await runsCommand({ json: true });
  } finally {
    cap.restore();
    process.chdir(prevCwd);
    if (prevRoot !== undefined) process.env.OMK_PROJECT_ROOT = prevRoot;
    else delete process.env.OMK_PROJECT_ROOT;
  }

  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(Array.isArray(parsed), "should be an array");
  assert.equal(parsed.length, 0, "should be empty");
});

// ── verify --json contract ────────────────────────────────────

test("verify --json with missing run emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await verifyCommand({ run: "missing-run", json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

test("verify --json with missing run-id env emits JSON error to stdout and stderr", async () => {
  const cwd = await tempCwd();
  const prevCwd = process.cwd();
  const prevRunId = process.env.OMK_RUN_ID;
  delete process.env.OMK_RUN_ID;
  process.chdir(cwd);
  const cap = captureOutput();

  let thrown = false;
  try {
    await verifyCommand({ json: true });
  } catch (err) {
    thrown = true;
    assert.ok(err instanceof CliError, "should throw CliError");
  } finally {
    cap.restore();
    process.chdir(prevCwd);
    if (prevRunId !== undefined) process.env.OMK_RUN_ID = prevRunId;
  }

  assert.ok(thrown, "should throw");
  assert.equal(cap.stdout.length, 1, "should emit exactly one stdout line");
  const parsed = JSON.parse(cap.stdout[0]);
  assert.ok(parsed.error, "should contain error field");
  assert.equal(cap.stderr.length, 1, "should emit to stderr");
});

// ── review --soft contract ────────────────────────────────────
// Note: review-options.test.mjs covers --ci --soft exit-code behavior in depth.
// The subprocess approach there correctly isolates OMK_PROJECT_ROOT.

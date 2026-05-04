import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseSemverParts, compareVersions, isOutdated } from "../dist/util/update-check.js";

test("parseSemverParts parses valid semver", () => {
  assert.deepEqual(parseSemverParts("1.41.0"), [1, 41, 0]);
  assert.deepEqual(parseSemverParts("0.4.0"), [0, 4, 0]);
  assert.deepEqual(parseSemverParts("10.20.30"), [10, 20, 30]);
});

test("parseSemverParts returns null for invalid input", () => {
  assert.equal(parseSemverParts(""), null);
  assert.equal(parseSemverParts("abc"), null);
  assert.equal(parseSemverParts("1.2"), null);
  assert.equal(parseSemverParts("1.2.3-beta"), null);
});

test("compareVersions orders correctly", () => {
  assert.strictEqual(compareVersions("1.41.0", "1.40.0"), 1);
  assert.strictEqual(compareVersions("1.40.0", "1.41.0"), -1);
  assert.strictEqual(compareVersions("1.41.0", "1.41.0"), 0);
  assert.strictEqual(compareVersions("2.0.0", "1.99.99"), 1);
  assert.strictEqual(compareVersions("1.0.1", "1.0.2"), -1);
});

test("compareVersions returns 0 for unparseable versions", () => {
  assert.strictEqual(compareVersions("bad", "1.0.0"), 0);
  assert.strictEqual(compareVersions("1.0.0", "bad"), 0);
});

test("isOutdated detects outdated versions", () => {
  assert.strictEqual(isOutdated("1.40.0", "1.41.0"), true);
  assert.strictEqual(isOutdated("1.41.0", "1.41.0"), false);
  assert.strictEqual(isOutdated("2.0.0", "1.99.99"), false);
  assert.strictEqual(isOutdated("1.0.0", "1.0.1"), true);
});

test("isOutdated handles local newer than latest", () => {
  assert.strictEqual(isOutdated("99.0.0", "1.0.0"), false);
});

test("checkUpdates returns expected structure via import", async () => {
  const { checkUpdates } = await import("../dist/util/update-check.js");
  const status = await checkUpdates();
  assert.strictEqual(typeof status.omk.current, "string");
  assert.strictEqual(typeof status.kimi.installCmd, "string");
  assert.strictEqual(typeof status.kimi.fallbackInstallCmd, "string");
  assert.strictEqual(typeof status.checkedAt, "string");
  assert.strictEqual(typeof status.cacheHit, "boolean");
  const jsonStr = JSON.stringify(status);
  assert.ok(!jsonStr.includes("\u001b"), "JSON contains ANSI codes");
  assert.ok(!jsonStr.includes("\\u001b"), "JSON contains escaped ANSI codes");
  assert.ok(status.kimi.fallbackInstallCmd.length > 0, "fallbackInstallCmd is empty");
});

test("omk update check --json outputs valid JSON", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-cli-test-"));
  const cliJs = join(process.cwd(), "dist", "cli.js");
  const result = spawnSync("node", [cliJs, "update", "check", "--json", "--refresh"], {
    cwd: tmpDir,
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, OMK_NO_STAR: "1" },
  });
  const status = JSON.parse(result.stdout);
  assert.strictEqual(typeof status.omk.current, "string");
  assert.strictEqual(typeof status.kimi.fallbackInstallCmd, "string");
  assert.strictEqual(typeof status.kimi.installScript, "string");
  assert.strictEqual(typeof status.cacheHit, "boolean");
});

test("omk update kimi --install-script prints install script", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-cli-test-"));
  const cliJs = join(process.cwd(), "dist", "cli.js");
  const result = spawnSync("node", [cliJs, "update", "kimi", "--install-script", "--refresh"], {
    cwd: tmpDir,
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, OMK_NO_STAR: "1" },
  });
  const output = result.stdout.trim();
  assert.ok(
    output.includes("curl") || output.includes("Invoke-RestMethod") || output.includes(".com/install"),
    `Expected install script output, got: ${output}`
  );
});

test("omk update kimi non-TTY exits with error", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-cli-test-"));
  const cliJs = join(process.cwd(), "dist", "cli.js");
  const result = spawnSync("node", [cliJs, "update", "kimi"], {
    cwd: tmpDir,
    encoding: "utf-8",
    timeout: 30000,
    stdio: "pipe",
    env: { ...process.env, OMK_NO_STAR: "1" },
  });
  assert.ok(
    result.status !== 0 || result.stderr.toLowerCase().includes("tty"),
    `Expected non-TTY error, got exit ${result.status}: ${result.stderr}`
  );
});

#!/usr/bin/env node
/**
 * Cross-platform smoke test for oh-my-kimichan.
 * Replaces the inline shell steps in .github/workflows/smoke-test.yml
 * so the workflow runs cleanly on Windows, macOS, and Linux.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

let failed = false;

function logPass(label) {
  console.log(`${GREEN}PASS${RESET}: ${label}`);
}

function logFail(label, err) {
  failed = true;
  console.error(`${RED}FAIL${RESET}: ${label}`);
  if (err) {
    const msg = err.stderr?.toString() || err.stdout?.toString() || err.message;
    if (msg) console.error(msg);
  }
}

function run(cmd, cwd, env) {
  return execSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runSilently(cmd, cwd) {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  });
}

function binaryPath(installDir) {
  const isWindows = process.platform === "win32";
  return join(installDir, "node_modules", ".bin", isWindows ? "omk.cmd" : "omk");
}

function cliJsPath(installDir) {
  return join(installDir, "node_modules", "oh-my-kimichan", "dist", "cli.js");
}

// ---------------------------------------------------------------------------
// Step 1: Pack tarball
// ---------------------------------------------------------------------------

let tarballName = "";
let tarballPath = "";

try {
  const packJson = runSilently("npm pack --json", process.cwd());
  const packMeta = JSON.parse(packJson);
  tarballName = packMeta[0]?.filename;
  if (!tarballName) throw new Error("npm pack did not return a filename");
  tarballPath = resolve(process.cwd(), tarballName);
  logPass(`Pack tarball (${tarballName})`);
} catch (err) {
  logFail("Pack tarball", err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2: Install tarball in a temp directory
// ---------------------------------------------------------------------------

const installDir = mkdtempSync(join(tmpdir(), "omk-smoke-install-"));

try {
  runSilently(`npm init -y`, installDir);
  runSilently(`npm install "${tarballPath}"`, installDir);
  logPass("Install tarball in temp dir");
} catch (err) {
  logFail("Install tarball in temp dir", err);
  cleanup();
  process.exit(1);
}

const omkBin = binaryPath(installDir);
const omkCliJs = cliJsPath(installDir);

if (!existsSync(omkBin) && !existsSync(omkCliJs)) {
  logFail(`Binary not found at ${omkBin} and CLI JS not found at ${omkCliJs}`);
  cleanup();
  process.exit(1);
}

function omkCmd(args) {
  // On Windows .bin/omk.cmd is a batch shim; running it through node fails.
  // Use the actual dist/cli.js entrypoint for a consistent cross-platform invocation.
  if (existsSync(omkCliJs)) {
    return `node "${omkCliJs}" ${args}`;
  }
  return `"${omkBin}" ${args}`;
}

// ---------------------------------------------------------------------------
// Step 3: Global help smoke
// ---------------------------------------------------------------------------

try {
  run(omkCmd("--help"), installDir);
  logPass("Global help smoke");
} catch (err) {
  logFail("Global help smoke", err);
}

// ---------------------------------------------------------------------------
// Step 4: Global doctor soft smoke
// ---------------------------------------------------------------------------

const KNOWN_SOFT_ISSUES = new Set([
  "jq",
  "Kimi CLI",
  "Kimi CLI version",
  "Git Clean",
  "Built-in LSP",
  "Global Pollution",
  "Git Repo",
  "Global MCP (stdio)",
  "Global Memory",
]);

function assertNoUnexpectedIssues(parsed, label) {
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

  const unexpectedErrors = errors.filter((e) => {
    const name = typeof e === "string" ? e : e?.name ?? "";
    return !KNOWN_SOFT_ISSUES.has(name);
  });
  if (unexpectedErrors.length > 0) {
    throw new Error(
      `${label} unexpected doctor errors: ${unexpectedErrors.map((e) => (typeof e === "string" ? e : e?.name)).join(", ")}`
    );
  }

  const unexpectedWarnings = warnings.filter((w) => {
    const name = typeof w === "string" ? w : w?.name ?? "";
    return !KNOWN_SOFT_ISSUES.has(name);
  });
  if (unexpectedWarnings.length > 0) {
    throw new Error(
      `${label} unexpected doctor warnings: ${unexpectedWarnings.map((w) => (typeof w === "string" ? w : w?.name)).join(", ")}`
    );
  }
}

try {
  const raw = run(omkCmd("doctor --json --soft"), installDir);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "Global");
  logPass("Global doctor soft smoke");
} catch (err) {
  logFail("Global doctor soft smoke", err);
}

// ---------------------------------------------------------------------------
// Step 5: Fresh project init smoke
// ---------------------------------------------------------------------------

const projectDir = mkdtempSync(join(tmpdir(), "omk-smoke-project-"));

try {
  runSilently("git init", projectDir);
  run(omkCmd("init"), projectDir);
  const raw = run(omkCmd("doctor --json --soft"), projectDir);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("doctor output is not a JSON object");
  }
  assertNoUnexpectedIssues(parsed, "Project");
  logPass("Fresh project init smoke");
} catch (err) {
  logFail("Fresh project init smoke", err);
}

// ---------------------------------------------------------------------------
// Cleanup & exit
// ---------------------------------------------------------------------------

cleanup();

if (failed) {
  console.error("\nSmoke tests failed.");
  process.exit(1);
} else {
  console.log("\nAll smoke tests passed.");
  process.exit(0);
}

function cleanup() {
  try {
    if (tarballPath && existsSync(tarballPath)) rmSync(tarballPath);
    if (installDir && existsSync(installDir)) rmSync(installDir, { recursive: true });
    if (projectDir && existsSync(projectDir)) rmSync(projectDir, { recursive: true });
  } catch {
    // ignore cleanup errors
  }
}

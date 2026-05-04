#!/usr/bin/env node
/**
 * Cross-platform test runner for CI.
 * Discovers test files, runs each with node --test, collects failures,
 * and exits with non-zero if any test file failed.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TEST_DIR = "test";
const TIMEOUT_MS = 120_000;
const FAILED_LOG = "failed-tests.txt";

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => join(TEST_DIR, f));

let failed = 0;
const failedFiles = [];

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, ["--test", `--test-timeout=${TIMEOUT_MS}`, file], {
    stdio: "inherit",
    timeout: TIMEOUT_MS + 10_000,
  });
  if (result.status !== 0) {
    failed++;
    failedFiles.push(file);
    console.error(`\n❌ FAILED: ${file} (exit ${result.status ?? `signal ${result.signal}`})`);
  } else {
    console.log(`\n✅ PASSED: ${file}`);
  }
}

console.log(`\n==============================`);
console.log(`Total files: ${files.length}`);
console.log(`Passed:      ${files.length - failed}`);
console.log(`Failed:      ${failed}`);
console.log(`==============================`);

if (failed > 0) {
  // Write failed file list for artifact upload
  writeFileSync(FAILED_LOG, failedFiles.join("\n") + "\n", "utf-8");
  process.exit(1);
}

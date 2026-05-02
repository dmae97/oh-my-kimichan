#!/usr/bin/env node
/**
 * Package contents audit — cross-platform (Windows / Linux / macOS)
 * Validates the tarball that npm would publish using npm pack --dry-run --json.
 * No shell pipes, grep, head, or tar.
 */
import { execSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";

const REQUIRED_ENTRIES = ["dist", "templates", "README.md", "LICENSE"];
const FORBIDDEN_ENTRIES = ["src", "test", ".github", ".omk", ".kimi", ".agents", ".specify", "specs", "dist.old"];
const FORBIDDEN_PATTERNS = [/^omk-hud-.*\.log$/, /^omk-.*\.log$/, /^runtime.*\.log$/];
const MAX_SIZE_MB = 50;

function log(label, message, type = "info") {
  const icons = { info: "ℹ️", ok: "✅", warn: "⚠️", fail: "❌" };
  console.log(`${icons[type] || "ℹ️"} [${label}] ${message}`);
}

function ciAnnotation(type, message) {
  if (process.env.CI) {
    console.log(`::${type}::${message}`);
  }
}

function main() {
  const isCI = Boolean(process.env.CI);

  // 1. Run npm pack --dry-run --json and parse JSON from stdout only
  let packResult;
  try {
    const stdout = execSync("npm pack --dry-run --json", {
      encoding: "utf-8",
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 10 * 1024 * 1024,
    });
    // npm lifecycle scripts (e.g. prepare) may print non-JSON before the array
    const jsonStart = stdout.indexOf("[");
    if (jsonStart === -1) throw new Error("No JSON array found in npm pack output");
    packResult = JSON.parse(stdout.slice(jsonStart));
  } catch (e) {
    log("PACK", `npm pack --dry-run --json failed: ${e.message}`, "fail");
    ciAnnotation("error", `npm pack --dry-run --json failed: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(packResult) || packResult.length === 0) {
    log("PACK", "Empty or invalid npm pack JSON output", "fail");
    ciAnnotation("error", "Empty or invalid npm pack JSON output");
    process.exit(1);
  }

  const pkg = packResult[0];
  const files = pkg.files || [];
  const tarballSizeBytes = pkg.size || 0;
  const entryCount = files.length;
  const tarballName = pkg.filename || "unknown.tgz";

  const sizeMb = tarballSizeBytes / (1024 * 1024);
  let failed = false;

  // 2. Size check
  if (sizeMb > MAX_SIZE_MB) {
    log("SIZE", `${sizeMb.toFixed(2)} MB exceeds ${MAX_SIZE_MB} MB limit`, "fail");
    ciAnnotation("error", `Tarball size ${sizeMb.toFixed(2)} MB exceeds ${MAX_SIZE_MB} MB limit`);
    failed = true;
  } else {
    log("SIZE", `${sizeMb.toFixed(2)} MB within ${MAX_SIZE_MB} MB limit`, "ok");
  }

  // 3. Entry count
  log("ENTRIES", `${entryCount} files`, "info");
  ciAnnotation("notice", `Tarball entries: ${entryCount}`);

  // 4. Top-level entries
  const topLevel = new Set();
  for (const f of files) {
    const path = f.path || "";
    const parts = path.split("/");
    if (parts.length >= 1) {
      topLevel.add(parts[0]);
    }
  }

  // 5. Required entries
  for (const req of REQUIRED_ENTRIES) {
    const found = [...topLevel].some((name) => name === req || name.startsWith(req + "/"));
    if (found) {
      log("REQUIRED", `${req} present`, "ok");
    } else {
      log("REQUIRED", `${req} MISSING`, "fail");
      ciAnnotation("error", `Required entry missing: ${req}`);
      failed = true;
    }
  }

  // 6. Forbidden entries
  for (const forbid of FORBIDDEN_ENTRIES) {
    const found = [...topLevel].some((name) => name === forbid || name.startsWith(forbid + "/"));
    if (found) {
      log("FORBIDDEN", `${forbid} found in tarball`, "fail");
      ciAnnotation("error", `Forbidden entry found in tarball: ${forbid}`);
      failed = true;
    } else {
      log("FORBIDDEN", `${forbid} not present`, "ok");
    }
  }

  // 7. Forbidden patterns (runtime logs, etc.)
  const forbiddenPatternMatches = [];
  for (const f of files) {
    const path = f.path || "";
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(path)) {
        forbiddenPatternMatches.push(path);
      }
    }
  }
  if (forbiddenPatternMatches.length > 0) {
    for (const match of forbiddenPatternMatches) {
      log("FORBIDDEN", `${match} found in tarball`, "fail");
      ciAnnotation("error", `Forbidden pattern matched in tarball: ${match}`);
    }
    failed = true;
  }

  // 8. Package.json audit (read local copy — it is included by npm automatically)
  try {
    const localPkg = JSON.parse(readFileSync("package.json", "utf-8"));
    if (!localPkg.name || !localPkg.version) {
      log("PACKAGE", "name or version missing", "fail");
      ciAnnotation("error", "package.json missing name or version");
      failed = true;
    } else {
      log("PACKAGE", `${localPkg.name}@${localPkg.version}`, "ok");
    }

    if (!localPkg.bin || Object.keys(localPkg.bin).length === 0) {
      log("PACKAGE", "No bin entry defined", "warn");
    } else {
      log("PACKAGE", `bin: ${Object.keys(localPkg.bin).join(", ")}`, "ok");
    }

    if (!localPkg.files || localPkg.files.length === 0) {
      log("PACKAGE", "No files field defined (publishes everything)", "warn");
    }
  } catch (e) {
    log("PACKAGE", `Could not read local package.json: ${e.message}`, "fail");
    ciAnnotation("error", `Could not read local package.json: ${e.message}`);
    failed = true;
  }

  // 9. CI Summary
  const summaryLines = [
    "## Package Audit Summary",
    `- Tarball: ${tarballName}`,
    `- Size: ${sizeMb.toFixed(2)} MB`,
    `- Entries: ${entryCount}`,
    `- Required: ${REQUIRED_ENTRIES.join(", ")}`,
    `- Forbidden: ${FORBIDDEN_ENTRIES.join(", ")}`,
    `- Result: ${failed ? "FAILED" : "PASSED"}`,
  ];
  if (isCI) {
    console.log("");
    for (const line of summaryLines) console.log(line);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n") + "\n", "utf-8");
    } catch {
      // ignore
    }
  }

  if (failed) {
    log("AUDIT", "Package audit FAILED", "fail");
    process.exit(1);
  }

  log("AUDIT", "Package audit passed", "ok");
}

main();

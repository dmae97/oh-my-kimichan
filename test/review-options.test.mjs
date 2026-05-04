import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const REVIEW_MODULE = pathToFileURL(join(OMK_ROOT, "dist", "commands", "workflow.js")).href;

function runReviewInTemp(opts, changes = true) {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-review-"));
  spawnSync("git", ["init"], { cwd: tmpDir });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
  writeFileSync(join(tmpDir, "a.txt"), "hello");
  spawnSync("git", ["add", "."], { cwd: tmpDir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
  if (changes) {
    writeFileSync(join(tmpDir, "a.txt"), "hello\nchange");
  }
  const script = `
    import { reviewCommand } from "${REVIEW_MODULE}";
    const result = await reviewCommand(${JSON.stringify(opts)});
    if (!result.ok && process.exitCode === undefined) {
      process.exitCode = result.exitCode;
    }
    console.log("REVIEW_OK");
  `;
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    cwd: tmpDir,
    env: { ...process.env, OMK_PROJECT_ROOT: tmpDir },
    encoding: "utf-8",
    timeout: 30000,
  });
}

test("reviewCommand --ci --soft exits 0 even when quality gate fails", () => {
  const result = runReviewInTemp({ ci: true, soft: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REVIEW_OK/);
  assert.match(result.stdout, /CI review failed/);
});

test("reviewCommand --ci without --soft exits 1 when quality gate fails", () => {
  const result = runReviewInTemp({ ci: true, soft: false });
  assert.equal(result.status, 1, `expected exit 1 but got: ${result.stderr}`);
  assert.match(result.stdout, /CI review failed/);
});

test("reviewCommand with no changes returns early", () => {
  const result = runReviewInTemp({ soft: true }, false);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No changes to review/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const SYNC_MODULE = pathToFileURL(join(OMK_ROOT, "dist", "commands", "sync.js")).href;

function runSyncInTemp(opts) {
  const tmpDir = mkdtempSync(join(tmpdir(), "omk-sync-"));
  const script = `
    import { syncCommand } from "${SYNC_MODULE}";
    await syncCommand(${JSON.stringify(opts)});
    console.log("SYNC_OK");
  `;
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    env: { ...process.env, OMK_PROJECT_ROOT: tmpDir },
    encoding: "utf-8",
    timeout: 30000,
  });
}

test("syncCommand dryRun previews changes without applying", () => {
  const result = runSyncInTemp({ dryRun: true, global: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
  assert.match(result.stdout, /Dry-run summary/);
});

test("syncCommand diff option is accepted", () => {
  const result = runSyncInTemp({ dryRun: true, diff: true, global: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
});

test("syncCommand rollback with empty manifest completes gracefully", () => {
  const result = runSyncInTemp({ rollback: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNC_OK/);
  assert.match(result.stdout, /No manifest entries found/);
});

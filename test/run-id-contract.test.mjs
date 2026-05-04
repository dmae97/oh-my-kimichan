import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRunId,
  getRunPath,
  getRunsDir,
  listValidRunIds,
  RUN_ID_MAX_LENGTH,
} from "../dist/util/run-store.js";

function makeLongRunId(length) {
  return "a".repeat(length);
}

describe("validateRunId", () => {
  it("accepts valid runIds", () => {
    const valid = [
      "run-123",
      "chat_abc-1",
      "2026-05-01T06-31-49-303Z",
      "my.run.id",
      "a_b-c.1",
    ];
    for (const id of valid) {
      assert.strictEqual(validateRunId(id), id, `should accept ${id}`);
    }
  });

  it("rejects empty string", () => {
    assert.throws(() => validateRunId(""), /empty/);
  });

  it("rejects dot-only segments", () => {
    assert.throws(() => validateRunId("."), /dot-only/);
    assert.throws(() => validateRunId(".."), /dot-only/);
  });

  it("rejects path separators", () => {
    assert.throws(() => validateRunId("foo/bar"), /disallowed/);
    assert.throws(() => validateRunId("foo\\bar"), /disallowed/);
    assert.throws(() => validateRunId("a/../b"), /disallowed/);
  });

  it("rejects absolute and drive paths", () => {
    assert.throws(() => validateRunId("C:\\tmp"), /disallowed/);
    assert.throws(() => validateRunId("/etc/passwd"), /disallowed/);
  });

  it("rejects UNC paths", () => {
    assert.throws(() => validateRunId("\\\\server\\share"), /disallowed/);
  });

  it("rejects reserved name 'latest'", () => {
    assert.throws(() => validateRunId("latest"), /reserved/);
  });

  it("rejects exceeding max length", () => {
    const longId = makeLongRunId(RUN_ID_MAX_LENGTH + 1);
    assert.throws(() => validateRunId(longId), /exceeds/);
  });

  it("accepts max length runId", () => {
    const maxId = makeLongRunId(RUN_ID_MAX_LENGTH);
    assert.strictEqual(validateRunId(maxId), maxId);
  });
});

describe("getRunPath", () => {
  it("returns path under .omk/runs", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunPath("my-run", "state.json", root);
    assert.ok(p.includes(join(".omk", "runs", "my-run", "state.json")));
  });

  it("rejects invalid runId", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    assert.throws(() => getRunPath("..", "state.json", root), /dot-only/);
  });

  it("returns directory path when artifact omitted", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunPath("my-run", undefined, root);
    assert.ok(p.includes(join(".omk", "runs", "my-run")));
    assert.ok(!p.endsWith("state.json"));
  });
});

describe("getRunsDir", () => {
  it("returns .omk/runs under given root", () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const p = getRunsDir(root);
    assert.strictEqual(p, join(root, ".omk", "runs"));
  });
});

describe("listValidRunIds", () => {
  it("lists only valid run directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const runsDir = getRunsDir(root);
    mkdirSync(join(runsDir, "run-1"), { recursive: true });
    mkdirSync(join(runsDir, "run-2"), { recursive: true });
    mkdirSync(join(runsDir, "latest"), { recursive: true });
    mkdirSync(join(runsDir, ".."), { recursive: true });
    mkdirSync(join(runsDir, "bad/run"), { recursive: true });

    const ids = await listValidRunIds(root);
    assert.ok(ids.includes("run-1"));
    assert.ok(ids.includes("run-2"));
    assert.ok(!ids.includes("latest"), "should skip reserved name");
  });

  it("returns empty array when runs dir does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "omk-run-test-"));
    const ids = await listValidRunIds(root);
    assert.deepStrictEqual(ids, []);
  });
});

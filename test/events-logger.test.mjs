import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEvent, readEvents } from "../dist/util/events-logger.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "omk-events-"));
}

test("appendEvent writes JSON lines to events.jsonl", async () => {
  const dir = await tempDir();
  try {
    await appendEvent(dir, { type: "node-start", runId: "r1", nodeId: "n1" });
    await appendEvent(dir, { type: "node-complete", runId: "r1", nodeId: "n1", data: { success: true } });

    const events = await readEvents(dir);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "node-start");
    assert.equal(events[0].runId, "r1");
    assert.equal(events[0].nodeId, "n1");
    assert.equal(events[1].type, "node-complete");
    assert.equal(events[1].data.success, true);
    assert.ok(events[0].timestamp);
    assert.ok(events[1].timestamp);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readEvents returns empty array when file is missing", async () => {
  const dir = await tempDir();
  try {
    const events = await readEvents(dir);
    assert.deepEqual(events, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendEvent appends to existing events.jsonl", async () => {
  const dir = await tempDir();
  try {
    await appendEvent(dir, { type: "replay-start", runId: "r2", data: { mode: "full" } });
    await appendEvent(dir, { type: "replay-end", runId: "r2", data: { success: true } });

    const events = await readEvents(dir);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "replay-start");
    assert.equal(events[1].type, "replay-end");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

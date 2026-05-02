import test from "node:test";
import assert from "node:assert/strict";

import { checkCommand } from "../dist/util/shell.js";

test("checkCommand detects node on PATH", async () => {
  assert.equal(await checkCommand("node"), true);
});

test("checkCommand returns false for missing commands", async () => {
  assert.equal(await checkCommand("omk-command-that-should-not-exist"), false);
});

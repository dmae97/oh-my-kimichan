import test from "node:test";
import assert from "node:assert/strict";

import { checkCommand, runShellStreaming } from "../dist/util/shell.js";

test("checkCommand detects node on PATH", async () => {
  assert.equal(await checkCommand("node"), true);
});

test("checkCommand returns false for missing commands", async () => {
  assert.equal(await checkCommand("omk-command-that-should-not-exist"), false);
});

test("runShellStreaming closes stdin when input is provided", async () => {
  const result = await runShellStreaming(
    process.execPath,
    ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('stdin-closed'));"],
    { input: "", timeout: 1000 }
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /stdin-closed/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function runHelp(command) {
  return spawnSync(process.execPath, [CLI, command, "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });
}

test("run command exposes --timeout-preset", () => {
  const result = runHelp("run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--timeout-preset <preset>/);
});

test("parallel command exposes --timeout-preset", () => {
  const result = runHelp("parallel");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--timeout-preset <preset>/);
});

test("chat command leaves mode unset for persisted mode and advertises kimicat brand", () => {
  const result = runHelp("chat");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--brand <kimicat\|minimal\|plain>/);
  assert.match(result.stdout, /--mode <agent\|plan\|chat\|debugging\|review>/);
  assert.doesNotMatch(result.stdout, /default: agent/);
  assert.doesNotMatch(result.stdout, /kimichan/);
});

test("parallel keeps the historical ten-minute node timeout when no preset is requested", () => {
  const source = readFileSync(join(process.cwd(), "src", "commands", "parallel.ts"), "utf-8");
  assert.match(source, /nodeTimeoutMs:\s*options\.timeoutPreset\s*\?\s*undefined\s*:\s*600_000/);
});

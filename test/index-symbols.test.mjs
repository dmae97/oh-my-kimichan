import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

test("project-index.ts exports buildSymbolIndex and indexCommand", () => {
  const content = readFileSync(
    join(process.cwd(), "src", "commands", "project-index.ts"),
    "utf-8"
  );

  // buildSymbolIndex must be declared and exported
  assert.match(
    content,
    /export\s+async\s+function\s+buildSymbolIndex/,
    "should export buildSymbolIndex"
  );

  // indexCommand must be declared and exported
  assert.match(
    content,
    /export\s+async\s+function\s+indexCommand/,
    "should export indexCommand"
  );
});

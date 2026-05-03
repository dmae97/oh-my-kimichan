import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = process.cwd();
const SYMBOLS_PATH = join(PROJECT_ROOT, ".omk", "index", "symbols.json");

describe("omk index --symbols", () => {
  it("generates a symbols.json with structured symbol entries", () => {
    execSync("node dist/cli.js index --symbols", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      stdio: "pipe",
    });

    assert.ok(existsSync(SYMBOLS_PATH), "symbols.json should be created");

    const raw = readFileSync(SYMBOLS_PATH, "utf-8");
    const index = JSON.parse(raw);

    assert.ok(Array.isArray(index.symbols), "symbols should be an array");
    assert.ok(index.symbols.length > 0, "should index at least one symbol");
    assert.ok(index.generatedAt, "should have generatedAt timestamp");

    // Verify shape of entries
    const entry = index.symbols[0];
    assert.strictEqual(typeof entry.name, "string", "symbol name should be a string");
    assert.ok(["function", "class", "interface", "type", "enum", "variable", "unknown"].includes(entry.kind), "kind should be valid");
    assert.strictEqual(typeof entry.file, "string", "file should be a string");
    assert.strictEqual(typeof entry.line, "number", "line should be a number");
    assert.strictEqual(typeof entry.exported, "boolean", "exported should be a boolean");

    // Spot-check: this file itself should contain known exported functions
    const ownSymbols = index.symbols.filter((s) => s.file === "src/commands/project-index.ts");
    assert.ok(ownSymbols.length > 0, "should index src/commands/project-index.ts");

    const buildSymbolIndex = ownSymbols.find((s) => s.name === "buildSymbolIndex");
    assert.ok(buildSymbolIndex, "should find buildSymbolIndex function");
    assert.strictEqual(buildSymbolIndex.kind, "function");
    assert.strictEqual(buildSymbolIndex.exported, false);

    const indexCommand = ownSymbols.find((s) => s.name === "indexCommand");
    assert.ok(indexCommand, "should find indexCommand function");
    assert.strictEqual(indexCommand.kind, "function");
    assert.strictEqual(indexCommand.exported, true);
  });
});

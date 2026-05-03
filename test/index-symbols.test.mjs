import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSymbolIndex } from "../dist/commands/project-index.js";

const PROJECT_ROOT = process.cwd();

describe("omk index --symbols", () => {
  it("generates a symbols.json with structured symbol entries", async () => {
    const index = await buildSymbolIndex(PROJECT_ROOT);

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

    const buildSymbolIndexSymbol = ownSymbols.find((s) => s.name === "buildSymbolIndex");
    assert.ok(buildSymbolIndexSymbol, "should find buildSymbolIndex function");
    assert.strictEqual(buildSymbolIndexSymbol.kind, "function");
    assert.strictEqual(buildSymbolIndexSymbol.exported, true);

    const indexCommandSymbol = ownSymbols.find((s) => s.name === "indexCommand");
    assert.ok(indexCommandSymbol, "should find indexCommand function");
    assert.strictEqual(indexCommandSymbol.kind, "function");
    assert.strictEqual(indexCommandSymbol.exported, true);
  });
});

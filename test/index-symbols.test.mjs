import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";
import ts from "typescript";

function hasExportModifier(node) {
  return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

describe("omk index --symbols", () => {
  it("parses project-index.ts and finds buildSymbolIndex & indexCommand", () => {
    const filePath = join(process.cwd(), "src", "commands", "project-index.ts");
    const content = readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const symbols = [];

    function visit(node) {
      let name;
      let kind = "unknown";
      if (ts.isFunctionDeclaration(node)) {
        kind = "function";
        name = node.name?.text;
      } else if (ts.isClassDeclaration(node)) {
        kind = "class";
        name = node.name?.text;
      } else if (ts.isInterfaceDeclaration(node)) {
        kind = "interface";
        name = node.name?.text;
      } else if (ts.isTypeAliasDeclaration(node)) {
        kind = "type";
        name = node.name?.text;
      } else if (ts.isEnumDeclaration(node)) {
        kind = "enum";
        name = node.name?.text;
      } else if (ts.isVariableStatement(node)) {
        kind = "variable";
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name)) name = decl.name.text;
      }
      if (name) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        symbols.push({
          name,
          kind,
          file: "src/commands/project-index.ts",
          line: line + 1,
          exported: hasExportModifier(node),
        });
      }
      ts.forEachChild(node, visit);
    }

    ts.forEachChild(sourceFile, visit);

    assert.ok(symbols.length > 0, "should find symbols");

    const buildSymbolIndex = symbols.find((s) => s.name === "buildSymbolIndex");
    assert.ok(buildSymbolIndex, "should find buildSymbolIndex");
    assert.strictEqual(buildSymbolIndex.kind, "function");
    assert.strictEqual(buildSymbolIndex.exported, true);

    const indexCommand = symbols.find((s) => s.name === "indexCommand");
    assert.ok(indexCommand, "should find indexCommand");
    assert.strictEqual(indexCommand.kind, "function");
    assert.strictEqual(indexCommand.exported, true);
  });
});

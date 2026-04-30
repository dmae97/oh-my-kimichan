import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LSP_CONFIG, defaultLspConfigJson } from "../dist/lsp/default-config.js";
import { resolveBundledLspBinary } from "../dist/commands/lsp.js";

test("default LSP config exposes bundled TypeScript server through omk", () => {
  assert.equal(DEFAULT_LSP_CONFIG.enabled, true);
  assert.equal(DEFAULT_LSP_CONFIG.defaultServer, "typescript");
  assert.deepEqual(DEFAULT_LSP_CONFIG.servers.typescript.args, ["lsp", "typescript"]);
  assert.equal(DEFAULT_LSP_CONFIG.servers.typescript.bundled, true);
});

test("default LSP config is stable JSON with no secrets", () => {
  const parsed = JSON.parse(defaultLspConfigJson());

  assert.equal(parsed.servers.typescript.command, "omk");
  assert.doesNotMatch(defaultLspConfigJson(), /token|password|secret|api[_-]?key/i);
});

test("bundled TypeScript LSP binary resolves to the package-local install when available", () => {
  const resolved = resolveBundledLspBinary("typescript");

  assert.match(resolved, /typescript-language-server/);
});

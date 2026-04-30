import test from "node:test";
import assert from "node:assert/strict";

import { canWriteConfig, configWriteDeniedMessage } from "../dist/mcp/config-permissions.js";

test("MCP config writes are disabled by default", () => {
  assert.equal(canWriteConfig({}), false);
  assert.match(configWriteDeniedMessage(), /disabled by default/);
});

test("MCP config writes require explicit trusted env opt-in", () => {
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "1" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "true" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "yes" }), true);
  assert.equal(canWriteConfig({ OMK_MCP_ALLOW_WRITE_CONFIG: "0" }), false);
});

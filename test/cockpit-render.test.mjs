import { describe, it } from "node:test";
import assert from "node:assert";

const { renderCockpit } = await import("../dist/commands/cockpit.js");

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function maxVisibleWidth(output) {
  return output.split("\n").reduce((max, line) => {
    const len = stripAnsi(line).length;
    return len > max ? len : max;
  }, 0);
}

describe("renderCockpit", () => {
  it("returns a string with default placeholder run", async () => {
    const output = await renderCockpit({ terminalWidth: 80 });
    assert.strictEqual(typeof output, "string");
    assert.ok(output.includes("OMK Cockpit"), "should contain header");
    assert.ok(output.includes("run"), "should contain run id placeholder");
  });

  it("does not exceed 50 visible columns when terminalWidth is 40", async () => {
    const output = await renderCockpit({ terminalWidth: 40 });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 50, `max visible width ${maxWidth} should not exceed 50 (panel borders add ~6 chars beyond inner width)`);
  });
});

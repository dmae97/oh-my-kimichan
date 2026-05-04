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

function countLines(output) {
  return output.split("\n").length;
}

describe("renderCockpit", () => {
  it("returns a string with default placeholder run", async () => {
    const output = await renderCockpit({ terminalWidth: 80, quick: true });
    assert.strictEqual(typeof output, "string");
    assert.ok(output.includes("OMK Cockpit"), "should contain header");
    assert.ok(output.includes("run"), "should contain run id placeholder");
  });

  it("does not exceed 50 visible columns when terminalWidth is 40", async () => {
    const output = await renderCockpit({ terminalWidth: 40, quick: true });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 50, `max visible width ${maxWidth} should not exceed 50 (panel borders add ~6 chars beyond inner width)`);
  });

  it("returns exactly 18 lines for height 18 (panel borders + body)", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 18, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 18, `expected 18 lines for height=18, got ${lines}`);
  });

  it("returns exactly 14 lines for height 14", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 14, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 14, `expected 14 lines for height=14, got ${lines}`);
  });

  it("returns exactly 24 lines for height 24", async () => {
    const output = await renderCockpit({ terminalWidth: 80, height: 24, quick: true });
    const lines = countLines(output);
    assert.strictEqual(lines, 24, `expected 24 lines for height=24, got ${lines}`);
  });

  it("maintains stable line count across multiple renders", async () => {
    const heights = [14, 18, 24];
    for (const h of heights) {
      const counts = new Set();
      for (let i = 0; i < 5; i++) {
        const output = await renderCockpit({ terminalWidth: 80, height: h, quick: true });
        counts.add(countLines(output));
      }
      assert.strictEqual(counts.size, 1, `height=${h} should produce identical line count across 5 renders, got [${[...counts].join(", ")}]`);
    }
  });
});

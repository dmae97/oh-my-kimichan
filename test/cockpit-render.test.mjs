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

  it("does not exceed the requested visible columns when terminalWidth is 40", async () => {
    const output = await renderCockpit({ terminalWidth: 40, quick: true });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 40, `max visible width ${maxWidth} should not exceed requested width 40`);
  });

  it("fits very narrow tmux side panes without wrapping borders", async () => {
    for (const width of [20, 24, 30, 34]) {
      const output = await renderCockpit({ terminalWidth: width, height: 18, quick: true });
      const visibleLines = output.split("\n").map(stripAnsi);
      const maxWidth = Math.max(...visibleLines.map((line) => line.length));
      assert.ok(maxWidth <= width, `terminalWidth=${width} produced max visible width ${maxWidth}`);
      assert.equal(visibleLines[0].length, maxWidth, `terminalWidth=${width} top border should define frame width`);
      assert.equal(visibleLines.at(-1).length, maxWidth, `terminalWidth=${width} bottom border should match top border`);
    }
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

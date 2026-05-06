import { describe, it } from "node:test";
import assert from "node:assert";

const { renderRunsList } = await import("../dist/commands/runs.js");

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function maxVisibleWidth(output) {
  return output.split("\n").reduce((max, line) => {
    const len = stripAnsi(line).length;
    return len > max ? len : max;
  }, 0);
}

function sampleRuns() {
  return [
    {
      name: "chat-2026-05-06T06-24-09-very-long-run-id",
      status: "running",
      nodeSummary: { done: 0, running: 1, failed: 0, pending: 0, total: 1 },
      updatedAt: "2026-05-06T06:24:09.000Z",
      createdAt: "2026-05-06T06:20:00.000Z",
      elapsedMs: 249_000,
      hasGoal: false,
      hasPlan: false,
      goalTitle: "Long history title that should never wrap inside a narrow tmux pane",
    },
    {
      name: "goal-pipeline-health-and-history-regression-check",
      status: "failed",
      nodeSummary: { done: 3, running: 0, failed: 1, pending: 2, total: 6 },
      updatedAt: "2026-05-06T05:10:00.000Z",
      createdAt: "2026-05-06T04:00:00.000Z",
      elapsedMs: 4_200_000,
      hasGoal: true,
      hasPlan: true,
      goalTitle: "Health panel regression check",
    },
  ];
}

describe("renderRunsList", () => {
  it("fits very narrow history panes without wrapping", () => {
    for (const width of [20, 24, 30, 40]) {
      const output = renderRunsList(sampleRuns(), { terminalWidth: width });
      const maxWidth = maxVisibleWidth(output);
      assert.ok(maxWidth <= width, `terminalWidth=${width} produced max visible width ${maxWidth}`);
    }
  });

  it("keeps the table view inside wider side panes", () => {
    const output = renderRunsList(sampleRuns(), { terminalWidth: 72 });
    const maxWidth = maxVisibleWidth(output);
    assert.ok(maxWidth <= 72, `max visible width ${maxWidth} should not exceed requested width 72`);
    assert.ok(output.includes("Run ID"), "wide view should keep column labels");
  });
});

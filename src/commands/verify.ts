import { join } from "path";
import { style, status } from "../util/theme.js";
import { getProjectRoot } from "../util/fs.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { checkEvidenceGates } from "../orchestration/evidence-gate.js";

const SCHEMA_VERSION = 1;

interface VerifyGate {
  nodeId: string;
  type: string;
  ref?: string;
}

interface VerifyEvidence {
  nodeId: string;
  gate: string;
  ref?: string;
  passed: boolean;
  message: string;
}

interface MissingEvidence {
  nodeId: string;
  gate?: string;
  message: string;
}

interface VerifyJsonOutput {
  runId: string;
  schemaVersion: number;
  gates: VerifyGate[];
  evidence: VerifyEvidence[];
  passed: VerifyEvidence[];
  failed: VerifyEvidence[];
  missing: MissingEvidence[];
}

export async function verifyCommand(options: { run?: string; json?: boolean } = {}): Promise<void> {
  const root = getProjectRoot();
  const runId = options.run ?? process.env.OMK_RUN_ID;

  if (!runId) {
    const msg = "No run ID specified. Use --run <id> or set OMK_RUN_ID.";
    if (options.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(status.error(msg));
    }
    process.exit(1);
  }

  const persister = createStatePersister(join(root, ".omk", "runs"));
  const state = await persister.load(runId);

  if (!state) {
    const msg = `Run not found: ${runId}`;
    if (options.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(status.error(msg));
    }
    process.exit(1);
  }

  if (!options.json && state.schemaVersion !== 1) {
    console.warn(status.warn(`Run state schemaVersion is missing or outdated for ${runId}. Continuing with verification.`));
  }

  const gates: VerifyGate[] = [];
  const evidence: VerifyEvidence[] = [];
  const passed: VerifyEvidence[] = [];
  const failed: VerifyEvidence[] = [];
  const missing: MissingEvidence[] = [];

  for (const node of state.nodes) {
    if (node.status !== "done") {
      missing.push({
        nodeId: node.id,
        message: `Node "${node.id}" is not done (status: ${node.status})`,
      });
      continue;
    }

    if (!node.outputs || node.outputs.length === 0) {
      missing.push({
        nodeId: node.id,
        message: `Node "${node.id}" has no declared outputs`,
      });
      continue;
    }

    const nodeGates: import("../orchestration/evidence-gate.js").EvidenceGate[] = [];
    for (const output of node.outputs) {
      switch (output.gate) {
        case "file-exists": {
          if (!output.ref) {
            missing.push({
              nodeId: node.id,
              gate: output.gate,
              message: `Node "${node.id}" file-exists gate is missing a ref/path`,
            });
          } else {
            nodeGates.push({ type: "file-exists", path: output.ref });
            gates.push({ nodeId: node.id, type: "file-exists", ref: output.ref });
          }
          break;
        }
        case "test-pass": {
          const command = output.ref ?? "npm test";
          nodeGates.push({ type: "command-pass", command });
          gates.push({ nodeId: node.id, type: "command-pass", ref: command });
          break;
        }
        case "review-pass":
        case "summary": {
          const marker = output.ref ?? "## Summary";
          nodeGates.push({ type: "summary-present", summaryMarker: marker });
          gates.push({ nodeId: node.id, type: "summary-present", ref: marker });
          break;
        }
        default:
          missing.push({
            nodeId: node.id,
            gate: output.gate,
            message: `Node "${node.id}" has unrecognized gate type: ${output.gate}`,
          });
      }
    }

    if (nodeGates.length === 0) {
      continue;
    }

    const result = await checkEvidenceGates(nodeGates, {
      cwd: root,
      stdout: "",
      nodeId: node.id,
    });

    for (const ev of result.evidence) {
      const item: VerifyEvidence = {
        nodeId: node.id,
        gate: ev.gate,
        ref: ev.ref,
        passed: ev.passed,
        message: ev.message ?? "",
      };
      evidence.push(item);
      if (ev.passed) {
        passed.push(item);
      } else {
        failed.push(item);
      }
    }
  }

  // Emit human-readable messages for missing / corrupt evidence to stderr
  for (const m of missing) {
    const humanMsg = `Missing evidence: ${m.message}`;
    if (options.json) {
      console.error(humanMsg);
    } else {
      console.error(status.error(humanMsg));
    }
  }
  for (const f of failed) {
    if (
      f.message.includes("does not exist") ||
      f.message.includes("missing") ||
      f.message.includes("execution failed") ||
      f.message.includes("failed with exit code")
    ) {
      const humanMsg = `Corrupt evidence: ${f.nodeId}: ${f.gate}${f.ref ? ` (${f.ref})` : ""} — ${f.message}`;
      if (options.json) {
        console.error(humanMsg);
      } else {
        console.error(status.error(humanMsg));
      }
    }
  }

  // Goal-level evidence
  let goalEvidence: Array<{
    criterionId: string;
    passed: boolean;
    message?: string;
    ref?: string;
  }> = [];
  let goalScore: import("../contracts/goal.js").GoalScore | undefined;

  if (state.goalId) {
    try {
      const { createGoalPersister } = await import("../goal/persistence.js");
      const goalPersister = createGoalPersister(join(root, ".omk", "goals"));
      const goalSpec = await goalPersister.load(state.goalId);
      if (goalSpec) {
        const { checkGoalEvidence } = await import("../goal/evidence.js");
        const { scoreGoal } = await import("../goal/scoring.js");
        const ge = await checkGoalEvidence(goalSpec, { root, runState: state });
        goalEvidence = ge.map((e) => ({
          criterionId: e.criterionId,
          passed: e.passed,
          message: e.message,
          ref: e.ref,
        }));
        goalScore = scoreGoal(goalSpec, ge);
      }
    } catch {
      // ignore goal verification errors
    }
  }

  if (options.json) {
    const output: VerifyJsonOutput & Record<string, unknown> = {
      runId,
      schemaVersion: SCHEMA_VERSION,
      gates,
      evidence,
      passed,
      failed,
      missing,
    };
    if (goalEvidence.length > 0) {
      output.goalEvidence = goalEvidence;
      output.goalScore = goalScore;
    }
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("");
    for (const ev of evidence) {
      const icon = ev.passed ? "✓" : "✗";
      const color = ev.passed ? style.mint : style.pink;
      console.log(color(`  ${icon} ${ev.nodeId}: ${ev.gate}${ev.ref ? ` (${ev.ref})` : ""} — ${ev.message}`));
    }
    console.log("");
    console.log(style.mint(`Passed: ${passed.length}`));
    if (failed.length > 0) console.log(style.pink(`Failed: ${failed.length}`));
    if (missing.length > 0) console.log(style.pink(`Missing: ${missing.length}`));
    if (goalScore) {
      console.log("");
      console.log(style.purpleBold("Goal Score"));
      console.log(`  ${style.gray("Overall:")} ${goalScore.overall === "pass" ? style.mint("pass") : style.pink(goalScore.overall)}`);
      console.log(`  ${style.gray("Required:")} ${goalScore.requiredPassed}/${goalScore.requiredTotal}`);
      if (goalScore.optionalScore > 0) {
        console.log(`  ${style.gray("Optional:")} ${goalScore.optionalScore}`);
      }
      if (goalEvidence.length > 0) {
        console.log("");
        console.log(style.purpleBold("Goal Evidence"));
        for (const ev of goalEvidence) {
          const icon = ev.passed ? style.mint("✓") : style.pink("✗");
          console.log(`  ${icon} ${ev.criterionId}: ${ev.message ?? ""}`);
        }
      }
    }
  }

  if (failed.length > 0 || missing.length > 0) {
    process.exitCode = 1;
  }
}

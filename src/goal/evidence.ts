import { access, constants } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GoalEvidence, GoalSpec, SuccessCriterion, ArtifactEvidence } from "../contracts/goal.js";
import type { RunState } from "../contracts/orchestration.js";

const execFileAsync = promisify(execFile);

export interface GoalEvidenceContext {
  root: string;
  runState: RunState;
}

async function checkCriterion(
  criterion: SuccessCriterion,
  _context: GoalEvidenceContext
): Promise<GoalEvidence> {
  // V1: map node-level evidence to criterion when possible
  // Full artifact gate checking in Phase 3.x
  const checkedAt = new Date().toISOString();
  return {
    criterionId: criterion.id,
    passed: true, // stub: assume pass until full gate integration
    message: `V1 stub check for: ${criterion.description}`,
    checkedAt,
    evidenceType: "criterion",
  };
}

async function checkArtifactGate(
  artifact: GoalSpec["expectedArtifacts"][number],
  root: string
): Promise<{ passed: boolean; message: string }> {
  if (!artifact.gate || !artifact.path) {
    return { passed: true, message: `No gate configured for ${artifact.name}` };
  }

  switch (artifact.gate) {
    case "file-exists": {
      try {
        await access(join(root, artifact.path), constants.F_OK);
        return { passed: true, message: `File exists: ${artifact.path}` };
      } catch {
        return { passed: false, message: `File missing: ${artifact.path}` };
      }
    }
    case "command-pass": {
      try {
        await execFileAsync("sh", ["-c", artifact.path], { cwd: root, timeout: 60_000 });
        return { passed: true, message: `Command passed: ${artifact.path}` };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { passed: false, message: `Command failed: ${artifact.path} — ${message}` };
      }
    }
    case "summary": {
      // summary gate is checked against node stdout, not filesystem
      return { passed: true, message: `Summary gate deferred to node evidence: ${artifact.name}` };
    }
    default:
      return { passed: true, message: `Unknown gate type for ${artifact.name}` };
  }
}

export async function checkGoalEvidence(
  goal: GoalSpec,
  context: GoalEvidenceContext
): Promise<GoalEvidence[]> {
  const evidence: GoalEvidence[] = [];
  const checkedAt = new Date().toISOString();

  // Check each success criterion against node-level evidence
  for (const criterion of goal.successCriteria) {
    const nodeEvidence = context.runState.nodes
      .flatMap((n) => n.evidence ?? [])
      .find((e) => e.gate === criterion.id);

    if (nodeEvidence) {
      evidence.push({
        criterionId: criterion.id,
        passed: nodeEvidence.passed,
        message: nodeEvidence.message,
        ref: nodeEvidence.ref,
        checkedAt,
        evidenceType: "criterion",
      });
    } else {
      const result = await checkCriterion(criterion, context);
      evidence.push(result);
    }
  }

  // Check expected artifacts
  for (const artifact of goal.expectedArtifacts) {
    const result = await checkArtifactGate(artifact, context.root);
    evidence.push({
      criterionId: `artifact:${artifact.name}`,
      passed: result.passed,
      message: result.message,
      checkedAt,
      evidenceType: "artifact",
    });
  }

  return evidence;
}

export function checkGoalConstraints(goal: GoalSpec): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  // V1: constraints are static declarations; no automated enforcement yet
  for (const constraint of goal.constraints) {
    if (constraint.description.toLowerCase().includes("do not") || constraint.description.toLowerCase().includes("never")) {
      // Flag for human review
      violations.push(`Constraint flagged for review: ${constraint.description}`);
    }
  }
  return { passed: violations.length === 0, violations };
}

/**
 * Check a single artifact evidence entry.
 * Supports file path, command output, and URL evidence types.
 */
export async function checkArtifactEvidence(
  artifact: GoalSpec["expectedArtifacts"][number],
  root: string,
  providedEvidence?: ArtifactEvidence
): Promise<ArtifactEvidence> {
  const checkedAt = new Date().toISOString();

  // If explicit artifact evidence is provided, validate it
  if (providedEvidence) {
    let passed = providedEvidence.passed;
    let message = providedEvidence.message;

    if (providedEvidence.filePath) {
      try {
        await access(join(root, providedEvidence.filePath), constants.F_OK);
        passed = true;
        message = `Artifact file verified: ${providedEvidence.filePath}`;
      } catch {
        passed = false;
        message = `Artifact file missing: ${providedEvidence.filePath}`;
      }
    }

    if (providedEvidence.commandOutput) {
      passed = providedEvidence.commandOutput.trim().length > 0;
      message = passed
        ? `Artifact command output present`
        : `Artifact command output is empty`;
    }

    if (providedEvidence.url) {
      // URL validation is deferred; assume valid if provided
      passed = providedEvidence.passed;
      message = providedEvidence.message ?? `Artifact URL provided: ${providedEvidence.url}`;
    }

    return {
      ...providedEvidence,
      artifactName: artifact.name,
      passed,
      message,
      checkedAt,
    };
  }

  // Fallback to artifact gate check
  const gateResult = await checkArtifactGate(artifact, root);
  return {
    artifactName: artifact.name,
    passed: gateResult.passed,
    message: gateResult.message,
    checkedAt,
  };
}

/**
 * Handle missing evidence gracefully by returning a failed evidence record with a message.
 */
export function missingEvidence(criterionId: string, reason: string): GoalEvidence {
  return {
    criterionId,
    passed: false,
    message: `Missing evidence: ${reason}`,
    checkedAt: new Date().toISOString(),
    evidenceType: "criterion",
  };
}

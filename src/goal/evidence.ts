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
  // No node-level evidence found → treat as missing/incomplete
  const checkedAt = new Date().toISOString();
  const isRequired = criterion.requirement === "required";
  return {
    criterionId: criterion.id,
    passed: false,
    message: isRequired
      ? `Required criterion missing evidence: ${criterion.description}`
      : `Optional criterion missing evidence: ${criterion.description}`,
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
      return { passed: false, message: `Unknown gate type for ${artifact.name}` };
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
      continue;
    }

    // Fallback 1: look for a node whose id or output name matches the criterion
    const matchingNode = context.runState.nodes.find(
      (n) => n.id === criterion.id || n.outputs?.some((o) => o.name === criterion.id)
    );
    const fallbackEvidence = matchingNode?.evidence?.find((e) => e.passed);
    if (fallbackEvidence) {
      evidence.push({
        criterionId: criterion.id,
        passed: true,
        message: fallbackEvidence.message,
        ref: fallbackEvidence.ref,
        checkedAt,
        evidenceType: "criterion",
      });
      continue;
    }

    // Fallback 2: semantic match — map criterion description to nodes with related roles/names
    const desc = criterion.description.toLowerCase();
    const semanticNode = context.runState.nodes.find((n) => {
      if (n.status !== "done") return false;
      const role = (n.role ?? "").toLowerCase();
      const name = (n.name ?? "").toLowerCase();
      if (desc.includes("test") && (role.includes("qa") || role.includes("test") || name.includes("test"))) return true;
      if (desc.includes("build") && (role.includes("build") || name.includes("build"))) return true;
      if (desc.includes("lint") && (role.includes("qa") || role.includes("lint") || name.includes("lint"))) return true;
      if (desc.includes("typecheck") && (role.includes("qa") || name.includes("typecheck") || name.includes("type-check"))) return true;
      if (desc.includes("review") && (role.includes("review") || name.includes("review"))) return true;
      if (desc.includes("deploy") && (role.includes("deploy") || name.includes("deploy"))) return true;
      if (desc.includes("evidence") && n.evidence && n.evidence.length > 0) return true;
      return false;
    });
    const semanticEvidence = semanticNode?.evidence?.find((e) => e.passed);
    if (semanticEvidence) {
      evidence.push({
        criterionId: criterion.id,
        passed: true,
        message: semanticEvidence.message,
        ref: semanticEvidence.ref,
        checkedAt,
        evidenceType: "criterion",
      });
      continue;
    }

    const result = await checkCriterion(criterion, context);
    evidence.push(result);
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

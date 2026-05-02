import type { RunState } from "../contracts/orchestration.js";
import type { GoalSpec, GoalEvidence, MissingCriterion, NextActionSuggestion } from "../contracts/goal.js";
import { scoreGoal } from "./scoring.js";
import { checkGoalEvidence } from "./evidence.js";
import { getProjectRoot } from "../util/fs.js";

export type NextAction = "continue" | "replan" | "block" | "handoff" | "close";

export interface GoalProgress {
  status: GoalSpec["status"];
  score: import("../contracts/goal.js").GoalScore;
  nextAction: NextAction;
}

export async function evaluateGoalProgress(
  goal: GoalSpec,
  runState: RunState
): Promise<GoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);

  let nextAction: NextAction;
  if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail") {
    nextAction = "block";
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }

  return {
    status: goal.status,
    score,
    nextAction,
  };
}

/**
 * Evaluate which success criteria still lack passing evidence.
 * Returns ordered list with required criteria first, then by weight desc.
 */
export function evaluateMissingCriteria(
  goalSpec: GoalSpec,
  evidence: GoalEvidence[]
): MissingCriterion[] {
  const missing: MissingCriterion[] = [];
  for (const criterion of goalSpec.successCriteria) {
    const ev = evidence.find((e) => e.criterionId === criterion.id);
    if (!ev || !ev.passed) {
      missing.push({
        criterionId: criterion.id,
        description: criterion.description,
        requirement: criterion.requirement,
        priority: criterion.requirement === "required" ? 100 + criterion.weight * 10 : criterion.weight * 10,
      });
    }
  }
  missing.sort((a, b) => b.priority - a.priority);
  return missing;
}

/**
 * Suggest the next highest-priority action based on missing evidence.
 * Can be called incrementally as evidence accumulates.
 */
export function suggestNextAction(
  goalSpec: GoalSpec,
  evidence: GoalEvidence[]
): NextActionSuggestion {
  const missingCriteria = evaluateMissingCriteria(goalSpec, evidence);
  if (missingCriteria.length > 0) {
    const top = missingCriteria[0];
    return {
      type: "criterion",
      targetId: top.criterionId,
      description: top.description,
      reason: `${top.requirement === "required" ? "Required" : "Optional"} criterion lacks passing evidence`,
    };
  }

  // Check for missing artifact evidence
  for (const artifact of goalSpec.expectedArtifacts) {
    const artifactEv = evidence.find((e) => e.criterionId === `artifact:${artifact.name}`);
    if (!artifactEv || !artifactEv.passed) {
      return {
        type: "artifact",
        targetId: `artifact:${artifact.name}`,
        description: `Produce artifact: ${artifact.name}`,
        reason: artifactEv ? "Artifact gate failed" : "Artifact evidence is missing",
      };
    }
  }

  // Check constraints
  for (const constraint of goalSpec.constraints) {
    const constraintEv = evidence.find((e) => e.criterionId === `constraint:${constraint.id}`);
    if (!constraintEv || !constraintEv.passed) {
      return {
        type: "constraint",
        targetId: `constraint:${constraint.id}`,
        description: constraint.description,
        reason: "Constraint has not been verified",
      };
    }
  }

  return {
    type: "close",
    targetId: "goal",
    description: "All criteria and artifacts are satisfied",
    reason: "No missing evidence detected",
  };
}

/**
 * Incremental evaluation: re-evaluate progress with current evidence.
 * Suitable for calling mid-run without recomputing the full run state.
 */
export function evaluateGoalProgressIncremental(
  goal: GoalSpec,
  evidence: GoalEvidence[]
): { score: import("../contracts/goal.js").GoalScore; suggestion: NextActionSuggestion } {
  const score = scoreGoal(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);
  return { score, suggestion };
}

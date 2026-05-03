import type { GoalSpec, GoalEvidence, MissingCriterion, NextActionSuggestion } from "../contracts/goal.js";

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

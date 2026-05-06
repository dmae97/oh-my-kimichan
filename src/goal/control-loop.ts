import { join } from "path";
import type { RunState, NextAction } from "../contracts/orchestration.js";
import type { GoalSpec, GoalEvidence, MissingCriterion, NextActionSuggestion } from "../contracts/goal.js";
import { scoreGoal } from "./scoring.js";
import { checkGoalEvidence } from "./evidence.js";
import { getProjectRoot } from "../util/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import { evaluateEnsembleDecision } from "../orchestration/ensemble-decision.js";
import { evaluateMissingCriteria, suggestNextAction } from "./eval-criteria.js";
import { saveEnsembleDecision } from "./ensemble-memory.js";
import { renderPromptDigest } from "./prompt-digest.js";



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

export interface EnsembleGoalProgress extends GoalProgress {
  ensemble: ReturnType<typeof evaluateEnsembleDecision>;
}

export function evaluateLoopGuard(runState: RunState): { shouldStop: boolean; reason?: string } {
  const { iterationCount, maxIterations } = runState;
  if (
    typeof iterationCount === "number" &&
    typeof maxIterations === "number" &&
    maxIterations > 0 &&
    iterationCount > 0 &&
    iterationCount >= maxIterations
  ) {
    return { shouldStop: true, reason: "max-iterations-reached" };
  }
  return { shouldStop: false };
}

/**
 * Evaluate goal progress using an ensemble of decision candidates.
 * Returns the consensus next action without requiring human STOP/CONTINUE input.
 */
export async function evaluateGoalProgressEnsemble(
  goal: GoalSpec,
  runState: RunState,
  iterationContext?: { iterationCount: number; maxIterations: number }
): Promise<EnsembleGoalProgress> {
  const root = getProjectRoot();
  const evidence = await checkGoalEvidence(goal, { root, runState });
  const score = scoreGoal(goal, evidence);

  // Loop guard check
  const effectiveState: RunState = iterationContext
    ? { ...runState, iterationCount: iterationContext.iterationCount, maxIterations: iterationContext.maxIterations }
    : runState;
  const guard = evaluateLoopGuard(effectiveState);
  if (guard.shouldStop) {
    const forcedNextAction: NextAction = score.overall === "fail" ? "block" : "handoff";
    console.warn(`[goal-control-loop] Loop guard triggered: ${guard.reason}. Forcing nextAction="${forcedNextAction}".`);
    const ensemble = evaluateEnsembleDecision(goal, runState, evidence, {
      enabled: true,
      quorumRatio: 0.5,
    });
    return {
      status: goal.status,
      score,
      nextAction: forcedNextAction,
      ensemble,
    };
  }

  // Run ensemble decision engine
  const ensemble = evaluateEnsembleDecision(goal, runState, evidence, {
    enabled: true,
    quorumRatio: 0.5,
  });

  // If ensemble has high confidence (>0.7), trust it; otherwise fall back to basic logic
  let nextAction: NextAction;
  if (ensemble.confidence >= 0.7) {
    nextAction = ensemble.action;
  } else if (score.overall === "pass") {
    nextAction = "close";
  } else if (score.overall === "fail") {
    nextAction = "block";
  } else if (runState.completedAt) {
    nextAction = "handoff";
  } else {
    nextAction = "continue";
  }

  // Persist important ensemble decisions to the configured graph memory backend.
  if (ensemble.confidence >= 0.5) {
    await saveEnsembleDecision(goal, runState, ensemble, root).catch(() => {
      // ignore persistence failures
    });
  }

  return {
    status: goal.status,
    score,
    nextAction,
    ensemble,
  };
}

export interface NextPromptResult {
  prompt: string;
  missingCriteria: MissingCriterion[];
  suggestion: NextActionSuggestion;
  memorySummary: string;
  recommendedCommands: string[];
  recommendedSkills: string[];
  verificationGates: string[];
}

export async function recallMemoryForGoal(goal: GoalSpec, root: string): Promise<string> {
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "goal-continue",
  });

  const parts: string[] = [];

  try {
    const mindmap = await memoryStore.mindmap(goal.title, 40);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence")
        .slice(0, 10)
        .map((n) => `- ${n.label} (${n.type})`)
        .join("\n");
      if (relevant) {
        parts.push("### Mindmap", relevant);
      }
    }
  } catch {
    // ignore mindmap failures
  }

  try {
    const searchResults = await memoryStore.search(goal.objective, 10);
    if (searchResults.length > 0) {
      const relevant = searchResults
        .slice(0, 5)
        .map((r) => `- ${r.path}: ${r.content.slice(0, 120)}`)
        .join("\n");
      parts.push("### Search Results", relevant);
    }
  } catch {
    // ignore search failures
  }

  return parts.join("\n");
}

export async function generateNextPrompt(
  goal: GoalSpec,
  evidence: GoalEvidence[],
  runState?: RunState,
  memorySummary?: string,
  root?: string,
): Promise<NextPromptResult> {
  let resolvedMemorySummary = memorySummary ?? "";
  if (!resolvedMemorySummary && root) {
    try {
      resolvedMemorySummary = await recallMemoryForGoal(goal, root);
    } catch {
      // ignore memory recall failures
    }
  }

  const missingCriteria = evaluateMissingCriteria(goal, evidence);
  const suggestion = suggestNextAction(goal, evidence);

  const completedCriteria = goal.successCriteria.filter((c) => {
    const ev = evidence.find((e) => e.criterionId === c.id);
    return ev?.passed ?? false;
  });

  const failedNodes = runState?.nodes.filter((n) => n.status === "failed") ?? [];
  const blockedNodes = runState?.nodes.filter((n) => n.status === "blocked") ?? [];
  const runningNodes = runState?.nodes.filter((n) => n.status === "running") ?? [];
  const pendingNodes = runState?.nodes.filter((n) => n.status === "pending") ?? [];
  const successNodes = runState?.nodes.filter((n) => n.status === "done") ?? [];

  const lines: string[] = [
    `# Context-Aware Goal Follow-up: ${goal.title}`,
    ``,
    `## Kimi Context Synthesis`,
    `Treat this document as context for the next action, not as text to repeat verbatim.`,
    `Kimi should infer the next concrete prompt from the latest evidence, failed/blocked nodes, missing criteria, and related memory.`,
    `Do not repeat the original goal verbatim. Do not restart completed work unless its evidence is invalid or stale.`,
    ``,
    `## Goal Reference (non-verbatim)`,
    renderPromptDigest("Original objective digest", goal.objective),
    ``,
    `## Immediate Focus`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    `- Priority: ${describeImmediatePriority(missingCriteria, failedNodes, blockedNodes)}`,
    ``,
    `## Success Criteria`,
    `### Completed (${completedCriteria.length}/${goal.successCriteria.length})`,
    ...completedCriteria.map((c) => `- [x] ${c.description}`),
    ``,
    `### Missing (${missingCriteria.length})`,
    ...missingCriteria.map((c) => `- [ ] ${c.description} (${c.requirement}, priority: ${c.priority})`),
    ``,
  ];

  if (runState) {
    lines.push(
      `## Previous Run Results`,
      `- Run ID: ${runState.runId}`,
      `- Successful nodes: ${successNodes.length}`,
      `- Failed nodes: ${failedNodes.length}`,
      `- Blocked nodes: ${blockedNodes.length}`,
      `- Running nodes: ${runningNodes.length}`,
      `- Pending nodes: ${pendingNodes.length}`,
    );
    if (successNodes.length > 0) {
      lines.push(`### Completed Nodes`, ...describeNodes(successNodes));
    }
    if (failedNodes.length > 0) {
      lines.push(`### Failed Nodes`, ...describeNodes(failedNodes));
    }
    if (blockedNodes.length > 0) {
      lines.push(`### Blocked Nodes`, ...describeNodes(blockedNodes));
    }
    const evidenceSummary = describeNodeEvidence(runState);
    if (evidenceSummary.length > 0) {
      lines.push(`### Recent Evidence`, ...evidenceSummary);
    }
    const attemptSummary = describeProviderAttempts(runState);
    if (attemptSummary.length > 0) {
      lines.push(`### Provider / Fallback Notes`, ...attemptSummary);
    }
    lines.push("");
  }

  if (resolvedMemorySummary) {
    lines.push(
      `## Related Memory`,
      resolvedMemorySummary,
      ``,
    );
  }

  const recommendedCommands: string[] = [];
  const recommendedSkills: string[] = [];
  const verificationGates: string[] = [];

  if (missingCriteria.length > 0) {
    recommendedCommands.push("npm run check", "npm run test");
    recommendedSkills.push("omk-quality-gate", "omk-test-debug-loop");
    verificationGates.push("Type-check passes", "Tests pass");
  }

  if (goal.expectedArtifacts.length > 0) {
    recommendedSkills.push("omk-code-review");
    verificationGates.push("Expected artifacts exist");
  }

  if (goal.constraints.length > 0) {
    recommendedSkills.push("omk-security-review");
    verificationGates.push("Constraints satisfied");
  }

  if (resolvedMemorySummary) {
    recommendedSkills.push("omk-context-broker", "omk-project-rules");
    recommendedCommands.push("omk_search_memory", "omk_memory_mindmap");
  }

  lines.push(
    `## Recommended Next Action`,
    `- Type: ${suggestion.type}`,
    `- Target: ${suggestion.targetId}`,
    `- Description: ${suggestion.description}`,
    `- Reason: ${suggestion.reason}`,
    ``,
    `## Recommended Commands`,
    ...recommendedCommands.map((c) => `- \`${c}\``),
    ``,
    `## Recommended Skills`,
    ...recommendedSkills.map((s) => `- ${s}`),
    ``,
    `## Verification Gates`,
    ...verificationGates.map((g) => `- [ ] ${g}`),
    ``,
    `## Instructions`,
    `Convert the context above into the next concrete Kimi action; do not send the same original goal prompt again.`,
    `Focus on the missing criteria and recommended next action while preserving completed nodes and valid evidence.`,
    `Run the recommended commands after making changes. Activate relevant skills for each sub-task.`,
  );

  const prompt = lines.join("\n");

  return {
    prompt,
    missingCriteria,
    suggestion,
    memorySummary: resolvedMemorySummary,
    recommendedCommands,
    recommendedSkills,
    verificationGates,
  };
}

function describeImmediatePriority(
  missingCriteria: MissingCriterion[],
  failedNodes: RunState["nodes"],
  blockedNodes: RunState["nodes"]
): string {
  if (blockedNodes.length > 0) return `unblock ${blockedNodes[0]?.id ?? "blocked-node"} before retrying dependent work`;
  if (failedNodes.length > 0) return `repair failed node ${failedNodes[0]?.id ?? "failed-node"} with a narrower retry plan`;
  if (missingCriteria.length > 0) return `satisfy missing criterion ${missingCriteria[0]?.criterionId ?? "criterion"}`;
  return "verify completion and close if all evidence remains valid";
}

function describeNodes(nodes: RunState["nodes"], limit = 8): string[] {
  const visible = nodes.slice(0, limit).map((node) => {
    const reason = node.blockedReason ? ` — ${truncateLine(node.blockedReason, 180)}` : "";
    const attempts = node.attempts?.length ? `, attempts=${node.attempts.length}` : "";
    return `- ${node.id}: ${node.name} (${node.role}${attempts})${reason}`;
  });
  if (nodes.length > limit) {
    visible.push(`- ... ${nodes.length - limit} more`);
  }
  return visible;
}

function describeNodeEvidence(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.evidence ?? []).map((evidence) => {
      const message = evidence.message ? ` — ${truncateLine(evidence.message, 180)}` : "";
      const ref = evidence.ref ? ` (${evidence.ref})` : "";
      return `- ${node.id}/${evidence.gate}: ${evidence.passed ? "passed" : "failed"}${ref}${message}`;
    })
  );
  return entries.slice(-limit);
}

function describeProviderAttempts(runState: RunState, limit = 8): string[] {
  const entries = runState.nodes.flatMap((node) =>
    (node.attempts ?? []).map((attempt) => {
      const details = [
        attempt.requestedProvider ? `requested=${attempt.requestedProvider}` : "",
        attempt.provider ? `provider=${attempt.provider}` : "",
        attempt.fallbackFrom ? `fallbackFrom=${attempt.fallbackFrom}` : "",
        attempt.fallbackReason ? `reason=${truncateLine(attempt.fallbackReason, 160)}` : "",
      ].filter(Boolean).join(" ");
      return `- ${node.id}#${attempt.attempt}: ${details}`;
    })
  ).filter((line) => line.includes("provider=") || line.includes("fallbackFrom="));
  return entries.slice(-limit);
}

function truncateLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

/**
 * Evaluate which success criteria still lack passing evidence.
 * Returns ordered list with required criteria first, then by weight desc.
 */


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

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getProjectRoot, getRunPath } from "../util/fs.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { normalizeGoal, analyzeUserIntent } from "../goal/intake.js";
import { createGoalPersister } from "../goal/persistence.js";
import { evaluateGoalProgressEnsemble } from "../goal/control-loop.js";
import type { UserIntent } from "../contracts/orchestration.js";
import { style, status } from "../util/theme.js";
import { MemoryStore } from "../memory/memory-store.js";
import type { ParallelCommandOptions } from "../commands/parallel.js";
import type { GoalSpec } from "../contracts/goal.js";

export interface OrchestrateOptions {
  runId?: string;
  workers?: string;
  approvalPolicy?: string;
  watch?: boolean;
  view?: string;
  goalId?: string;
  sourceCommand: "chat" | "run" | "parallel" | "goal-run" | "goal-continue" | "default";
}

const ADMIN_COMMANDS = new Set([
  "doctor",
  "init",
  "hud",
  "sync",
  "merge",
  "verify",
  "design",
  "lsp",
  "mcp",
  "skill",
  "star",
  "agent",
  "summary",
  "index",
  "snip",
  "specify",
  "spec",
  "dag",
  "cockpit",
  "plan",
  "feature",
  "bugfix",
  "refactor",
  "review",
  "team",
  "google",
  "workflow",
  "goal list",
  "goal show",
  "goal plan",
  "goal verify",
  "goal close",
  "goal block",
]);

function looksLikeAdminCommand(rawPrompt: string): boolean {
  const first = rawPrompt.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const firstTwo = rawPrompt
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();
  return ADMIN_COMMANDS.has(first) || ADMIN_COMMANDS.has(firstTwo);
}

export async function orchestratePrompt(
  rawPrompt: string,
  options: OrchestrateOptions
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();

  if (looksLikeAdminCommand(rawPrompt)) {
    throw new Error(
      `Admin commands must be routed through the CLI. ` +
      `Use the top-level CLI command instead: omk ${rawPrompt.trim().split(/\s+/)[0]}`
    );
  }

  // ── Intake: normalize goal + analyze intent from raw prompt ──
  const goalBasePath = join(root, ".omk", "goals");
  await mkdir(goalBasePath, { recursive: true });
  const goalPersister = createGoalPersister(goalBasePath);

  let goal: GoalSpec;
  let goalId: string | undefined = options.goalId;

  if (goalId) {
    const existing = await goalPersister.load(goalId);
    if (existing) {
      goal = existing;
    } else {
      goal = normalizeGoal({ rawPrompt });
      await goalPersister.save(goal);
      goalId = goal.goalId;
    }
  } else {
    goal = normalizeGoal({ rawPrompt });
    await goalPersister.save(goal);
    goalId = goal.goalId;
  }

  // ── NLP Intent Analysis ──
  const intent = analyzeUserIntent(rawPrompt);

  // ── Memory recall: load relevant project context ──
  const memoryStore = new MemoryStore(join(root, ".omk", "memory"), {
    projectRoot: root,
    source: "orchestrate-prompt",
  });

  let memorySummary = "";
  try {
    const mindmap = await memoryStore.mindmap(goal.title, 40);
    if (mindmap && mindmap.nodes.length > 0) {
      const relevant = mindmap.nodes
        .filter((n) => n.type === "Goal" || n.type === "Task" || n.type === "Decision" || n.type === "Evidence")
        .slice(0, 10)
        .map((n) => `- ${n.label} (${n.type})`)
        .join("\n");
      memorySummary = relevant;
    }
  } catch {
    // ignore memory recall failures
  }

  if (!memorySummary) {
    try {
      const searchResults = await memoryStore.search(goal.title, 10);
      if (searchResults.length > 0) {
        memorySummary = searchResults
          .slice(0, 5)
          .map((r) => `- ${r.path}: ${r.content.slice(0, 120)}`)
          .join("\n");
      }
    } catch {
      // ignore
    }
  }

  // ── Build enriched prompt ──
  const enrichedPrompt = buildOrchestratedPrompt({
    goal,
    memorySummary,
    sourceCommand: options.sourceCommand,
    workers: options.workers ?? String(resources.maxWorkers),
    intent,
  });

  // ── Persist next-prompt to goal directory ──
  const goalDir = join(goalBasePath, goalId);
  await mkdir(goalDir, { recursive: true });
  await writeFile(join(goalDir, "next-prompt.md"), enrichedPrompt);

  // ── Always execute via parallel DAG ──
  const { parallelCommand } = await import("../commands/parallel.js");
  const parallelOpts: ParallelCommandOptions = {
    workers: options.workers ?? String(resources.maxWorkers),
    runId: options.runId,
    approvalPolicy: options.approvalPolicy ?? "interactive",
    watch: options.watch ?? true,
    view: options.view ?? "cockpit",
    goalId,
    intent,
  };

  const { runId: generatedRunId } = await parallelCommand(enrichedPrompt, parallelOpts);
  const effectiveRunId = options.runId ?? generatedRunId;

  // Persist runId on goal so goal continue/verify can locate the latest run
  if (!goal.runIds.includes(effectiveRunId)) {
    goal = { ...goal, runIds: [...goal.runIds, effectiveRunId], updatedAt: new Date().toISOString() };
    await goalPersister.save(goal);
  }

  // ── Ensemble auto-decision: evaluate progress and auto-continue/replan/close ──
  const { readFile } = await import("fs/promises");
  const runStatePath = getRunPath(effectiveRunId, "state.json", root);
  try {
    const stateRaw = await readFile(runStatePath, "utf-8");
    const runState = JSON.parse(stateRaw);
    const progress = await evaluateGoalProgressEnsemble(goal, runState);

    // Persist ensemble decision to goal directory
    await writeFile(
      join(goalDir, "ensemble-decision.json"),
      JSON.stringify(
        {
          action: progress.nextAction,
          confidence: progress.ensemble.confidence,
          rationale: progress.ensemble.rationale,
          candidateVotes: progress.ensemble.candidateVotes,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );

    if (progress.nextAction === "close") {
      console.log(status.ok("Ensemble decision: goal complete — closing run"));
      goal = { ...goal, status: "done", updatedAt: new Date().toISOString() };
      await goalPersister.save(goal);
      return;
    }

    if (progress.nextAction === "block") {
      console.log(status.error("Ensemble decision: run blocked — manual intervention required"));
      console.log(style.gray(progress.ensemble.rationale));
      goal = { ...goal, status: "blocked", updatedAt: new Date().toISOString() };
      await goalPersister.save(goal);
      return;
    }

    if (progress.nextAction === "handoff" || progress.nextAction === "continue" || progress.nextAction === "replan") {
      const autoPrompt = progress.ensemble.nextPrompt;
      if (autoPrompt) {
        const actionLabel = progress.nextAction === "replan" ? "🔄 Replanning" : "➡️ Continuing";
        console.log(style.purpleBold(`${actionLabel} with auto-generated prompt (confidence=${progress.ensemble.confidence.toFixed(2)})`));
        await writeFile(join(goalDir, "next-prompt.md"), autoPrompt);
        // Re-invoke parallel command with the auto-generated prompt
        const followUp = await parallelCommand(autoPrompt, {
          ...parallelOpts,
          goalId,
        });
        if (followUp?.runId && !goal.runIds.includes(followUp.runId)) {
          goal = {
            ...goal,
            runIds: [...goal.runIds, followUp.runId],
            updatedAt: new Date().toISOString(),
          };
          await goalPersister.save(goal);
        }
      }
    }
  } catch (err) {
    // If ensemble evaluation fails, silently continue (do not block the user)
    const message = err instanceof Error ? err.message : String(err);
    console.error(style.gray(`[orchestrate] ensemble decision skipped: ${message}`));
  }
}

interface BuildPromptInput {
  goal: GoalSpec;
  memorySummary: string;
  sourceCommand: string;
  workers: string;
  intent: UserIntent;
}

function buildOrchestratedPrompt(input: BuildPromptInput): string {
  const lines: string[] = [
    `# Goal: ${input.goal.title}`,
    ``,
    `## Objective`,
    input.goal.objective,
    ``,
    `## Success Criteria`,
    ...input.goal.successCriteria.map((c) => `- [${c.requirement === "required" ? "required" : "optional"}] ${c.description}`),
    ``,
  ];

  if (input.memorySummary) {
    lines.push(
      `## Memory Recall`,
      `Relevant project context from graph memory:`,
      input.memorySummary,
      ``
    );
  }

  const intent = input.intent;
  lines.push(
    `## Intent Analysis`,
    `- Task type: ${intent.taskType}`,
    `- Complexity: ${intent.complexity}`,
    `- Estimated workers: ${intent.estimatedWorkers}`,
    `- Required roles: ${intent.requiredRoles.join(", ")}`,
    `- Read-only: ${intent.isReadOnly}`,
    `- Needs research: ${intent.needsResearch}`,
    `- Needs security review: ${intent.needsSecurityReview}`,
    `- Needs testing: ${intent.needsTesting}`,
    `- Needs design review: ${intent.needsDesignReview}`,
    `- Parallelizable: ${intent.parallelizable}`,
    `- Rationale: ${intent.rationale}`,
    ``,
    `## Orchestration Instructions`,
    `- Source command: ${input.sourceCommand}`,
    `- Workers: ${input.workers}`,
    `- Execution mode: parallel DAG (always)`,
    ``,
    `### DAG Structure (minimum)`,
    `1. **intake** – parse and validate the goal`,
    `2. **memory-recall** – load relevant project context via omk_search_memory / omk_memory_mindmap`,
    `3. **coordinator** – plan decomposition and assign worker scopes`,
    `4. **worker-N** – execute scoped sub-tasks in parallel`,
    `5. **reviewer** – verify outputs, check evidence gates, merge results`,
    `6. **quality/evidence** – run quality gates and collect evidence`,
    `7. **memory-writeback** – write decisions, risks, and completion state to .omk/memory/`,
    ``,
    `### Dynamic Role Assignment`,
    `Based on the intent analysis above, assign workers to these roles:`,
    ...intent.requiredRoles.map((role, i) => `  - ${i + 1}. **${role}** – scoped to the task type (${intent.taskType})`),
    ``,
    `### Mandatory Rules`,
    `- Before planning, the coordinator MUST call omk_memory_mindmap or omk_search_memory to load relevant project context.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role (routing hints).`,
    `- Use MCP servers (omk-project, memory, quality-gate) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
    `- Produce concrete evidence, changed files, and verification results.`,
    `- Write final decisions and risks to .omk/memory/decisions.md and .omk/memory/risks.md.`,
    ``,
    `### Continue Engine`,
    `If this is a continuation, focus on missing success criteria and failed evidence gates.`,
    `Re-select worker roles and MCP/skills based on the remaining work.`,
  );

  return lines.join("\n");
}

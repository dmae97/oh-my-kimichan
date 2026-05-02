import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import readline from "readline";

import { getOmkPath, getProjectRoot } from "../util/fs.js";
import { style, header, status, label, kimichanCliHero, bullet } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { createKimiTaskRunner } from "../util/kimi-runner.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { createRoutedRunState, createDagFromRunState, refreshRunStateEstimate, routeRunState } from "../orchestration/run-state.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { ParallelLiveRenderer, renderCompactParallelFrame, type ParallelViewMode } from "../util/parallel-ui.js";
import { formatOmkVersionFooter } from "../util/version.js";
import type { RunState } from "../contracts/orchestration.js";
import type { Dag } from "../orchestration/dag.js";

export interface ParallelCommandOptions {
  workers?: string;
  runId?: string;
  approvalPolicy?: string;
  watch?: boolean;
  noWatch?: boolean;
  view?: string;
  chat?: boolean;
  fromSpec?: string;
  alternateScreen?: boolean;
  noPause?: boolean;
  compact?: boolean;
  goalId?: string;
}

export async function parallelCommand(
  goal: string | undefined,
  options: ParallelCommandOptions = {}
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);

  const hasFromSpec = Boolean(options.fromSpec);

  if (!goal && !hasFromSpec) {
    console.error(status.error(t("parallel.goalRequired")));
    process.exit(1);
  }

  const approvalPolicy = normalizeApprovalPolicy(options.approvalPolicy, resources.profile);
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(root, ".omk/runs", runId);
  const startedAt = new Date().toISOString();

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "goal.md"), `# Goal\n\n${goal}\n`);
  await writeFile(
    join(runDir, "plan.md"),
    `# Plan\n\nFlow: parallel\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\nApproval policy: ${approvalPolicy}\n`
  );

  let runState: RunState;
  let effectiveGoal = goal ?? "";

  let goalId: string | undefined;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;
  if (options.goalId) {
    const { createGoalPersister } = await import("../goal/persistence.js");
    const goalPersister = createGoalPersister(join(root, ".omk", "goals"));
    const goalSpec = await goalPersister.load(options.goalId);
    if (goalSpec) {
      goalId = goalSpec.goalId;
      goalSnapshot = {
        title: goalSpec.title,
        objective: goalSpec.objective,
        successCriteria: goalSpec.successCriteria.map((c) => ({
          id: c.id,
          description: c.description,
          requirement: c.requirement,
        })),
      };
      if (!effectiveGoal) {
        effectiveGoal = goalSpec.objective;
      }
    }
  }

  if (hasFromSpec) {
    const { loadSpecDag } = await import("./dag-from-spec.js");
    const specDag = await loadSpecDag(options.fromSpec!, { parallel: true });
    effectiveGoal = goal ?? `spec: ${specDag.nodes[0]?.name ?? options.fromSpec!}`;

    const specNodes = specDag.nodes.map((node) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status, retries, ...def } = node;
      return def;
    });

    runState = createRoutedRunState({
      runId,
      startedAt,
      nodes: specNodes,
      workerCount,
      goalId,
      goalSnapshot,
    });
  } else {
    runState = createInteractiveRunState({
      runId,
      flow: "parallel",
      goal: effectiveGoal,
      workerCount,
      startedAt,
      approvalPolicy,
      goalId,
      goalSnapshot,
    });
  }
  await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));

  console.log(header("Parallel Execution"));
  console.log(label("Run ID", runId));
  console.log(label("Goal", effectiveGoal));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("Approval policy", approvalPolicy) + "\n");

  const agentFile = getOmkPath("agents/root.yaml");
  const promptText = buildPromptText(effectiveGoal, runId, resources.profile, workerCount);
  const statePath = join(runDir, "state.json");

  const routedState = routeRunState(runState, workerCount);
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  const abortController = new AbortController();
  function handleSignal(): void {
    abortController.abort();
  }
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  const executor = createExecutor({
    persister: createStatePersister(join(root, ".omk", "runs")),
    ensemble: resources.ensembleDefaultEnabled ? {} : false,
    resumeFromState: routedState,
    signal: abortController.signal,
  });

  console.log(kimichanCliHero(formatOmkVersionFooter()));
  console.log(style.purpleBold("🐾 omk parallel — DAG executor with live UI"));
  console.log(style.gray(t("parallel.agentsActivated")));

  // Determine TTY and mode defaults
  const isTTY = Boolean(process.stdout.isTTY);
  const useWatch = options.noWatch
    ? false
    : options.watch ?? isTTY;
  const useAlternateScreen = options.alternateScreen === true;
  const useCompact = options.compact === true || options.view === "compact";
  const shouldPause = isTTY && options.noPause !== true;

  // Build worker labels for the UI
  const workerLabels = buildWorkerLabels(routedState);

  // Enter alternate screen only when explicitly requested
  if (useAlternateScreen && isTTY) {
    process.stdout.write("\x1b[?1049h");
  }

  // ── Live parallel UI ──
  let latestState: RunState = routedState;
  const liveRenderer = new ParallelLiveRenderer({
    runId,
    approvalPolicy,
    workerCount,
    ensembleEnabled: resources.ensembleDefaultEnabled,
    refreshMs: 1500,
    goalTitle: effectiveGoal,
    mode: useWatch ? "watch" : "no-watch",
    workerLabels,
    statePath,
    view: (options.view as ParallelViewMode | undefined) ?? (useCompact ? "compact" : "cockpit"),
  });

  if (useWatch) {
    executor.onStateChange((state) => {
      latestState = state;
    });
    if (useCompact) {
      // Compact mode: render a single line on each state change
      executor.onStateChange((state) => {
        const line = renderCompactParallelFrame(state, {
          runId,
          approvalPolicy,
          workerCount,
          ensembleEnabled: resources.ensembleDefaultEnabled,
          goalTitle: effectiveGoal,
          mode: "watch",
          workerLabels,
          statePath,
        });
        console.log(line);
      });
    } else {
      liveRenderer.start(() => latestState);
    }
  } else {
    const previousStatuses = new Map<string, string>();
    executor.onStateChange((stateSnapshot) => logRunStateTransitions(stateSnapshot, previousStatuses));
  }

  const runner = createKimiTaskRunner({
    cwd: root,
    timeout: 0,
    agentFile,
    promptPrefix: promptText,
    mcpScope: resources.mcpScope,
    skillsScope: resources.skillsScope,
    roleAgentFiles: true,
    env: {
      ...createOmkSessionEnv(root, runId),
      OMK_RUN_ID: runId,
      OMK_FLOW: "parallel",
      OMK_GOAL: effectiveGoal,
      OMK_WORKERS: String(workerCount),
      OMK_DAG_ROUTING: "1",
      OMK_DAG_STATE_PATH: statePath,
      OMK_MCP_SCOPE: resources.mcpScope,
      OMK_SKILLS_SCOPE: resources.skillsScope,
      OMK_APPROVAL_POLICY: approvalPolicy,
    },
  });

  const result = await executor.execute(dag, runner, {
    runId,
    workers: workerCount,
    approvalPolicy: approvalPolicy as "interactive" | "auto" | "yolo" | "block",
    nodeTimeoutMs: 600_000,
  });

  liveRenderer.stop();

  process.off("SIGINT", handleSignal);
  process.off("SIGTERM", handleSignal);

  // Restore original terminal screen before printing results
  if (useAlternateScreen && isTTY) {
    process.stdout.write("\x1b[?1049l");
  }

  console.log("");
  if (result.success) {
    console.log(status.ok("Parallel DAG run complete"));
  } else {
    console.log(status.error("Parallel DAG run failed"));
    process.exitCode = 1;
  }
  console.log(label("State", statePath));

  // ── Interactive handoff ──
  if (options.chat && result.success) {
    console.log(style.purple(t("parallel.complete")));
    const { chatCommand } = await import("./chat.js");
    await chatCommand({ runId });
    return;
  }

  // Pause so the user can read the result before the process exits
  if (shouldPause) {
    console.log(style.gray("\n  Press Enter to continue..."));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.once("line", () => {
        rl.close();
        resolve();
      });
    });
  }
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

function normalizeApprovalPolicy(
  value: string | undefined,
  _profile: string
): "interactive" | "auto" | "yolo" | "block" {
  const v = value?.trim().toLowerCase();
  if (v === "interactive" || v === "auto" || v === "yolo" || v === "block") return v;
  // Default: interactive for safety in parallel mode
  return "interactive";
}

function buildPromptText(goal: string, runId: string, profile: string, workerCount: number): string {
  return [
    `Goal: ${goal}`,
    `Run ID: ${runId}`,
    `Resource profile: ${profile}`,
    `Worker budget: ${workerCount}`,
    ``,
    `Execute the goal using parallel agents.`,
    `- The coordinator plans and delegates.`,
    `- Workers execute scoped sub-tasks in parallel.`,
    `- The reviewer verifies and merges outputs.`,
    `- Produce concrete evidence, changed files, and verification results.`,
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    `- Use MCP servers (omk-project, memory, quality-gate, etc.) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
  ].join("\n");
}

function buildWorkerLabels(state: RunState): Record<string, string> {
  const labels: Record<string, string> = {};
  const coordinator = state.nodes.find((n) => n.id === "root-coordinator");
  if (coordinator) {
    labels[coordinator.id] = "planner";
  }
  const reviewer = state.nodes.find((n) => n.id === "review-merge" || n.role === "reviewer");
  if (reviewer) {
    labels[reviewer.id] = "reviewer";
  }
  const coders = state.nodes.filter(
    (n) => n.role === "coder" || n.id.startsWith("worker-")
  );
  coders.forEach((n, index) => {
    if (!labels[n.id]) {
      labels[n.id] = `coder-${index + 1}`;
    }
  });
  return labels;
}

function createInteractiveRunState(input: {
  runId: string;
  flow: string;
  goal: string;
  workerCount: number;
  startedAt: string;
  approvalPolicy: string;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
}): RunState {
  const workerNodes = Array.from({ length: input.workerCount }, (_, index) => ({
    id: `worker-${index + 1}`,
    name: `worker-${index + 1}: execute scoped sub-task`,
    role: "coder" as const,
    dependsOn: ["root-coordinator"],
    maxRetries: 1,
    inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
    outputs: [{ name: `worker-${index + 1} output`, gate: "summary" as const }],
  }));

  const state = createRoutedRunState({
    runId: input.runId,
    startedAt: input.startedAt,
    workerCount: input.workerCount,
    goalId: input.goalId,
    goalSnapshot: input.goalSnapshot,
    nodes: [
      {
        id: "bootstrap",
        name: `Prepare ${input.flow} run`,
        role: "omk",
        dependsOn: [],
        maxRetries: 1,
        startedAt: input.startedAt,
        completedAt: input.startedAt,
      },
      {
        id: "root-coordinator",
        name: `Coordinate: ${input.goal}`,
        role: "orchestrator",
        dependsOn: ["bootstrap"],
        maxRetries: 1,
        startedAt: input.startedAt,
        outputs: [{ name: "worker plan", gate: "summary" }],
      },
      ...workerNodes,
      {
        id: "review-merge",
        name: "Review, verify, and merge outputs",
        role: "reviewer",
        dependsOn: workerNodes.map((w) => w.id),
        maxRetries: 1,
        inputs: workerNodes.map((w) => ({
          name: w.outputs[0].name,
          ref: "state.json",
          from: w.id,
        })),
        outputs: [{ name: "verified result", gate: "review-pass" }],
      },
    ],
  });
  const bootstrap = state.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt = input.startedAt;
    bootstrap.completedAt = input.startedAt;
  }
  const coordinator = state.nodes.find((node) => node.id === "root-coordinator");
  if (coordinator) {
    coordinator.status = "running";
    coordinator.startedAt = input.startedAt;
  }
  return refreshRunStateEstimate(state, input.workerCount);
}

function createExecutableDagFromState(state: RunState): Dag {
  const dag = createDagFromRunState(state);
  const runtimeById = new Map(state.nodes.map((node) => [node.id, node]));

  for (const node of dag.nodes) {
    const runtime = runtimeById.get(node.id);
    if (runtime?.status !== "done") continue;
    node.status = "done";
    node.startedAt = runtime.startedAt;
    node.completedAt = runtime.completedAt;
    node.durationMs = runtime.durationMs;
    node.attempts = runtime.attempts?.map((attempt) => ({ ...attempt }));
  }

  const bootstrap = dag.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt ??= state.startedAt;
    bootstrap.completedAt ??= state.startedAt;
  }

  return dag;
}

function logRunStateTransitions(stateSnapshot: RunState, previousStatuses: Map<string, string>): void {
  for (const node of stateSnapshot.nodes) {
    const previous = previousStatuses.get(node.id);
    previousStatuses.set(node.id, node.status);
    if (previous === node.status) continue;
    if (previous === undefined && node.status === "pending") continue;
    console.log(renderNodeTransition(node.id, node.name, node.status));
  }
}

function renderNodeTransition(id: string, name: string, nodeStatus: string): string {
  const text = `${id}: ${name}`;
  if (nodeStatus === "running") return bullet(`running  ${text}`, "purple");
  if (nodeStatus === "done") return bullet(`done     ${text}`, "mint");
  if (nodeStatus === "failed") return bullet(`failed   ${text}`, "pink");
  if (nodeStatus === "blocked") return bullet(`blocked  ${text}`, "skin");
  return bullet(`${nodeStatus}  ${text}`, "blue");
}

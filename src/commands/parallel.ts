import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import readline from "readline";

import { getOmkPath, getProjectRoot, getRunPath } from "../util/fs.js";
import { style, header, status, label, kimicatCliHero, bullet } from "../util/theme.js";
import { t } from "../util/i18n.js";
import { createKimiTaskRunner } from "../kimi/runner.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { createRoutedRunState, createDagFromRunState, refreshRunStateEstimate, routeRunState } from "../orchestration/run-state.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";

import { ParallelLiveRenderer, renderCompactParallelFrame, type ParallelViewMode } from "../orchestration/parallel-ui.js";
import { formatOmkVersionFooter } from "../util/version.js";
import { UsageError } from "../util/cli-contract.js";
import type { RunState, UserIntent } from "../contracts/orchestration.js";
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
  /** Analyzed user intent for dynamic DAG construction and role routing. */
  intent?: UserIntent;
}

export async function parallelCommand(
  goal: string | undefined,
  options: ParallelCommandOptions = {}
): Promise<{ runId: string; success: boolean }> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);

  const hasFromSpec = Boolean(options.fromSpec);

  if (!goal && !hasFromSpec) {
    throw new UsageError(t("parallel.goalRequired"));
  }

  const approvalPolicy = normalizeApprovalPolicy(options.approvalPolicy, resources.profile);
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const sanitized = runId.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/\.\./g, "");
  const runDir = getRunPath(sanitized);
  const startedAt = new Date().toISOString();

  await mkdir(runDir, { recursive: true });
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
      intent: options.intent,
    });
  }

  await writeFile(join(runDir, "goal.md"), `# Goal\n\n${effectiveGoal}\n`);
  await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));

  console.log(header("Parallel Execution"));
  console.log(label("Run ID", runId));
  console.log(label("Goal", effectiveGoal));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("Approval policy", approvalPolicy) + "\n");

  const agentFile = getOmkPath("agents/root.yaml");
  const promptText = buildPromptText(effectiveGoal, runId, resources.profile, workerCount, options.intent);
  const statePath = join(runDir, "state.json");

  const routedState = routeRunState(runState, workerCount);
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  const abortController = new AbortController();
  let shuttingDown = false;
  function handleSignal(): void {
    if (shuttingDown) {
      if (options.noPause !== true) {
        process.exit(1);
      }
      return;
    }
    shuttingDown = true;
    abortController.abort();
    // Force exit if graceful shutdown hangs (e.g. long-running node)
    // In programmatic mode (noPause=true) we skip force-exit so callers can handle abort.
    if (options.noPause !== true) {
      setTimeout(() => process.exit(1), 5000);
    }
  }
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  const executor = createExecutor({
    persister: createStatePersister(join(root, ".omk", "runs")),
    ensemble: resources.ensembleDefaultEnabled ? {} : false,
    resumeFromState: routedState,
    signal: abortController.signal,
  });

  console.log(kimicatCliHero(formatOmkVersionFooter()));
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
  }
  console.log(label("State", statePath));

  // ── Interactive handoff ──
  if (options.chat && result.success) {
    console.log(style.purple(t("parallel.complete")));
    const { chatCommand } = await import("./chat.js");
    await chatCommand({ runId });
    return { runId, success: true };
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

  return { runId, success: result.success };
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  const effective = value || process.env.OMK_WORKERS;
  if (!effective || effective === "auto") return fallback;
  const parsed = Number.parseInt(effective, 10);
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

function buildPromptText(
  goal: string,
  runId: string,
  profile: string,
  workerCount: number,
  intent?: UserIntent
): string {
  const taskType = intent?.taskType ?? "general";
  const lines: string[] = [
    `Goal: ${goal}`,
    `Run ID: ${runId}`,
    `Resource profile: ${profile}`,
    `Worker budget: ${workerCount}`,
    `Task type: ${taskType}`,
  ];

  if (intent) {
    lines.push(
      `Complexity: ${intent.complexity}`,
      `Parallelizable: ${intent.parallelizable}`,
      `Required roles: ${intent.requiredRoles.join(", ")}`,
      `Read-only: ${intent.isReadOnly}`,
      ``
    );
  }

  lines.push(
    `Execute the goal using parallel agents.`,
    `- The coordinator plans and delegates.`,
    `- Workers execute scoped sub-tasks in parallel.`,
    `- The reviewer verifies and merges outputs.`,
    `- Produce concrete evidence, changed files, and verification results.`
  );

  // Task-type specific guidance
  if (taskType === "explore" || taskType === "research") {
    lines.push(
      `- Each worker focuses on a distinct subsystem, module, or question.`,
      `- Synthesize findings across workers rather than editing code.`,
      `- Prefer read-only tools (Glob, Grep, ReadFile, SearchWeb).`
    );
  } else if (taskType === "bugfix") {
    lines.push(
      `- First worker reproduces the bug; others explore root causes in parallel.`,
      `- Fix must be minimal and include a regression test.`,
      `- Run quality gates after the fix to verify no new failures.`
    );
  } else if (taskType === "refactor") {
    lines.push(
      `- Preserve external behavior; run tests before and after.`,
      `- Each worker handles a distinct file group or abstraction layer.`,
      `- Coordinate interfaces between refactored boundaries.`
    );
  } else if (taskType === "review") {
    lines.push(
      `- Each worker audits a different dimension: correctness, security, maintainability.`,
      `- Cite specific lines and file paths for every finding.`,
      `- Rank issues by severity (critical / warning / suggestion).`
    );
  } else if (taskType === "test") {
    lines.push(
      `- Cover edge cases, failure paths, and happy paths in parallel.`,
      `- Verify test isolation and deterministic behavior.`,
      `- Report coverage delta explicitly.`
    );
  } else if (taskType === "security") {
    lines.push(
      `- Audit trust boundaries, secret handling, and input validation.`,
      `- Do NOT commit or expose any discovered secrets.`,
      `- Provide concrete remediation steps with file references.`
    );
  } else if (taskType === "implement") {
    lines.push(
      `- Follow existing code style and design conventions.`,
      `- Split work by component or file boundary when possible.`,
      `- Include tests and documentation for new surfaces.`
    );
  }

  lines.push(
    ``,
    `MEMORY RECALL (MANDATORY):`,
    `- Before planning, the coordinator MUST call omk_memory_mindmap or omk_search_memory to load relevant project context.`,
    `- Workers MUST only use skills and MCP servers relevant to their assigned role.`,
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    `- Use MCP servers (omk-project, memory, quality-gate, etc.) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`
  );

  return lines.join("\n");
}

function buildWorkerLabels(state: RunState): Record<string, string> {
  const labels: Record<string, string> = {};
  const coordinator = state.nodes.find((n) => n.id === "root-coordinator" || n.id === "architect");
  if (coordinator) {
    labels[coordinator.id] = coordinator.role === "architect" ? "architect" : "planner";
  }
  const reviewer = state.nodes.find((n) => n.id === "review-merge" || n.role === "reviewer" || n.role === "aggregator");
  if (reviewer) {
    labels[reviewer.id] = reviewer.role === "aggregator" ? "aggregator" : "reviewer";
  }
  const security = state.nodes.find((n) => n.id === "security-audit");
  if (security) {
    labels[security.id] = "security";
  }
  const design = state.nodes.find((n) => n.id === "design-review");
  if (design) {
    labels[design.id] = "design";
  }
  const qa = state.nodes.find((n) => n.id === "quality-check");
  if (qa) {
    labels[qa.id] = qa.role === "tester" ? "tester" : "qa";
  }
  const workers = state.nodes.filter((n) => n.id.startsWith("worker-"));
  const roleCounts: Record<string, number> = {};
  workers.forEach((n) => {
    const role = n.role ?? "coder";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    if (!labels[n.id]) {
      labels[n.id] = `${role}-${roleCounts[role]}`;
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
  intent?: UserIntent;
}): RunState {
  const intent = input.intent;
  const effectiveWorkers = intent?.estimatedWorkers ?? input.workerCount;

  // Build dynamic nodes based on intent
  const nodes = buildDynamicNodes({
    flow: input.flow,
    goal: input.goal,
    startedAt: input.startedAt,
    workerCount: effectiveWorkers,
    intent,
  });

  const state = createRoutedRunState({
    runId: input.runId,
    startedAt: input.startedAt,
    workerCount: effectiveWorkers,
    goalId: input.goalId,
    goalSnapshot: input.goalSnapshot,
    nodes,
  });

  const bootstrap = state.nodes.find((node) => node.id === "bootstrap");
  if (bootstrap) {
    bootstrap.status = "done";
    bootstrap.startedAt = input.startedAt;
    bootstrap.completedAt = input.startedAt;
  }
  const coordinator = state.nodes.find((node) => node.id === "root-coordinator" || node.id === "architect");
  if (coordinator) {
    coordinator.status = "running";
    coordinator.startedAt = input.startedAt;
  }
  return refreshRunStateEstimate(state, effectiveWorkers);
}

interface DynamicNodeBuildInput {
  flow: string;
  goal: string;
  startedAt: string;
  workerCount: number;
  intent?: UserIntent;
}

function buildDynamicNodes(input: DynamicNodeBuildInput): import("../orchestration/dag.js").DagNodeDefinition[] {
  const { flow, goal, startedAt, workerCount, intent } = input;
  const taskType = intent?.taskType ?? "general";
  const roles = intent?.requiredRoles ?? ["planner", "coder", "reviewer"];

  const bootstrap: import("../orchestration/dag.js").DagNodeDefinition = {
    id: "bootstrap",
    name: `Prepare ${flow} run`,
    role: "omk",
    dependsOn: [],
    maxRetries: 1,
    startedAt,
    completedAt: startedAt,
  };

  // Determine coordinator / planner node based on task type
  const coordinatorRole = taskType === "plan" || taskType === "migrate" || taskType === "security" ? "architect" : "orchestrator";
  const coordinator: import("../orchestration/dag.js").DagNodeDefinition = {
    id: "root-coordinator",
    name: `Coordinate: ${goal}`,
    role: coordinatorRole,
    dependsOn: ["bootstrap"],
    maxRetries: 1,
    startedAt,
    outputs: [{ name: "worker plan", gate: "summary" }],
  };

  // Create worker nodes with role specialization
  const workerRoles = roles.filter((r) => r !== "planner" && r !== "orchestrator" && r !== "architect" && r !== "router");
  if (workerRoles.length === 0) workerRoles.push("coder");

  const workerNodes: import("../orchestration/dag.js").DagNodeDefinition[] = Array.from(
    { length: Math.min(workerCount, 6) },
    (_, index) => {
      const role = workerRoles[index % workerRoles.length];
      const taskName =
        taskType === "explore" || taskType === "research"
          ? `investigate area ${index + 1}`
          : taskType === "review"
          ? `audit scope ${index + 1}`
          : taskType === "test"
          ? `test scenario ${index + 1}`
          : taskType === "document"
          ? `document section ${index + 1}`
          : `execute scoped sub-task ${index + 1}`;
      return {
        id: `worker-${index + 1}`,
        name: `worker-${index + 1} (${role}): ${taskName}`,
        role,
        dependsOn: ["root-coordinator"],
        maxRetries: 1,
        failurePolicy: { retryable: true, blockDependents: false, skipOnFailure: true },
        inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
        outputs: [{ name: `worker-${index + 1} output`, gate: "none" }],
      };
    }
  );

  // Build tail nodes based on task type
  const tailNodes: import("../orchestration/dag.js").DagNodeDefinition[] = [];
  const workerIds = workerNodes.map((w) => w.id);

  // Review / aggregator node
  const reviewRole = taskType === "review" ? "aggregator" : "reviewer";
  const reviewNode: import("../orchestration/dag.js").DagNodeDefinition = {
    id: "review-merge",
    name: taskType === "review" ? "Aggregate review findings" : "Review, verify, and merge outputs",
    role: reviewRole,
    dependsOn: workerIds,
    maxRetries: 1,
    inputs: workerNodes.map((w) => ({
      name: w.outputs?.[0]?.name ?? w.name,
      ref: "state.json",
      from: w.id,
    })),
    outputs: [{ name: "verified result", gate: taskType === "review" ? "summary" : "review-pass" }],
  };
  tailNodes.push(reviewNode);

  // QA / tester node (for most implementation tasks)
  if (taskType !== "explore" && taskType !== "research" && taskType !== "document") {
    const qaRole = taskType === "test" ? "tester" : "qa";
    tailNodes.push({
      id: "quality-check",
      name: taskType === "test" ? "Test coverage and regression check" : "Quality assurance check",
      role: qaRole,
      dependsOn: ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "quality result", gate: taskType === "test" ? "test-pass" : "command-pass", ref: "npm run check" }],
      failurePolicy: { blockDependents: false },
    });
  }

  // Security audit node (when needed)
  if (intent?.needsSecurityReview) {
    tailNodes.push({
      id: "security-audit",
      name: "Security audit and secret scan",
      role: "security",
      dependsOn: ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "security result", gate: "review-pass" }],
      failurePolicy: { blockDependents: true },
    });
  }

  // Design review node (when needed)
  if (intent?.needsDesignReview) {
    const designDeps = tailNodes.filter((n) => n.id !== "security-audit").map((n) => n.id);
    tailNodes.push({
      id: "design-review",
      name: "Design system and UI consistency review",
      role: "designer",
      dependsOn: designDeps.length > 0 ? designDeps : ["review-merge"],
      maxRetries: 1,
      outputs: [{ name: "design result", gate: "summary" }],
      failurePolicy: { blockDependents: false },
    });
  }

  return [bootstrap, coordinator, ...workerNodes, ...tailNodes];
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

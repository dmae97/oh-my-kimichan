import { mkdir, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";

import { getOmkPath, getProjectRoot, pathExists, readTextFile } from "../util/fs.js";
import { style, header, status, label, kimichanCliHero, bullet } from "../util/theme.js";
import { createKimiTaskRunner } from "../util/kimi-runner.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { createRoutedRunState, refreshRunStateEstimate, routeRunState, createExecutableDagFromState } from "../orchestration/run-state.js";
import { createExecutor } from "../orchestration/executor.js";
import { createStatePersister } from "../orchestration/state-persister.js";
import { formatOmkVersionFooter } from "../util/version.js";
import type { RunState } from "../contracts/orchestration.js";


export async function runCommand(
  flow: string | undefined,
  goal: string | undefined,
  options: { workers?: string; runId?: string; goalId?: string }
): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);

  let resolvedFlow = flow;
  let resolvedGoal = goal;
  let runId: string;
  let runDir: string;
  let startedAt: string;
  let isResume = false;
  let runState: RunState | undefined;
  let goalSnapshot: RunState["goalSnapshot"] | undefined;

  // Load goal if --goal is provided
  if (options.goalId) {
    const { createGoalPersister } = await import("../goal/persistence.js");
    const goalPersister = createGoalPersister(join(root, ".omk", "goals"));
    const goalSpec = await goalPersister.load(options.goalId);
    if (!goalSpec) {
      console.error(status.error(`Goal not found: ${options.goalId}`));
      process.exit(1);
    }
    goalSnapshot = {
      title: goalSpec.title,
      objective: goalSpec.objective,
      successCriteria: goalSpec.successCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        requirement: c.requirement,
      })),
    };
    if (!resolvedGoal) {
      resolvedGoal = goalSpec.objective;
    }
  }

  if (options.runId) {
    isResume = true;
    runId = options.runId;
    runDir = join(root, ".omk/runs", runId);

    if (!(await pathExists(runDir))) {
      console.error(status.error(t("run.runNotFound", runId)));
      process.exit(1);
    }

    const existingGoal = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => null);
    const existingPlan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => null);
    const flowMatch = existingPlan?.match(/Flow:\s*(.+)/);
    const existingFlow = flowMatch ? flowMatch[1].trim() : null;

    if (!resolvedFlow) {
      if (!existingFlow) {
        console.error(status.error(t("run.flowRequired")));
        process.exit(1);
      }
      resolvedFlow = existingFlow;
    }
    if (!resolvedGoal && existingGoal) {
      resolvedGoal = existingGoal.replace(/^# Goal\n\n?/, "").trim();
    }

    startedAt = new Date().toISOString();

    const existingState = await readFile(join(runDir, "state.json"), "utf-8")
      .then((content) => JSON.parse(content) as RunState)
      .catch(() => null);
    if (existingState) {
      runState = routeRunState(existingState, workerCount);
      await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));
    }

    // Update files if new flow/goal provided during resume
    if (goal) {
      await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    }
    if (flow) {
      await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\n`);
    }
  } else {
    if (!resolvedFlow || !resolvedGoal) {
      console.error(status.error(t("run.flowGoalRequired")));
      process.exit(1);
    }
    runId = new Date().toISOString().replace(/[:.]/g, "-");
    runDir = join(root, ".omk/runs", runId);
    startedAt = new Date().toISOString();
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "goal.md"), `# Goal\n\n${resolvedGoal}\n`);
    await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${resolvedFlow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\n`);
    runState = createInteractiveRunState({
      runId,
      flow: resolvedFlow,
      goal: resolvedGoal,
      workerCount,
      startedAt,
      goalId: options.goalId,
      goalSnapshot,
    });
    await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));
  }

  const flowPath = getOmkPath(`flows/${resolvedFlow}/SKILL.md`);
  const kimiFlowPath = join(root, ".kimi/skills", `omk-flow-${resolvedFlow}`, "SKILL.md");

  let resolvedFlowPath: string | null = null;
  if (await pathExists(flowPath)) {
    resolvedFlowPath = flowPath;
  } else if (await pathExists(kimiFlowPath)) {
    resolvedFlowPath = kimiFlowPath;
  }

  if (!resolvedFlowPath) {
    console.error(status.error(t("run.flowNotFound", resolvedFlow)));
    console.error(style.gray(t("run.availableFlows")));
    const flowsDir = getOmkPath("flows");
    try {
      const entries = await readdir(flowsDir, { withFileTypes: true });
      for (const e of entries.filter((d) => d.isDirectory())) {
        console.error(`   - ${e.name}`);
      }
    } catch {
      // ignore
    }
    const kimiFlowsDir = join(root, ".kimi/skills");
    try {
      const entries = await readdir(kimiFlowsDir, { withFileTypes: true });
      for (const e of entries.filter((d) => d.isDirectory() && d.name.startsWith("omk-flow-"))) {
        console.error(`   - ${e.name.replace("omk-flow-", "")}`);
      }
    } catch {
      // ignore
    }
    process.exit(1);
  }

  console.log(header(isResume ? "Run resumed" : "Run started"));
  console.log(label("Run ID", runId));
  console.log(label("Flow", resolvedFlow));
  console.log(label("Goal", resolvedGoal ?? t("run.useExistingGoal")));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`) + "\n");

  const agentFile = getOmkPath("agents/root.yaml");

  const flowContent = await readTextFile(resolvedFlowPath);
  if (!runState) {
    runState = createInteractiveRunState({
      runId,
      flow: resolvedFlow,
      goal: resolvedGoal ?? "Resume run",
      workerCount,
      startedAt,
    });
    await writeFile(join(runDir, "state.json"), JSON.stringify(runState, null, 2));
  }
  const promptLines = [
    `Flow: ${resolvedFlow}`,
    `Goal: ${resolvedGoal ?? ""}`,
    `Run ID: ${runId}`,
    `Resource profile: ${resources.profile}`,
    `Worker budget: ${workerCount}`,
  ];
  if (isResume) {
    promptLines.push(``, `⚠️ ${t("run.resumeWarning")}`);
  }
  promptLines.push(
    ``,
    t("run.planPrompt"),
    ``,
    `SKILLS & MCP USAGE (MANDATORY):`,
    `- Activate relevant skills from the routing hints for each node.`,
    `- Use MCP servers (omk-project, memory, quality-gate, etc.) when they fit the task.`,
    `- Prefer omk-project MCP tools for checkpoint, memory, and run-state operations.`,
    `- Use SearchWeb / FetchURL for external docs, official APIs, or citations.`,
    ``,
    flowContent,
  );
  const promptText = promptLines.join("\n");

  const statePath = join(runDir, "state.json");
  const routedState = routeRunState(runState, workerCount);
  await writeFile(statePath, JSON.stringify(routedState, null, 2));

  const dag = createExecutableDagFromState(routedState);
  const executor = createExecutor({ persister: createStatePersister(join(root, ".omk", "runs")) });
  const previousStatuses = new Map<string, string>();
  executor.onStateChange((stateSnapshot) => logRunStateTransitions(stateSnapshot, previousStatuses));

  console.log(kimichanCliHero(formatOmkVersionFooter()));
  console.log(style.purpleBold(t("run.dagForced")));
  console.log(style.gray(t("run.mcpSkillsForced")));
  console.log(style.gray(t("run.runInfoSaved", runId)));

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
      OMK_FLOW: resolvedFlow,
      OMK_GOAL: resolvedGoal ?? "",
      OMK_WORKERS: String(workerCount),
      OMK_DAG_ROUTING: "1",
      OMK_DAG_STATE_PATH: statePath,
      OMK_MCP_SCOPE: resources.mcpScope,
      OMK_SKILLS_SCOPE: resources.skillsScope,
    },
  });

  const approvalPolicy = await loadApprovalPolicy(root);
  const result = await executor.execute(dag, runner, {
    runId,
    workers: workerCount,
    approvalPolicy,
  });

  console.log("");
  if (result.success) {
    console.log(status.ok("DAG run complete"));
  } else {
    console.log(status.error("DAG run failed"));
    process.exitCode = 1;
  }
  console.log(label("State", statePath));
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

function createInteractiveRunState(input: {
  runId: string;
  flow: string;
  goal: string;
  workerCount: number;
  startedAt: string;
  goalId?: string;
  goalSnapshot?: RunState["goalSnapshot"];
}): RunState {
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
      {
        id: "worker-fanout",
        name: `${input.workerCount} worker budget`,
        role: "router",
        dependsOn: ["root-coordinator"],
        maxRetries: 1,
        inputs: [{ name: "worker plan", ref: "plan.md", from: "root-coordinator" }],
        outputs: [{ name: "worker outputs", gate: "summary" }],
      },
      {
        id: "review-merge",
        name: "Review, verify, and merge outputs",
        role: "reviewer",
        dependsOn: ["worker-fanout"],
        maxRetries: 1,
        inputs: [{ name: "worker outputs", ref: "state.json", from: "worker-fanout" }],
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
  if (nodeStatus === "blocked") return bullet(`blocked   ${text}`, "skin");
  return bullet(`${nodeStatus}  ${text}`, "blue");
}

async function loadApprovalPolicy(root: string): Promise<"interactive" | "auto" | "yolo" | "block"> {
  const configPath = join(root, ".omk", "config.toml");
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/^approval_policy\s*=\s*["']([^"']+)["']/m);
    const value = match?.[1]?.trim().toLowerCase();
    if (value === "interactive" || value === "auto" || value === "yolo" || value === "block") {
      return value;
    }
  } catch {
    // ignore missing config
  }
  return "interactive"; // safe default
}

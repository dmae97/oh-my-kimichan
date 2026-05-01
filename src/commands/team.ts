import { runShell, checkCommand } from "../util/shell.js";
import { getProjectRoot } from "../util/fs.js";
import { style, header, status, bullet, label } from "../util/theme.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { RunState } from "../contracts/orchestration.js";
import { createRoutedRunState, refreshRunStateEstimate } from "../orchestration/run-state.js";

export async function teamCommand(options: { workers?: string; runId?: string } = {}): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);
  const runId = options.runId ?? `team-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const tmuxExists = await checkCommand("tmux");
  if (!tmuxExists) {
    console.error(status.error(t("team.tmuxNotInstalled")));
    console.error(style.gray(t("team.tmuxInstallHint")));
    process.exit(1);
  }

  const session = "omk-team";

  // Check if session already exists
  const lsResult = await runShell("tmux", ["ls"], { timeout: 5000 });
  const sessionExists = !lsResult.failed && lsResult.stdout.includes(session);

  if (sessionExists) {
    console.log(style.purpleBold(t("team.attachSession", session)));
    const existingRunId = await getTeamRunId(session);
    await ensureCoordinatorHudPane(session, root, existingRunId ?? options.runId);
    console.log(style.gray(t("team.detachHint")));
    await runShell("tmux", ["attach", "-t", session], { timeout: 0, stdio: "inherit" });
    return;
  }

  console.log(header(t("team.createSession")));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("Worker windows", String(workerCount)) + "\n");

  const statePath = await writeTeamRunState(root, runId, workerCount);
  const teamEnv = {
    OMK_RUN_ID: runId,
    OMK_WORKERS: String(workerCount),
    OMK_DAG_ROUTING: "1",
    OMK_DAG_STATE_PATH: statePath,
  };

  // Create new session with a main window
  const createResult = await runShell("tmux", ["new-session", "-d", "-s", session, "-n", "coordinator"], {
    cwd: root,
    env: teamEnv,
    timeout: 10000,
  });
  if (createResult.failed) {
    console.error(status.error(t("team.sessionCreateFailed")), createResult.stderr);
    process.exit(1);
  }
  await setTeamEnvironment(session, teamEnv);

  // Create additional windows for workers sequentially to avoid tmux session modification race conditions
  for (let i = 1; i <= workerCount; i += 1) {
    await runShell("tmux", ["new-window", "-t", `${session}:${i}`, "-n", `worker-${i}`], { env: teamEnv, timeout: 5000 });
  }
  await runShell("tmux", ["new-window", "-t", `${session}:${workerCount + 1}`, "-n", "reviewer"], { env: teamEnv, timeout: 5000 });

  // Split coordinator window vertically and keep a live HUD visible on the right.
  await ensureCoordinatorHudPane(session, root, runId);

  console.log(status.ok(t("team.sessionReady")));
  console.log(bullet(t("team.coordinator"), "purple"));
  console.log(bullet(t("team.hudPane"), "blue"));
  console.log(bullet(workerCount === 1 ? t("team.workerSingular") : t("team.workerPlural", workerCount), "mint"));
  console.log(bullet(t("team.reviewer"), "pink"));
  console.log("");
  console.log(style.pinkBold(t("team.shortcuts")));
  console.log(style.gray(t("team.switchWindows", workerCount + 1)));
  console.log(style.gray(t("team.detachSession")));
  console.log(style.gray(t("team.reconnect")));
  console.log("");
  console.log(style.purple(t("team.connecting")));

  await runShell("tmux", ["attach", "-t", session], { timeout: 0, stdio: "inherit" });
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

async function setTeamEnvironment(session: string, env: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(env)) {
    await runShell("tmux", ["set-environment", "-t", session, key, value], { timeout: 5000 });
  }
}

async function getTeamRunId(session: string): Promise<string | null> {
  const result = await runShell("tmux", ["show-environment", "-t", session, "OMK_RUN_ID"], { timeout: 5000 });
  if (result.failed) return null;
  const match = result.stdout.trim().match(/^OMK_RUN_ID=(.+)$/);
  return match?.[1] ?? null;
}

async function ensureCoordinatorHudPane(session: string, root: string, runId?: string): Promise<void> {
  const windowTarget = `${session}:coordinator`;
  const panes = await runShell("tmux", ["list-panes", "-t", windowTarget, "-F", "#{pane_title}"], { timeout: 5000 });
  if (!panes.failed && panes.stdout.split(/\r?\n/).some((title) => title.trim() === "omk-hud")) {
    return;
  }

  const split = await runShell(
    "tmux",
    ["split-window", "-h", "-P", "-F", "#{pane_id}", "-c", root, "-t", windowTarget],
    { timeout: 5000 },
  );
  if (split.failed) {
    console.error(status.warn(t("team.hudPanelFailed")), split.stderr);
    return;
  }

  const paneId = split.stdout.trim();
  if (!paneId) return;
  await runShell("tmux", ["select-pane", "-t", paneId, "-T", "omk-hud"], { timeout: 5000 });
  await runShell("tmux", ["send-keys", "-t", paneId, buildHudPaneCommand(runId), "C-m"], { timeout: 5000 });
  await runShell("tmux", ["select-layout", "-t", windowTarget, "main-vertical"], { timeout: 5000 });
  await runShell("tmux", ["select-pane", "-t", `${windowTarget}.0`], { timeout: 5000 });
}

function buildHudPaneCommand(runId?: string): string {
  const cli = currentCliInvocation();
  const runArg = runId ? `--run-id ${shellQuote(runId)} ` : "";
  return [
    "printf '\\033]2;omk HUD\\007'",
    `${cli} ${runArg}hud --watch --refresh 2000`,
  ].join("; ");
}

function currentCliInvocation(): string {
  const entry = process.argv[1];
  if (!entry) return "omk";
  if (entry.endsWith(".ts")) {
    return `npx tsx ${shellQuote(entry)}`;
  }
  return `${shellQuote(process.execPath)} ${shellQuote(entry)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writeTeamRunState(root: string, runId: string, workerCount: number): Promise<string> {
  const startedAt = new Date().toISOString();
  const runDir = join(root, ".omk", "runs", runId);
  const state: RunState = createRoutedRunState({
    runId,
    startedAt,
    workerCount,
    nodes: [
      {
        id: "coordinator",
        name: "tmux coordinator pane plans DAG worker split",
        role: "orchestrator",
        dependsOn: [],
        maxRetries: 1,
        startedAt,
        outputs: [{ name: "team plan", gate: "summary" }],
      },
      ...Array.from({ length: workerCount }, (_, index) => ({
        id: `worker-${index + 1}`,
        name: `worker-${index + 1} pane executes scoped implementation`,
        role: "coder",
        dependsOn: ["coordinator"],
        maxRetries: 1,
        inputs: [{ name: "team plan", ref: "plan.md", from: "coordinator" }],
        outputs: [{ name: `worker-${index + 1} output`, gate: "summary" as const }],
      })),
      {
        id: "reviewer",
        name: "reviewer pane",
        role: "reviewer",
        dependsOn: Array.from({ length: workerCount }, (_, index) => `worker-${index + 1}`),
        maxRetries: 1,
        inputs: Array.from({ length: workerCount }, (_, index) => ({
          name: `worker-${index + 1} output`,
          ref: "state.json",
          from: `worker-${index + 1}`,
        })),
        outputs: [{ name: "review verdict", gate: "review-pass" }],
      },
    ],
  });
  const coordinator = state.nodes.find((node) => node.id === "coordinator");
  if (coordinator) {
    coordinator.status = "running";
    coordinator.startedAt = startedAt;
  }
  refreshRunStateEstimate(state, workerCount);

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "goal.md"), "# Goal\n\nTeam runtime session\n", "utf-8");
  await writeFile(join(runDir, "plan.md"), `# Plan\n\nTeam workers: ${workerCount}\n`, "utf-8");
  const statePath = join(runDir, "state.json");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
  return statePath;
}

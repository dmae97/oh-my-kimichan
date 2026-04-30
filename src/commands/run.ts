import { mkdir, writeFile, readdir } from "fs/promises";
import { join } from "path";

import { getOmkPath, getProjectRoot, pathExists, readTextFile, injectKimiGlobals } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";
import { runKimiInteractive } from "../util/kimi-runner.js";
import { createOmkSessionEnv } from "../util/session.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

export async function runCommand(flow: string, goal: string, options: { workers?: string }): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);
  const flowPath = getOmkPath(`flows/${flow}/SKILL.md`);
  const kimiFlowPath = join(root, ".kimi/skills", `omk-flow-${flow}`, "SKILL.md");

  let resolvedFlowPath: string | null = null;
  if (await pathExists(flowPath)) {
    resolvedFlowPath = flowPath;
  } else if (await pathExists(kimiFlowPath)) {
    resolvedFlowPath = kimiFlowPath;
  }

  if (!resolvedFlowPath) {
    console.error(status.error(`flow '${flow}'를 찾을 수 없습니다.`));
    console.error(style.gray("   사용 가능한 flows:"));
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

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(root, ".omk/runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "goal.md"), `# Goal\n\n${goal}\n`);
  await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${flow}\nWorkers: ${workerCount}\nResource profile: ${resources.profile}\n`);

  console.log(header("Run started"));
  console.log(label("Run ID", runId));
  console.log(label("Flow", flow));
  console.log(label("Goal", goal));
  console.log(label("Workers", String(workerCount)));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`) + "\n");

  const agentFile = getOmkPath("agents/root.yaml");

  const flowContent = await readTextFile(resolvedFlowPath);
  const promptText = [
    `Flow: ${flow}`,
    `Goal: ${goal}`,
    `Run ID: ${runId}`,
    `Resource profile: ${resources.profile}`,
    `Worker budget: ${workerCount}`,
    ``,
    `아래 flow 정의를 참고하여 실행 계획을 세우고 진행하세요.`,
    ``,
    flowContent,
  ].join("\n");

  const args: string[] = [];
  args.push("--agent-file", agentFile);
  // ⚠️ --config-file 을 사용하면 kimi 가 "Login requires the default config file" 에러를 낸다.
  //    hooks 는 mergeKimiHooks() 로 ~/.kimi/config.toml 에 주입한다.

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  await injectKimiGlobals(args);

  console.log(style.purpleBold("🤖 Kimi root coordinator를 시작합니다. 대화형으로 진행하세요."));
  console.log(style.gray("   (run 정보는 .omk/runs/" + runId + " 에 기록됩니다)\n"));

  args.push("-p", promptText);

  await runKimiInteractive(args, {
    cwd: root,
    env: { ...createOmkSessionEnv(root, runId), OMK_RUN_ID: runId, OMK_FLOW: flow, OMK_GOAL: goal, OMK_WORKERS: String(workerCount) },
  });
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

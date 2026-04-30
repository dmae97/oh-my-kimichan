import { mkdir, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { getOmkPath, getProjectRoot, pathExists, readTextFile } from "../util/fs.js";
import { runShell } from "../util/shell.js";

export async function runCommand(flow: string, goal: string, options: { workers?: string }): Promise<void> {
  const root = getProjectRoot();
  const flowPath = getOmkPath(`flows/${flow}/SKILL.md`);
  const kimiFlowPath = join(root, ".kimi/skills", `omk-flow-${flow}`, "SKILL.md");

  let resolvedFlowPath: string | null = null;
  if (await pathExists(flowPath)) {
    resolvedFlowPath = flowPath;
  } else if (await pathExists(kimiFlowPath)) {
    resolvedFlowPath = kimiFlowPath;
  }

  if (!resolvedFlowPath) {
    console.error(`❌ flow '${flow}'를 찾을 수 없습니다.`);
    console.error("   사용 가능한 flows:");
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
  await writeFile(join(runDir, "plan.md"), `# Plan\n\nFlow: ${flow}\nWorkers: ${options.workers ?? 1}\n`);

  console.log(`🏃 Run started: ${runId}`);
  console.log(`   Flow: ${flow}`);
  console.log(`   Goal: ${goal}`);
  console.log(`   Workers: ${options.workers ?? 1}\n`);

  const agentFile = getOmkPath("agents/root.yaml");
  const configFile = getOmkPath("kimi.config.toml");

  const flowContent = await readTextFile(resolvedFlowPath);
  const promptText = [
    `Flow: ${flow}`,
    `Goal: ${goal}`,
    `Run ID: ${runId}`,
    ``,
    `아래 flow 정의를 참고하여 실행 계획을 세우고 진행하세요.`,
    ``,
    flowContent,
  ].join("\n");

  const args: string[] = [];
  args.push("--agent-file", agentFile);
  if (await pathExists(configFile)) args.push("--config-file", configFile);

  console.log("🤖 Kimi root coordinator를 시작합니다. 대화형으로 진행하세요.");
  console.log("   (run 정보는 .omk/runs/" + runId + " 에 기록됩니다)\n");

  const result = await runShell("kimi", args, {
    cwd: root,
    timeout: 0,
    env: { OMK_RUN_ID: runId, OMK_FLOW: flow, OMK_GOAL: goal, OMK_PROMPT: promptText },
  });

  if (result.failed) {
    process.exit(result.exitCode);
  }
}

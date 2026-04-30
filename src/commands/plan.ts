import { runShell } from "../util/shell.js";
import { getOmkPath, pathExists } from "../util/fs.js";

export async function planCommand(goal: string, options: { thinking?: string }): Promise<void> {
  const agentFile = getOmkPath("agents/roles/architect.yaml");
  const configFile = getOmkPath("kimi.config.toml");

  if (!(await pathExists(agentFile))) {
    console.error("❌ architect agent가 없습니다. omk init을 먼저 실행하세요.");
    process.exit(1);
  }

  const promptText = `다음 목표에 대한 구현 계획을 수립해주세요. 구체적이고 검증 가능한 단계로 나누어 주세요.\n\n목표: ${goal}`;

  console.log("📐 계획 수립 중...\n");
  const args = ["--print", "--output-format=stream-json"];
  args.push("--agent-file", agentFile);
  if (await pathExists(configFile)) args.push("--config-file", configFile);
  args.push("-p", promptText);

  const result = await runShell("kimi", args, { timeout: 120000 });
  console.log(result.stdout);
  if (result.failed) {
    console.error(result.stderr);
    process.exit(result.exitCode);
  }
}

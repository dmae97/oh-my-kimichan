import { runShell } from "../util/shell.js";
import { getOmkPath, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";

export async function planCommand(goal: string, options: { thinking?: string }): Promise<void> {
  const agentFile = getOmkPath("agents/roles/architect.yaml");

  if (!(await pathExists(agentFile))) {
    console.error(status.error("architect agent가 없습니다. omk init을 먼저 실행하세요."));
    process.exit(1);
  }

  const promptText = `다음 목표에 대한 구현 계획을 수립해주세요. 구체적이고 검증 가능한 단계로 나누어 주세요.\n\n목표: ${goal}`;

  console.log(header("계획 수립"));
  console.log(label("목표", goal) + "\n");
  const args = ["--print", "--output-format=stream-json"];
  args.push("--agent-file", agentFile);
  // ⚠️ --config-file 을 사용하면 kimi 가 "Login requires the default config file" 에러를 낸다.
  //    hooks 는 mergeKimiHooks() 로 ~/.kimi/config.toml 에 주입한다.

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  await injectKimiGlobals(args);

  args.push("-p", promptText);

  const result = await runShell("kimi", args, { timeout: 120000 });
  console.log(result.stdout);
  if (result.failed) {
    console.error(result.stderr);
    process.exit(result.exitCode);
  }
}

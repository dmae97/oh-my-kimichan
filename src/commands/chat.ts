import { execa } from "execa";
import { getOmkPath, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header } from "../util/theme.js";

export async function chatCommand(options: { agentFile?: string }): Promise<void> {
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");

  if (!(await pathExists(agentFile))) {
    console.error(style.red("✖ root agent YAML이 없습니다. omk init을 먼저 실행하세요."));
    process.exit(1);
  }

  console.log(header("Kimi root coordinator"));
  console.log(style.gray("agent: ") + style.cream(agentFile) + "\n");
  const args: string[] = [];
  args.push("--agent-file", agentFile);
  // ⚠️ --config-file 을 사용하면 kimi 가 "Login requires the default config file" 에러를 낸다.
  //    hooks 는 mergeKimiHooks() 로 ~/.kimi/config.toml 에 주입한다.

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  await injectKimiGlobals(args);

  await execa("kimi", args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

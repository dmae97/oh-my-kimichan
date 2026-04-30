import { getOmkPath, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header, status } from "../util/theme.js";
import { readFile } from "fs/promises";
import { dirname, join, isAbsolute } from "path";
import YAML from "yaml";
import { initCommand } from "./init.js";
import { runKimiInteractive } from "../util/kimi-runner.js";

async function verifyAgentPrompt(agentFile: string): Promise<boolean> {
  if (!(await pathExists(agentFile))) return false;
  try {
    const raw = await readFile(agentFile, "utf8");
    const parsed = YAML.parse(raw);
    const promptPath = parsed?.agent?.system_prompt_path as string | undefined;
    if (!promptPath) return true;
    const resolved = isAbsolute(promptPath)
      ? promptPath
      : join(dirname(agentFile), promptPath);
    return await pathExists(resolved);
  } catch {
    return false;
  }
}

export async function chatCommand(options: { agentFile?: string }): Promise<void> {
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");

  const promptOk = await verifyAgentPrompt(agentFile);
  if (!promptOk) {
    console.log(
      status.warn("omk 환경이 초기화되지 않았거나 경로가 잘못되었습니다. 자동 초기화를 진행합니다...")
    );
    await initCommand({ profile: "default" });
    console.log(status.ok("자동 초기화 완료. chat을 계속합니다.\n"));
  }

  console.log(header("Kimi root coordinator"));
  console.log(style.gray("agent: ") + style.cream(agentFile) + "\n");
  const args: string[] = [];
  args.push("--agent-file", agentFile);
  // ⚠️ --config-file 을 사용하면 kimi 가 "Login requires the default config file" 에러를 낸다.
  //    hooks 는 mergeKimiHooks() 로 ~/.kimi/config.toml 에 주입한다.

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  await injectKimiGlobals(args);

  // ── node-pty 로 Kimi CLI 실행 (배너를 가로채 커스텀 배너로 교체) ──
  console.log(style.purple("🌸 oh-my-kimichan is wrapping Kimi CLI..."));

  await runKimiInteractive(args);
}

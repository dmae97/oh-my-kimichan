import { execa } from "execa";
import { getOmkPath, pathExists, injectKimiGlobals } from "../util/fs.js";
import { style, header } from "../util/theme.js";
import { readFile } from "fs/promises";
import { dirname, join, isAbsolute } from "path";
import YAML from "yaml";

export async function chatCommand(options: { agentFile?: string }): Promise<void> {
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");

  if (!(await pathExists(agentFile))) {
    console.error(style.red("✖ root agent YAML이 없습니다. omk init을 먼저 실행하세요."));
    process.exit(1);
  }

  // root.yaml 의 system_prompt_path 가 가리키는 파일이 존재하는지 사전 검증
  try {
    const raw = await readFile(agentFile, "utf8");
    const parsed = YAML.parse(raw);
    const promptPath = parsed?.agent?.system_prompt_path as string | undefined;
    if (promptPath) {
      const resolved = isAbsolute(promptPath)
        ? promptPath
        : join(dirname(agentFile), promptPath);
      if (!(await pathExists(resolved))) {
        console.error(
          style.red(
            `✖ system_prompt_path 가 가리키는 파일을 찾을 수 없습니다: ${resolved}`
          )
        );
        console.error(
          style.gray("  힌트: omk init을 다시 실행하여 경로를 마이그레이션하세요.")
        );
        process.exit(1);
      }
    }
  } catch {
    // YAML 파싱 실패 시 무시 (kimi CLI 가 직접 에러를 보여줌)
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

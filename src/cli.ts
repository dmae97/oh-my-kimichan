#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { chatCommand } from "./commands/chat.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { hudCommand } from "./commands/hud.js";
import { mergeCommand } from "./commands/merge.js";
import { syncCommand } from "./commands/sync.js";
import { designInitCommand, designLintCommand, designDiffCommand, designExportCommand, designListCommand, designApplyCommand, designSearchCommand } from "./commands/design.js";
import { stitchInstallCommand } from "./commands/google.js";
import { teamCommand } from "./commands/team.js";
import { style, header } from "./util/theme.js";

const CUSTOM_HELP = `
${header("oh-my-kimichan")}
${style.gray("Kimi CLI, but better. The orchestration layer that turns Kimi CLI into a powerful coding team.")}

${style.pinkBold("사용 가능한 명령어:")}
  ${style.mint("omk init")}               프로젝트 scaffold 생성
  ${style.mint("omk doctor")}             환경 검사
  ${style.mint("omk chat")}               Kimi 대화형 실행
  ${style.mint("omk plan")} ${style.gray("<goal>")}        계획 수립
  ${style.mint("omk run")} ${style.gray("<flow> <goal>")}  flow 실행
  ${style.mint("omk team")}               tmux 기반 다중 에이전트 실행
  ${style.mint("omk hud")}                실행 상태 HUD
  ${style.mint("omk merge")}              결과 병합
  ${style.mint("omk sync")}               assets 동기화
  ${style.mint("omk design")}             DESIGN.md 관리
  ${style.mint("omk google")}             Google 생태계 연동

${style.gray("전체 도움말: omk --help")}
`;

const program = new Command();

program
  .name("omk")
  .description("oh-my-kimichan: Kimi Code CLI용 multi-agent orchestration harness")
  .version("0.1.0")
  .addHelpText("before", CUSTOM_HELP)
  .configureOutput({
    writeErr: (str) => process.stderr.write(style.red(str)),
    outputError: (str, write) => write(style.red(`✖ ${str}`)),
  })
  .argument("[command]", "subcommand to run")
  .action(async (command) => {
    if (command) {
      console.error(`❌ 알 수 없는 명령어: ${command}`);
      console.log(CUSTOM_HELP);
      process.exit(1);
    }
    // 인자 없이 omk 실행 시 기본 동작: chat
    await chatCommand({});
  });

program
  .command("init")
  .description("현재 프로젝트에 oh-my-kimichan scaffold 생성")
  .option("--profile <profile>", "프리셋 프로파일", "fullstack")
  .action(initCommand);

program
  .command("doctor")
  .description("Kimi CLI 상태, auth, model, hook, MCP, skills 검사")
  .action(doctorCommand);

program
  .command("chat")
  .description("Kimi root coordinator 실행 (interactive)")
  .option("--agent-file <path>", "루트 에이전트 YAML 경로")
  .action(chatCommand);

program
  .command("plan <goal>")
  .description("계획 전용 실행")
  .option("--thinking <mode>", "thinking mode", "enabled")
  .action(planCommand);

program
  .command("run <flow> <goal>")
  .description("DAG 기반 장기 작업 실행")
  .option("--workers <n>", "worker 수", "1")
  .action(runCommand);

program
  .command("team")
  .description("tmux 기반 다중 에이전트 팀 실행")
  .action(teamCommand);

program
  .command("hud")
  .description("현재 run 상태 및 HUD 표시")
  .action(hudCommand);

program
  .command("merge")
  .description("결과 merge")
  .option("--run <id>", "run ID", "latest")
  .action(mergeCommand);

program
  .command("sync")
  .description("Kimi assets 재생성 및 동기화")
  .action(syncCommand);

const design = program.command("design").description("Google DESIGN.md / awesome-design-md 연동 명령");
design
  .command("init")
  .description("기본 DESIGN.md 템플릿 생성")
  .action(designInitCommand);
design
  .command("list")
  .description("awesome-design-md 컬렉션 목록 표시")
  .action(designListCommand);
design
  .command("apply <name>")
  .description("awesome-design-md에서 DESIGN.md 다운로드 및 적용")
  .action(designApplyCommand);
design
  .command("search <keyword>")
  .description("awesome-design-md 컬렉션 검색")
  .action(designSearchCommand);
design
  .command("lint [file]")
  .description("DESIGN.md 검증")
  .action(designLintCommand);
design
  .command("diff [from] [to]")
  .description("DESIGN.md diff")
  .action(designDiffCommand);
design
  .command("export <format> [file]")
  .description("DESIGN.md export (tailwind 등)")
  .action(designExportCommand);

const google = program.command("google").description("Google 생태계 연동");
google
  .command("stitch-install")
  .description("Google Stitch skills 설치")
  .action(stitchInstallCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

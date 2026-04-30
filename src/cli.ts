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

const CUSTOM_HELP = [
  "",
  style.purple("    ╭────────────────────────────────────────────────────────────────────────╮"),
  style.purple("    │") + "   " + style.pinkBold("🌸 oh-my-kimichan") + style.gray("  —  Kimi CLI, but better.") + "                              " + style.purple("│"),
  style.purple("    │") + "   " + style.gray("The orchestration layer that turns Kimi CLI into a powerful coding team.") + "   " + style.purple("│"),
  style.purple("    ╰────────────────────────────────────────────────────────────────────────╯"),
  "",
  "  " + style.purpleBold("✨ 사용 가능한 명령어") + style.gray(" ─────────────────────────────────────────────────────"),
  "",
  "    " + style.mintBold("omk init") + "      " + style.gray("프로젝트 scaffold 생성 (AGENTS.md, DESIGN.md, .omk/)") +
  "\n    " + style.mintBold("omk doctor") + "    " + style.gray("환경 검사 — CLI, Git, Hooks, MCP, Skills 상태 확인") +
  "\n    " + style.mintBold("omk chat") + "      " + style.gray("Kimi 대화형 실행 (interactive mode)") +
  "\n    " + style.mintBold("omk plan") + "      " + style.gray("<goal>   계획 수립 및 DAG 생성") +
  "\n    " + style.mintBold("omk run") + "       " + style.gray("<flow> <goal>   flow 실행") +
  "\n    " + style.mintBold("omk team") + "      " + style.gray("tmux 기반 다중 에이전트 팀 실행") +
  "\n    " + style.mintBold("omk hud") + "       " + style.gray("실행 상태 & 시스템 사용량 HUD") +
  "\n    " + style.mintBold("omk merge") + "     " + style.gray("결과 병합") +
  "\n    " + style.mintBold("omk sync") + "      " + style.gray("assets 동기화") +
  "\n    " + style.mintBold("omk design") + "    " + style.gray("DESIGN.md 관리") +
  "\n    " + style.mintBold("omk google") + "    " + style.gray("Google 생태계 연동") +
  "",
  "  " + style.purpleBold("💜 빠른 시작") + style.gray(" ────────────────────────────────────────────────────────"),
  "",
  "    " + style.gray("$") + " " + style.cream("omk init") + "     " + style.gray("# 현재 프로젝트 초기화") +
  "\n    " + style.gray("$") + " " + style.cream("omk hud") + "      " + style.gray("# 대시보드 보기") +
  "\n    " + style.gray("$") + " " + style.cream("omk chat") + "     " + style.gray("# Kimi와 대화 시작") +
  "",
  "  " + style.gray("전체 도움말: omk --help    |    문서: https://github.com/dmae97/oh-my-kimichan") +
  "",
].join("\n");

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

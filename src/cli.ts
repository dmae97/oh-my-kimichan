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
import { designInitCommand, designLintCommand, designDiffCommand, designExportCommand } from "./commands/design.js";
import { stitchInstallCommand } from "./commands/google.js";
import { teamCommand } from "./commands/team.js";

const program = new Command();

program
  .name("omk")
  .description("oh-my-kimichan: Kimi Code CLI용 multi-agent orchestration harness")
  .version("0.1.0")
  .argument("[command]", "subcommand to run")
  .action(async () => {
    console.log("oh-my-kimichan v0.1.0");
    console.log("");
    console.log("사용 가능한 명령어:");
    console.log("  omk init         — 프로젝트 scaffold 생성");
    console.log("  omk doctor       — 환경 검사");
    console.log("  omk chat         — Kimi 대화형 실행");
    console.log("  omk plan <goal>  — 계획 수립");
    console.log("  omk run <flow> <goal> — flow 실행");
    console.log("  omk team         — tmux 기반 다중 에이전트 실행");
    console.log("  omk hud          — 실행 상태 HUD");
    console.log("  omk merge        — 결과 병합");
    console.log("  omk sync         — assets 동기화");
    console.log("  omk design       — DESIGN.md 관리");
    console.log("  omk google       — Google 생태계 연동");
    console.log("");
    console.log("도움말: omk --help");
    process.exit(0);
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

const design = program.command("design").description("Google DESIGN.md 관련 명령");
design
  .command("init")
  .description("DESIGN.md 생성")
  .action(designInitCommand);
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

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

const program = new Command();

program
  .name("omk")
  .description("oh-my-kimichan: Kimi Code CLI용 multi-agent orchestration harness")
  .version("0.1.0");

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

program.parseAsync(process.argv).catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

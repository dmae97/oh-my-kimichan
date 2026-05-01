#!/usr/bin/env node
import { Command } from "commander";
import { style, kimichanCliHero } from "./util/theme.js";
import { formatOmkVersionFooter, getOmkVersionSync } from "./util/version.js";
import { t, initI18n } from "./util/i18n.js";

const OMK_VERSION = getOmkVersionSync();
const OMK_VERSION_FOOTER = formatOmkVersionFooter(OMK_VERSION);

function buildCustomHelp(): string {
  return [
    "",
    kimichanCliHero(),
    "",
    "  " + style.purpleBold(t("cli.availableCommands")) + style.gray(" ─────────────────────────────────────────────────────"),
    "",
    "    " + style.mintBold("omk init") + "      " + style.gray(t("cli.initDesc")) +
    "\n    " + style.mintBold("omk doctor") + "    " + style.gray(t("cli.doctorDesc")) +
    "\n    " + style.mintBold("omk chat") + "      " + style.gray(t("cli.chatDesc")) +
    "\n    " + style.mintBold("omk plan") + "      " + style.gray(t("cli.planDesc")) +
    "\n    " + style.mintBold("omk run") + "       " + style.gray(t("cli.runDesc")) +
    "\n    " + style.mintBold("omk team") + "      " + style.gray(t("cli.teamDesc")) +
    "\n    " + style.mintBold("omk hud") + "       " + style.gray(t("cli.hudDesc")) +
    "\n    " + style.mintBold("omk merge") + "     " + style.gray(t("cli.mergeDesc")) +
    "\n    " + style.mintBold("omk sync") + "      " + style.gray(t("cli.syncDesc")) +
    "\n    " + style.mintBold("omk lsp") + "       " + style.gray(t("cli.lspDesc")) +
    "\n    " + style.mintBold("omk design") + "    " + style.gray(t("cli.designDesc")) +
    "\n    " + style.mintBold("omk google") + "    " + style.gray(t("cli.googleDesc")) +
    "",
    "  " + style.purpleBold(t("cli.quickStart")) + style.gray(" ────────────────────────────────────────────────────────"),
    "",
    "    " + style.gray("$") + " " + style.cream("omk init") + "     " + style.gray(t("cli.initProject")) +
    "\n    " + style.gray("$") + " " + style.cream("omk hud") + "      " + style.gray(t("cli.viewDashboard")) +
    "\n    " + style.gray("$") + " " + style.cream("omk chat") + "     " + style.gray(t("cli.startChat")) +
    "",
    "  " + style.gray(t("cli.fullHelp")) +
    "",
  ].join("\n");
}

function shouldLoadStarPrompt(commandName: string): boolean {
  const setting = process.env.OMK_STAR_PROMPT?.trim().toLowerCase();
  if (["0", "false", "off", "no", "never"].includes(setting ?? "")) return false;
  if (process.env.CI || process.env.GITHUB_ACTIONS) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  // Never block the interactive Kimi prompt with a pre-flight inquirer UI.
  // Bare `omk` runs the root command action, whose command name is `omk`.
  if (commandName === "chat" || commandName === "omk") return false;
  if (commandName === "lsp") return false;
  if (process.argv.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg))) return false;
  return true;
}

const program = new Command();

program
  .name("omk")
  .description(t("cli.description"))
  .usage("[options] [command]")
  .version(OMK_VERSION)
  .option("-r, --run-id <id>", t("cli.runIdOption"))
  .addHelpText("before", buildCustomHelp)
  .addHelpText("afterAll", `\n  ${style.gray(OMK_VERSION_FOOTER)}\n`)
  .configureOutput({
    writeErr: (str) => process.stderr.write(style.red(str)),
    outputError: (str, write) => write(style.red(`✖ ${str}`)),
  })
  .allowUnknownOption(false)
  .argument("[command]", "subcommand to run")
  .action(async (command?: string) => {
    await initI18n();
    const customHelp = buildCustomHelp();
    if (command) {
      console.error(t("cli.unknownCommand", command));
      console.log(customHelp);
      process.exit(1);
    }
    const globalOpts = program.opts();
    const hasTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);

    // ── Always show HUD (regardless of TTY) ──
    const { renderHudDashboard } = await import("./commands/hud.js");
    try {
      const hud = await renderHudDashboard({
        runId: globalOpts.runId,
        terminalWidth: process.stdout.columns || 120,
      });
      console.log(hud);
    } catch {
      console.log(kimichanCliHero());
    }

    // No TTY — exit without menu (prompt explicit command input)
    if (!hasTty) {
      console.log(style.gray("\n  💡 omk chat  — " + t("cli.suggestionChat").replace("  💡 omk chat  — ", "")));
      console.log(style.gray("  💡 omk hud   — " + t("cli.suggestionHud").replace("  💡 omk hud   — ", "")));
      console.log(style.gray("  💡 omk --help — " + t("cli.suggestionHelp").replace("  💡 omk --help — ", "").trim()));
      return;
    }

    // ── TTY menu (uses @inquirer/prompts select instead of readline) ──
    // readline returns an empty string immediately when stdin is pipe/EOF,
    // which can unintentionally trigger chat entry. @inquirer/prompts handles
    // this properly and also provides arrow-key selection.
    let answer: string;
    try {
      const { select } = await import("@inquirer/prompts");
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 30_000);
      answer = await select(
        {
          message: t("cli.mainMenu"),
          choices: [
            { name: t("cli.menuChat"), value: "1" },
            { name: t("cli.menuHud"), value: "2" },
            { name: t("cli.menuPlan"), value: "3" },
            { name: t("cli.menuParallel"), value: "4" },
            { name: t("cli.menuHelp"), value: "5" },
            { name: t("cli.menuExit"), value: "q" },
          ],
        },
        { signal: ac.signal }
      );
      clearTimeout(timeoutId);
    } catch {
      // Not a TTY, stdin pipe/EOF, timeout, etc.
      console.log(
        style.gray(t("cli.menuUnavailable"))
      );
      console.log(customHelp);
      return;
    }

    switch (answer) {
      case "1": {
        // Run omk chat subcommand (keeps omk path, not kimi CLI directly)
        const { spawnSync } = await import("child_process");
        const chatArgs = [process.argv[1]!, "chat"];
        if (globalOpts.runId) chatArgs.push("--run-id", globalOpts.runId);
        spawnSync(process.execPath, chatArgs, { stdio: "inherit" });
        break;
      }
      case "2": {
        const { hudCommand } = await import("./commands/hud.js");
        await hudCommand({ runId: globalOpts.runId, watch: true, refreshMs: 2000 });
        break;
      }
      case "3": {
        const { planCommand } = await import("./commands/plan.js");
        const { input } = await import("@inquirer/prompts");
        const goal = await input({ message: "Goal:" });
        await planCommand(goal, { runId: globalOpts.runId });
        break;
      }
      case "4": {
        const { spawnSync } = await import("child_process");
        const { input } = await import("@inquirer/prompts");
        const goal = await input({ message: "Goal:" });
        const parallelArgs = [process.argv[1]!, "parallel", goal];
        if (globalOpts.runId) parallelArgs.push("--run-id", globalOpts.runId);
        spawnSync(process.execPath, parallelArgs, { stdio: "inherit" });
        break;
      }
      case "5":
      case "help":
      case "h": {
        console.log(customHelp);
        break;
      }
      case "q":
      case "quit":
      case "exit": {
        console.log(style.purple("🐾 See you, onii-chan~ 💜"));
        process.exit(0);
        break;
      }
      default: {
        console.log(style.orange(t("cli.unknownChoice", answer)));
        const { spawnSync } = await import("child_process");
        const chatArgs = [process.argv[1]!, "chat"];
        if (globalOpts.runId) chatArgs.push("--run-id", globalOpts.runId);
        spawnSync(process.execPath, chatArgs, { stdio: "inherit" });
      }
    }
  });

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const globalOpts = program.opts();
  if (globalOpts.runId) {
    process.env.OMK_RUN_ID = globalOpts.runId;
  }
  if (!shouldLoadStarPrompt(actionCommand.name())) return;
  const { maybeAskForGitHubStar } = await import("./util/first-run-star.js");
  await maybeAskForGitHubStar({
    version: OMK_VERSION,
    commandName: actionCommand.name(),
  });
});

program
  .command("init")
  .description(t("cmd.initDesc"))
  .option("--profile <profile>", t("cmd.initProfileOption"), "fullstack")
  .action(async (options) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(options);
  });

program
  .command("doctor")
  .description(t("cmd.doctorDesc"))
  .action(async () => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand();
  });

program
  .command("chat")
  .description(t("cmd.chatDesc"))
  .option("--agent-file <path>", t("cmd.chatAgentOption"))
  .option("--workers <n>", t("cmd.chatWorkersOption"), "auto")
  .option("--max-steps-per-turn <n>", t("cmd.chatMaxStepsOption"))
  .action(async (options) => {
    const globalOpts = program.opts();
    const { chatCommand } = await import("./commands/chat.js");
    await chatCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("plan <goal>")
  .description(t("cmd.planDesc"))
  .option("--thinking <mode>", "thinking mode", "enabled")
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { planCommand } = await import("./commands/plan.js");
    await planCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("run [flow] [goal]")
  .description(t("cmd.runDesc"))
  .option("--workers <n>", t("cmd.runWorkersOption"), "auto")
  .action(async (flow, goal, options) => {
    const globalOpts = program.opts();
    const { runCommand } = await import("./commands/run.js");
    await runCommand(flow, goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("team")
  .description(t("cmd.teamDesc"))
  .option("--workers <n>", t("cmd.teamWorkersOption"), "auto")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { teamCommand } = await import("./commands/team.js");
    await teamCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("parallel <goal>")
  .description(t("cmd.parallelDesc"))
  .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
  .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
  .option("--no-watch", t("cmd.parallelNoWatchOption"))
  .option("--chat", t("cmd.parallelChatOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { parallelCommand } = await import("./commands/parallel.js");
    await parallelCommand(goal, {
      ...options,
      runId: globalOpts.runId,
      watch: options.watch,
    });
  });

program
  .command("hud")
  .description(t("cmd.hudDesc"))
  .option("-w, --watch", t("cmd.hudWatchOption"))
  .option("--refresh <ms>", t("cmd.hudRefreshOption"), "2000")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { hudCommand } = await import("./commands/hud.js");
    await hudCommand({
      runId: globalOpts.runId,
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
    });
  });

program
  .command("merge")
  .description(t("cmd.mergeDesc"))
  .option("--run <id>", "run ID", "latest")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { mergeCommand } = await import("./commands/merge.js");
    await mergeCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("sync")
  .description(t("cmd.syncDesc"))
  .action(async () => {
    const { syncCommand } = await import("./commands/sync.js");
    await syncCommand();
  });

program
  .command("lsp [server]")
  .description(t("cmd.lspDesc"))
  .option("--print-config", t("cmd.lspPrintConfigOption"))
  .option("--check", t("cmd.lspCheckOption"))
  .action(async (server, options) => {
    const { lspCommand } = await import("./commands/lsp.js");
    await lspCommand(server, options);
  });

const design = program.command("design").description(t("cmd.designDesc"));
design
  .command("init")
  .description(t("cmd.designInitDesc"))
  .action(async () => {
    const { designInitCommand } = await import("./commands/design.js");
    await designInitCommand();
  });
design
  .command("list")
  .description(t("cmd.designListDesc"))
  .action(async () => {
    const { designListCommand } = await import("./commands/design.js");
    await designListCommand();
  });
design
  .command("apply <name>")
  .description(t("cmd.designDownloadDesc"))
  .action(async (name) => {
    const { designApplyCommand } = await import("./commands/design.js");
    await designApplyCommand(name);
  });
design
  .command("search <keyword>")
  .description(t("cmd.designSearchDesc"))
  .action(async (keyword) => {
    const { designSearchCommand } = await import("./commands/design.js");
    await designSearchCommand(keyword);
  });
design
  .command("lint [file]")
  .description(t("cmd.designValidateDesc"))
  .action(async (file) => {
    const { designLintCommand } = await import("./commands/design.js");
    await designLintCommand(file);
  });
design
  .command("diff [from] [to]")
  .description("DESIGN.md diff")
  .action(async (from, to) => {
    const { designDiffCommand } = await import("./commands/design.js");
    await designDiffCommand(from, to);
  });
design
  .command("export <format> [file]")
  .description(t("cmd.designExportDesc"))
  .action(async (format, file) => {
    const { designExportCommand } = await import("./commands/design.js");
    await designExportCommand(format, file);
  });

const google = program.command("google").description(t("cmd.googleDesc"));
google
  .command("stitch-install")
  .description(t("cmd.googleSkillsDesc"))
  .action(async () => {
    const { stitchInstallCommand } = await import("./commands/google.js");
    await stitchInstallCommand();
  });

const snip = program.command("snip").description("Manage reusable code snippets");
snip
  .command("save <name>")
  .description("Save a snippet from stdin or file")
  .option("-f, --file <path>", "Read snippet content from file")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .action(async (name, options) => {
    const { snipSaveCommand } = await import("./commands/snip.js");
    await snipSaveCommand(name, options);
  });
snip
  .command("get <name>")
  .description("Print a snippet")
  .action(async (name) => {
    const { snipGetCommand } = await import("./commands/snip.js");
    await snipGetCommand(name);
  });
snip
  .command("list")
  .description("List all snippets")
  .action(async () => {
    const { snipListCommand } = await import("./commands/snip.js");
    await snipListCommand();
  });
snip
  .command("search <query>")
  .description("Search snippets")
  .action(async (query) => {
    const { snipSearchCommand } = await import("./commands/snip.js");
    await snipSearchCommand(query);
  });
snip
  .command("delete <name>")
  .description("Delete a snippet")
  .action(async (name) => {
    const { snipDeleteCommand } = await import("./commands/snip.js");
    await snipDeleteCommand(name);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

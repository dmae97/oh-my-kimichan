#!/usr/bin/env node
import { Command } from "commander";
import { style, kimichanCliHero } from "./util/theme.js";
import { formatOmkVersionFooter, getOmkVersionSync } from "./util/version.js";
import { t, initI18n } from "./util/i18n.js";
import { orchestratePrompt } from "./orchestration/orchestrate-prompt.js";

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
    "\n    " + style.mintBold("omk specify") + "  " + style.gray(t("cli.specifyDesc")) +
    "\n    " + style.mintBold("omk agent") + "     " + style.gray(t("cli.agentDesc")) +
    "\n    " + style.mintBold("omk index") + "     " + style.gray(t("cli.indexDesc")) +
    "\n    " + style.mintBold("omk skill") + "     " + style.gray(t("cli.skillDesc")) +
    "\n    " + style.mintBold("omk summary") + "   " + style.gray(t("cli.summaryDesc")) +
    "\n    " + style.mintBold("omk star") + "      " + style.gray(t("cmd.starDesc")) +
    "\n    " + style.mintBold("omk runs") + "     " + style.gray(t("cmd.runsDesc")) +
    "\n    " + style.mintBold("omk history") + "   " + style.gray(t("cmd.historyDesc")) +
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

const program = new Command();

program
  .name("omk")
  .description(t("cli.description"))
  .usage("[options] [command]")
  .version(OMK_VERSION)
  .option("-r, --run-id <id>", t("cli.runIdOption"))
  .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
  .option("--sudo", t("cli.sudoOption"))
  .addHelpText("before", buildCustomHelp)
  .addHelpText("afterAll", `\n  ${style.gray(OMK_VERSION_FOOTER)}\n`)
  .configureOutput({
    writeErr: (str) => process.stderr.write(style.red(str)),
    outputError: (str, write) => write(style.red(`✖ ${str}`)),
  })
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.sudo) {
      process.env.OMK_SUDO = "1";
    }
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
            { name: t("cli.menuPrevious"), value: "0" },
            { name: t("cli.menuHelp"), value: "5" },
            { name: t("cli.menuExit"), value: "q" },
          ],
        },
        { signal: ac.signal }
      );
      clearTimeout(timeoutId);
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        console.log("\n" + style.gray("Cancelled."));
        process.exit(0);
      }
      // Not a TTY, stdin pipe/EOF, timeout, etc.
      console.log(
        style.gray(t("cli.menuUnavailable"))
      );
      console.log(customHelp);
      return;
    }

    switch (answer) {
      case "1": {
        const { input } = await import("@inquirer/prompts");
        let rawPrompt: string;
        try {
          rawPrompt = await input({ message: "Prompt:" });
        } catch (err) {
          if (err instanceof Error && err.name === "ExitPromptError") {
            console.log(style.purple("🐾 See you, onii-chan~ 💜"));
            process.exit(0);
          }
          throw err;
        }
        try {
          await orchestratePrompt(rawPrompt, {
            sourceCommand: "default",
            runId: globalOpts.runId,
            workers: globalOpts.workers,
          });
        } catch {
          const { spawnSync } = await import("child_process");
          const chatArgs = [process.argv[1]!, "chat", "--layout", "auto", "--brand", "kimichan"];
          if (globalOpts.runId) chatArgs.push("--run-id", globalOpts.runId);
          if (globalOpts.workers) chatArgs.push("--workers", globalOpts.workers);
          const result = spawnSync(process.execPath, chatArgs, { stdio: "inherit" });
          if (result.status !== 0) {
            process.exit(result.status ?? 1);
          }
        }
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
        let goal: string;
        try {
          goal = await input({ message: "Goal:" });
        } catch (err) {
          if (err instanceof Error && err.name === "ExitPromptError") {
            console.log(style.purple("🐾 See you, onii-chan~ 💜"));
            process.exit(0);
          }
          throw err;
        }
        await planCommand(goal, { runId: globalOpts.runId });
        break;
      }
      case "4": {
        const { spawnSync } = await import("child_process");
        const { input } = await import("@inquirer/prompts");
        let goal: string;
        try {
          goal = await input({ message: "Goal:" });
        } catch (err) {
          if (err instanceof Error && err.name === "ExitPromptError") {
            console.log(style.purple("🐾 See you, onii-chan~ 💜"));
            process.exit(0);
          }
          throw err;
        }
        const parallelArgs = [process.argv[1]!, "parallel", goal];
        if (globalOpts.runId) parallelArgs.push("--run-id", globalOpts.runId);
        if (globalOpts.workers) parallelArgs.push("--workers", globalOpts.workers);
        const result = spawnSync(process.execPath, parallelArgs, { stdio: "inherit" });
        if (result.status !== 0) {
          process.exit(result.status ?? 1);
        }
        break;
      }
      case "0": {
        const { selectLatestRunName, listRunCandidates } = await import("./commands/hud.js");
        const { getOmkPath, pathExists } = await import("./util/fs.js");
        const runsDir = getOmkPath("runs");
        let prevRunId: string | null = globalOpts.runId ?? null;
        if (!prevRunId && (await pathExists(runsDir))) {
          const candidates = await listRunCandidates(runsDir);
          prevRunId = selectLatestRunName(candidates);
        }
        if (prevRunId) {
          const { hudCommand } = await import("./commands/hud.js");
          await hudCommand({ runId: prevRunId, watch: true, refreshMs: 2000 });
        } else {
          console.log(style.gray("  No previous run found."));
        }
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
        const { input } = await import("@inquirer/prompts");
        let rawPrompt: string;
        try {
          rawPrompt = await input({ message: "Prompt:" });
        } catch (err) {
          if (err instanceof Error && err.name === "ExitPromptError") {
            console.log(style.purple("🐾 See you, onii-chan~ 💜"));
            process.exit(0);
          }
          throw err;
        }
        try {
          await orchestratePrompt(rawPrompt, {
            sourceCommand: "default",
            runId: globalOpts.runId,
            workers: globalOpts.workers,
          });
        } catch {
          const { spawnSync } = await import("child_process");
          const chatArgs = [process.argv[1]!, "chat"];
          if (globalOpts.runId) chatArgs.push("--run-id", globalOpts.runId);
          if (globalOpts.workers) chatArgs.push("--workers", globalOpts.workers);
          const result = spawnSync(process.execPath, chatArgs, { stdio: "inherit" });
          if (result.status !== 0) {
            process.exit(result.status ?? 1);
          }
        }
      }
    }
  });

program.hook("preAction", async (_thisCommand, _actionCommand) => {
  const globalOpts = program.opts();
  if (globalOpts.runId) {
    process.env.OMK_RUN_ID = globalOpts.runId;
  }
});

program.hook("postAction", async (_thisCommand, actionCommand) => {
  try {
    const { maybeAskForGitHubStarAfterCommand } = await import("./util/first-run-star.js");
    await maybeAskForGitHubStarAfterCommand({
      version: OMK_VERSION,
      commandName: actionCommand.name(),
    });
  } catch {
    // Swallow star prompt errors so original command success is preserved.
  }
});

program
  .command("star")
  .description(t("cmd.starDesc"))
  .option("--status", "Show local star prompt state")
  .action(async (options) => {
    const { starCommand } = await import("./commands/star.js");
    await starCommand(options);
  });

program
  .command("runs")
  .description(t("cmd.runsDesc"))
  .option("-n, --limit <n>", t("cmd.runsLimitOption"), "20")
  .option("-w, --watch", t("cmd.runsWatchOption"))
  .option("--refresh <ms>", t("cmd.runsRefreshOption"), "3000")
  .option("--status <status>", t("cmd.runsStatusOption"))
  .option("--search <keyword>", t("cmd.runsSearchOption"))
  .option("--since <iso-date>", t("cmd.runsSinceOption"))
  .option("--until <iso-date>", t("cmd.runsUntilOption"))
  .option("--stats", "Show aggregate statistics instead of list")
  .option("--insights", "Show parallel-computed insights (longest, most complex, failure hotspots, activity)")
  .option("--export <path>", t("cmd.runsExportOption"))
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const { runsCommand } = await import("./commands/runs.js");
    await runsCommand({
      limit: Number.parseInt(options.limit, 10),
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      json: Boolean(options.json),
      statusFilter: options.status,
      searchKeyword: options.search,
      sinceMs: options.since ? Date.parse(options.since) : undefined,
      untilMs: options.until ? Date.parse(options.until) : undefined,
      stats: Boolean(options.stats),
      exportPath: options.export,
      insights: Boolean(options.insights),
    });
  });

program
  .command("history")
  .description(t("cmd.historyDesc"))
  .option("-n, --limit <n>", t("cmd.runsLimitOption"), "20")
  .option("-w, --watch", t("cmd.runsWatchOption"))
  .option("--refresh <ms>", t("cmd.runsRefreshOption"), "3000")
  .option("--status <status>", t("cmd.runsStatusOption"))
  .option("--search <keyword>", t("cmd.runsSearchOption"))
  .option("--since <iso-date>", t("cmd.runsSinceOption"))
  .option("--until <iso-date>", t("cmd.runsUntilOption"))
  .option("--stats", "Show aggregate statistics instead of list")
  .option("--insights", "Show parallel-computed insights (longest, most complex, failure hotspots, activity)")
  .option("--export <path>", t("cmd.runsExportOption"))
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const { runsCommand } = await import("./commands/runs.js");
    await runsCommand({
      limit: Number.parseInt(options.limit, 10),
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      json: Boolean(options.json),
      statusFilter: options.status,
      searchKeyword: options.search,
      sinceMs: options.since ? Date.parse(options.since) : undefined,
      untilMs: options.until ? Date.parse(options.until) : undefined,
      stats: Boolean(options.stats),
      exportPath: options.export,
      insights: Boolean(options.insights),
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
  .option("--json", t("cmd.doctorJsonOption"))
  .option("--soft", "Soft mode: do not fail on missing tools")
  .action(async (options) => {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand(options);
  });

program
  .command("index")
  .description(t("cmd.indexDesc"))
  .option("--changed", t("cmd.indexChangedOption"))
  .option("--symbols", t("cmd.indexSymbolsOption"))
  .action(async (options) => {
    const { indexCommand } = await import("./commands/project-index.js");
    await indexCommand({ ...options, symbols: Boolean(options.symbols) });
  });

program
  .command("index-show")
  .description(t("cmd.indexShowDesc"))
  .action(async () => {
    const { indexShowCommand } = await import("./commands/project-index.js");
    await indexShowCommand();
  });

const skill = program.command("skill").description(t("cmd.skillDesc"));
skill
  .command("pack")
  .description(t("cmd.skillPackDesc"))
  .action(async () => {
    const { skillPackCommand } = await import("./commands/skill.js");
    await skillPackCommand();
  });
skill
  .command("install <pack>")
  .description(t("cmd.skillInstallDesc"))
  .action(async (pack) => {
    const { skillInstallCommand } = await import("./commands/skill.js");
    await skillInstallCommand(pack);
  });
skill
  .command("sync")
  .description(t("cmd.skillSyncDesc"))
  .action(async () => {
    const { skillSyncCommand } = await import("./commands/skill.js");
    await skillSyncCommand();
  });

program
  .command("summary")
  .description(t("cmd.summaryDesc"))
  .action(async () => {
    const { summaryLatestCommand } = await import("./commands/summary.js");
    await summaryLatestCommand();
  });

program
  .command("summary-show [run-id]")
  .description(t("cmd.summaryShowDesc"))
  .action(async (runId) => {
    const { summaryShowCommand } = await import("./commands/summary.js");
    await summaryShowCommand(runId);
  });

program
  .command("chat")
  .description(t("cmd.chatDesc"))
  .option("--agent-file <path>", t("cmd.chatAgentOption"))
  .option("--workers <n>", t("cmd.chatWorkersOption"), "auto")
  .option("--max-steps-per-turn <n>", t("cmd.chatMaxStepsOption"))
  .option("--layout <auto|tmux|inline|plain>", t("cmd.chatLayoutOption"), "auto")
  .option("--brand <kimichan|minimal|plain>", t("cmd.chatBrandOption"), "kimichan")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { chatCommand } = await import("./commands/chat.js");
    await chatCommand({ ...options, runId: globalOpts.runId });
  });

program
  .command("cockpit")
  .description(t("cmd.cockpitDesc"))
  .option("--run-id <id>", t("cmd.cockpitRunIdOption"))
  .option("-w, --watch", t("cmd.cockpitWatchOption"))
  .option("--refresh <ms>", t("cmd.cockpitRefreshOption"), "1500")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { cockpitCommand } = await import("./commands/cockpit.js");
    await cockpitCommand({ ...options, runId: globalOpts.runId ?? options.runId });
  });

program
  .command("plan <goal>")
  .description(t("cmd.planDesc"))
  .option("--thinking <mode>", "thinking mode", "enabled")
  .option("--spec-kit", t("cmd.featureSpecKitOption"))
  .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { planCommand } = await import("./commands/plan.js");
    await planCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("feature <goal>")
  .description(t("cmd.featureDesc"))
  .option("--spec-kit", t("cmd.featureSpecKitOption"))
  .option("--no-spec-kit", t("cmd.featureNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { featureCommand } = await import("./commands/workflow.js");
    await featureCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("bugfix <goal>")
  .description(t("cmd.bugfixDesc"))
  .option("--spec-kit", t("cmd.bugfixSpecKitOption"))
  .option("--no-spec-kit", t("cmd.bugfixNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { bugfixCommand } = await import("./commands/workflow.js");
    await bugfixCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("refactor <goal>")
  .description(t("cmd.refactorDesc"))
  .option("--spec-kit", t("cmd.refactorSpecKitOption"))
  .option("--no-spec-kit", t("cmd.refactorNoSpecKitOption"))
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { refactorCommand } = await import("./commands/workflow.js");
    await refactorCommand(goal, { ...options, runId: globalOpts.runId });
  });

program
  .command("review")
  .description(t("cmd.reviewDesc"))
  .option("--ci", t("cmd.reviewCiOption"))
  .option("--soft", t("cmd.reviewSoftOption"))
  .action(async (options) => {
    const globalOpts = program.opts();
    const { reviewCommand } = await import("./commands/workflow.js");
    await reviewCommand({ ...options, runId: globalOpts.runId });
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
  .command("parallel [goal]")
  .description(t("cmd.parallelDesc"))
  .option("--workers <n>", t("cmd.parallelWorkersOption"), "auto")
  .option("--approval-policy <policy>", t("cmd.parallelApprovalOption"), "interactive")
  .option("--watch", t("cmd.parallelWatchOption"))
  .option("--no-watch", t("cmd.parallelNoWatchOption"))
  .option("--view <mode>", "Display mode: cockpit | table | compact", "cockpit")
  .option("--alternate-screen", "Enter alternate screen buffer for full-screen UI")
  .option("--no-pause", "Do not wait for Enter at the end")
  .option("--compact", "Use compact single-line renderer")
  .option("--chat", t("cmd.parallelChatOption"))
  .option("--from-spec <dir>", "Run spec-kit tasks.md as a parallel DAG")
  .action(async (goal, options) => {
    const globalOpts = program.opts();
    const { parallelCommand } = await import("./commands/parallel.js");
    await parallelCommand(goal, {
      ...options,
      runId: globalOpts.runId,
      watch: options.watch,
      noWatch: options.watch === false,
      view: options.view,
      alternateScreen: options.alternateScreen,
      noPause: options.pause === false,
      compact: options.compact,
    });
  });

program
  .command("hud")
  .description(t("cmd.hudDesc"))
  .option("-w, --watch", t("cmd.hudWatchOption"))
  .option("--refresh <ms>", t("cmd.hudRefreshOption"), "2000")
  .option("--compact", "show compact dashboard")
  .option("--section <section>", "show only one section (run|project|resources)")
  .option("--no-clear", "do not clear screen between refreshes")
  .option("--alternate-screen", "use alternate screen buffer")
  .action(async (options) => {
    const globalOpts = program.opts();
    const { hudCommand } = await import("./commands/hud.js");

    const validSections = ["run", "project", "resources"];
    if (options.section && !validSections.includes(options.section)) {
      console.error(`Invalid section: ${options.section}. Valid values: ${validSections.join(", ")}`);
      process.exit(1);
    }

    await hudCommand({
      runId: globalOpts.runId,
      watch: Boolean(options.watch),
      refreshMs: Number.parseInt(options.refresh, 10),
      compact: options.compact,
      section: options.section,
      noClear: options.noClear,
      alternateScreen: options.alternateScreen,
    });
  });

program
  .command("merge [run-id]")
  .description(t("cmd.mergeDesc"))
  .option("--run <id>", "run ID", "latest")
  .option("--strategy <strategy>", "merge strategy (first | best)", "first")
  .option("--dry-run", "preview merge without applying")
  .action(async (runIdArg, options) => {
    const globalOpts = program.opts();
    const { mergeCommand } = await import("./commands/merge.js");
    await mergeCommand({ ...options, runId: globalOpts.runId, run: runIdArg ?? options.run });
  });

program
  .command("sync")
  .description(t("cmd.syncDesc"))
  .option("--global", t("cmd.syncGlobalOption"))
  .option("--dry-run", t("cmd.syncDryRunOption"))
  .option("--diff", t("cmd.syncDiffOption"))
  .option("--rollback", t("cmd.syncRollbackOption"))
  .action(async (options) => {
    const { syncCommand } = await import("./commands/sync.js");
    await syncCommand(options);
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

const specify = program.command("specify").description(t("cli.specifyDesc"));
specify
  .command("init")
  .description("Initialize spec-driven development (spec-kit)")
  .option("--preset <name>", "Preset to apply")
  .action(async (options) => {
    const { specifyInitCommand } = await import("./commands/specify.js");
    await specifyInitCommand(options);
  });
const specifyWf = specify.command("workflow").description("Manage spec-kit workflows");
specifyWf
  .command("run <workflow-id>")
  .description("Run a spec-kit workflow (e.g. speckit)")
  .option("-i, --input <pairs...>", "Input key=value pairs")
  .action(async (workflowId, options) => {
    const { specifyWorkflowRunCommand } = await import("./commands/specify.js");
    const inputs: Record<string, string> = {};
    if (options.input) {
      for (const pair of Array.isArray(options.input) ? options.input : [options.input]) {
        const [k, v] = pair.split("=");
        if (k) inputs[k] = v ?? "";
      }
    }
    await specifyWorkflowRunCommand(workflowId, inputs);
  });
specifyWf
  .command("list")
  .description("List installed workflows")
  .action(async () => {
    const { specifyWorkflowListCommand } = await import("./commands/specify.js");
    await specifyWorkflowListCommand();
  });
const specifyExt = specify.command("extension").description("Manage spec-kit extensions");
specifyExt
  .command("add <name>")
  .description("Add an extension")
  .action(async (name) => {
    const { specifyExtensionAddCommand } = await import("./commands/specify.js");
    await specifyExtensionAddCommand(name);
  });
specifyExt
  .command("list")
  .description("List installed extensions")
  .action(async () => {
    const { specifyExtensionListCommand } = await import("./commands/specify.js");
    await specifyExtensionListCommand();
  });
specify
  .command("version")
  .description("Show spec-kit version")
  .action(async () => {
    const { specifyVersionCommand } = await import("./commands/specify.js");
    await specifyVersionCommand();
  });

const spec = program.command("spec").description(t("cmd.specDesc"));
spec
  .command("init")
  .description(t("cmd.specInitDesc"))
  .option("-f, --force", t("cmd.specInitForceOption"))
  .action(async (options) => {
    const { specInitCommand } = await import("./commands/spec.js");
    await specInitCommand(options);
  });
spec
  .command("status")
  .description(t("cmd.specStatusDesc"))
  .action(async () => {
    const { specStatusCommand } = await import("./commands/spec.js");
    await specStatusCommand();
  });
spec
  .command("check")
  .description(t("cmd.specCheckDesc"))
  .action(async () => {
    const { specCheckCommand } = await import("./commands/spec.js");
    await specCheckCommand();
  });
const specPreset = spec.command("preset").description("Manage spec-kit presets");
specPreset
  .command("install <name>")
  .description("Install a spec-kit preset (built-in: omk)")
  .action(async (name) => {
    const { specPresetInstallCommand } = await import("./commands/spec.js");
    await specPresetInstallCommand(name);
  });

const agent = program.command("agent").description(t("cmd.agentDesc"));
agent
  .command("list")
  .description(t("cmd.agentListDesc"))
  .action(async () => {
    const { agentListCommand } = await import("./commands/agent.js");
    await agentListCommand();
  });
agent
  .command("show <name>")
  .description(t("cmd.agentShowDesc"))
  .action(async (name) => {
    const { agentShowCommand } = await import("./commands/agent.js");
    await agentShowCommand(name);
  });
agent
  .command("create <name>")
  .description(t("cmd.agentCreateDesc"))
  .option("--from <template>", t("cmd.agentCreateFromOption"))
  .action(async (name, options) => {
    const { agentCreateCommand } = await import("./commands/agent.js");
    await agentCreateCommand(name, options);
  });
agent
  .command("doctor")
  .description(t("cmd.agentDoctorDesc"))
  .action(async () => {
    const { agentDoctorCommand } = await import("./commands/agent.js");
    await agentDoctorCommand();
  });

program
  .command("verify")
  .description(t("cmd.verifyDesc"))
  .option("--run <id>", t("cmd.verifyRunOption"))
  .option("--json", t("cmd.verifyJsonOption"))
  .action(async (options) => {
    const globalOpts = program.opts();
    const { verifyCommand } = await import("./commands/verify.js");
    await verifyCommand({ ...options, runId: globalOpts.runId });
  });

const goal = program.command("goal").description(t("cmd.goalDesc"));
goal
  .command("create <rawPrompt>")
  .description(t("cmd.goalCreateDesc"))
  .option("--json", t("cmd.goalJsonOption"))
  .option("--title <title>", t("cmd.goalTitleOption"))
  .option("--objective <text>", t("cmd.goalObjectiveOption"))
  .option("--risk <level>", t("cmd.goalRiskOption"))
  .action(async (rawPrompt, options) => {
    const { goalCreateCommand } = await import("./commands/goal.js");
    await goalCreateCommand(rawPrompt, options);
  });
goal
  .command("list")
  .description(t("cmd.goalListDesc"))
  .option("--json", t("cmd.goalJsonOption"))
  .action(async (options) => {
    const { goalListCommand } = await import("./commands/goal.js");
    await goalListCommand(options);
  });
goal
  .command("show <goal-id>")
  .description(t("cmd.goalShowDesc"))
  .option("--json", t("cmd.goalJsonOption"))
  .action(async (goalId, options) => {
    const { goalShowCommand } = await import("./commands/goal.js");
    await goalShowCommand(goalId, options);
  });
goal
  .command("plan <goal-id>")
  .description(t("cmd.goalPlanDesc"))
  .action(async (goalId) => {
    const { goalPlanCommand } = await import("./commands/goal.js");
    await goalPlanCommand(goalId);
  });
goal
  .command("run <goal-id>")
  .description(t("cmd.goalRunDesc"))
  .option("--workers <n>", t("cmd.goalWorkersOption"), "auto")
  .option("--run-id <id>", t("cmd.goalRunIdOption"))
  .action(async (goalId, options) => {
    const { goalRunCommand } = await import("./commands/goal.js");
    await goalRunCommand(goalId, options);
  });
goal
  .command("verify <goal-id>")
  .description(t("cmd.goalVerifyDesc"))
  .option("--json", t("cmd.goalJsonOption"))
  .action(async (goalId, options) => {
    const { goalVerifyCommand } = await import("./commands/goal.js");
    await goalVerifyCommand(goalId, options);
  });
goal
  .command("close <goal-id>")
  .description(t("cmd.goalCloseDesc"))
  .option("--force", t("cmd.goalForceOption"))
  .option("--reason <text>", t("cmd.goalReasonOption"))
  .action(async (goalId, options) => {
    const { goalCloseCommand } = await import("./commands/goal.js");
    await goalCloseCommand(goalId, options);
  });
goal
  .command("block <goal-id>")
  .description(t("cmd.goalBlockDesc"))
  .requiredOption("--reason <text>", t("cmd.goalReasonOption"))
  .action(async (goalId, options) => {
    const { goalBlockCommand } = await import("./commands/goal.js");
    await goalBlockCommand(goalId, options);
  });
goal
  .command("continue [goal-id]")
  .description("Continue the latest active goal (or specified goal-id)")
  .option("--workers <n>", "Worker count", "auto")
  .option("--run-id <id>", "Run ID")
  .action(async (goalId, options) => {
    const { goalContinueCommand } = await import("./commands/goal.js");
    await goalContinueCommand(goalId, options);
  });

const mcp = program.command("mcp").description(t("cli.mcpDesc"));
mcp
  .command("list")
  .description(t("cmd.mcpListDesc"))
  .action(async () => {
    const { mcpListCommand } = await import("./commands/mcp.js");
    await mcpListCommand();
  });
mcp
  .command("doctor")
  .description(t("cmd.mcpDoctorDesc"))
  .action(async () => {
    const { mcpDoctorCommand } = await import("./commands/mcp.js");
    await mcpDoctorCommand();
  });
mcp
  .command("test <server>")
  .description(t("cmd.mcpTestDesc"))
  .action(async (server) => {
    const { mcpTestCommand } = await import("./commands/mcp.js");
    await mcpTestCommand(server);
  });
mcp
  .command("remove <server>")
  .description("Remove an MCP server from project-local .kimi/mcp.json or .omk/mcp.json")
  .action(async (server) => {
    const { mcpRemoveCommand } = await import("./commands/mcp.js");
    await mcpRemoveCommand(server);
  });
mcp
  .command("add <server>")
  .description("Copy an MCP server from global ~/.kimi/mcp.json into project .omk/mcp.json")
  .action(async (server) => {
    const { mcpAddCommand } = await import("./commands/mcp.js");
    await mcpAddCommand(server);
  });
mcp
  .command("install <name> [args...]")
  .description("Install a new MCP server into project .omk/mcp.json")
  .option("-e, --env <pair>", "Environment variable (KEY=VALUE)", (val: string, prev: string[]) => [...prev, val], [])
  .action(async (name, args, options) => {
    const { mcpInstallCommand } = await import("./commands/mcp.js");
    await mcpInstallCommand(name, args[0] ?? name, args.slice(1), { env: options.env });
  });
mcp
  .command("sync-global")
  .description("Import global Kimi MCP servers into project-local config")
  .option("--overwrite", "Overwrite existing local definitions with global ones")
  .option("--omk", "Write to .omk/mcp.json instead of .kimi/mcp.json")
  .action(async (options) => {
    const { mcpSyncGlobalCommand } = await import("./commands/mcp.js");
    await mcpSyncGlobalCommand(options);
  });

const dag = program.command("dag").description(t("cli.dagDesc"));
dag
  .command("from-spec [spec-dir]")
  .description("Convert spec-kit tasks.md to OMK DAG JSON")
  .option("-o, --output <path>", "Output JSON file path")
  .option("-p, --parallel", "Enable intra-phase parallelism")
  .option("-r, --run <id>", "Use spec from run ID (latest)")
  .action(async (specDir, options) => {
    const { dagFromSpecCommand } = await import("./commands/dag-from-spec.js");
    const root = (await import("./util/fs.js")).getProjectRoot();
    const dir = specDir ?? `${root}/specs`;
    await dagFromSpecCommand(dir, {
      output: options.output,
      parallel: Boolean(options.parallel),
      run: options.run,
    });
  });
dag
  .command("validate [file]")
  .description(t("cmd.dagValidateDesc"))
  .action(async (filePath) => {
    const { dagValidateCommand } = await import("./commands/dag.js");
    try {
      await dagValidateCommand(filePath);
    } catch {
      process.exit(1);
    }
  });
dag
  .command("show <run-id>")
  .description(t("cmd.dagShowDesc"))
  .action(async (runId) => {
    const { dagShowCommand } = await import("./commands/dag.js");
    await dagShowCommand(runId);
  });
dag
  .command("replay <run-id> [target] [subtarget]")
  .description(t("cmd.dagReplayDesc"))
  .option("--node <id>", t("cmd.dagReplayNodeOption"))
  .option("--from-failure", t("cmd.dagReplayFromFailureOption"))
  .option("--dry-run", t("cmd.dagReplayDryRunOption"))
  .action(async (runId, target, subtarget, options) => {
    const { dagReplayCommand } = await import("./commands/dag.js");
    await dagReplayCommand(runId, target, subtarget, options);
  });

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(0);
  }
  console.error("Unexpected error:", err);
  process.exit(1);
});

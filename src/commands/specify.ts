import { execa } from "execa";
import { style, status, header, label } from "../util/theme.js";
import { getProjectRoot } from "../util/fs.js";
import { t } from "../util/i18n.js";

/**
 * Resolve the spec-kit CLI executable.
 * Tries "specify", then "python -m specify_cli", then "python3 -m specify_cli".
 */
export async function resolveSpecifyCli(): Promise<{ cmd: string; args: string[] } | null> {
  try {
    await execa("specify", ["--version"], { timeout: 5000 });
    return { cmd: "specify", args: [] };
  } catch {
    // ignore
  }

  try {
    await execa("python", ["-m", "specify_cli", "--version"], { timeout: 5000 });
    return { cmd: "python", args: ["-m", "specify_cli"] };
  } catch {
    // ignore
  }

  try {
    await execa("python3", ["-m", "specify_cli", "--version"], { timeout: 5000 });
    return { cmd: "python3", args: ["-m", "specify_cli"] };
  } catch {
    // ignore
  }

  return null;
}

function printInstallGuide(): void {
  console.error(status.error(t("specify.notInstalled")));
  console.error("");
  console.error(label(t("specify.installLabel"), ""));
  console.error("  " + style.gray("pip install specify-cli"));
  console.error("  " + style.gray("# or"));
  console.error("  " + style.gray("pipx install specify-cli"));
  console.error("  " + style.gray("# or"));
  console.error("  " + style.gray("git clone https://github.com/github/spec-kit.git"));
  console.error("  " + style.gray("cd spec-kit && pip install -e ."));
  console.error("");
  console.error(label(t("specify.refLabel"), ""));
  console.error("  " + style.cream("https://github.com/github/spec-kit"));
}

async function runSpecifySubcommand(
  subcommand: string,
  extraArgs: string[] = [],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<void> {
  const cli = await resolveSpecifyCli();
  if (!cli) {
    printInstallGuide();
    process.exit(1);
  }

  const args = [...cli.args, subcommand, ...extraArgs];
  const cwd = options.cwd ?? getProjectRoot();

  console.log(header(t("specify.running", subcommand)));
  console.log(label(t("specify.cmdLabel"), [cli.cmd, ...args].join(" ")));
  console.log("");

  const proc = execa(cli.cmd, args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });

  try {
    await proc;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "exitCode" in err) {
      process.exit((err as { exitCode: number }).exitCode);
    }
    throw err;
  }
}

export async function specifyInitCommand(options: { preset?: string } = {}): Promise<void> {
  const extra: string[] = [];
  if (options.preset) {
    extra.push("--preset", options.preset);
  }
  await runSpecifySubcommand("init", extra);
}

export async function specifyWorkflowRunCommand(
  workflowId: string,
  inputs: Record<string, string> = {}
): Promise<void> {
  const extra: string[] = ["run", workflowId];
  for (const [k, v] of Object.entries(inputs)) {
    extra.push("--input", `${k}=${v}`);
  }
  await runSpecifySubcommand("workflow", extra);
}

export async function specifyWorkflowListCommand(): Promise<void> {
  await runSpecifySubcommand("workflow", ["list"]);
}

export async function specifyExtensionAddCommand(name: string): Promise<void> {
  await runSpecifySubcommand("extension", ["add", name]);
}

export async function specifyExtensionListCommand(): Promise<void> {
  await runSpecifySubcommand("extension", ["list"]);
}

export async function specifyPresetAddCommand(name: string): Promise<void> {
  await runSpecifySubcommand("preset", ["add", name]);
}

export async function specifyPresetListCommand(): Promise<void> {
  await runSpecifySubcommand("preset", ["list"]);
}

export async function specifyVersionCommand(): Promise<void> {
  const cli = await resolveSpecifyCli();
  if (!cli) {
    printInstallGuide();
    process.exit(1);
  }
  const args = [...cli.args, "--version"];
  const result = await execa(cli.cmd, args, { timeout: 10000 });
  console.log(result.stdout.trim());
}

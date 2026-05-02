import { join } from "path";
import { mkdir } from "fs/promises";
import { style, status, header, label } from "../util/theme.js";
import { getProjectRoot, pathExists, readTextFile } from "../util/fs.js";
import { checkCommand } from "../util/shell.js";
import { resolveSpecifyCli } from "./specify.js";
import { runShell } from "../util/shell.js";

const SPEC_DIR = ".specify";

interface SpecConfig {
  enabled: boolean;
  autoInit: "ask" | "never" | "always";
  provider: string;
  script: string;
}

function readSpecConfig(configText: string): SpecConfig {
  const enabledMatch = configText.match(/^\s*enabled\s*=\s*(true|false)\b/m);
  const autoInitMatch = configText.match(/^\s*auto_init\s*=\s*"([^"]+)"/m);
  const providerMatch = configText.match(/^\s*provider\s*=\s*"([^"]+)"/m);
  const scriptMatch = configText.match(/^\s*script\s*=\s*"([^"]+)"/m);

  return {
    enabled: enabledMatch?.[1] === "true",
    autoInit: (autoInitMatch?.[1] as SpecConfig["autoInit"]) ?? "ask",
    provider: providerMatch?.[1] ?? "omk",
    script: scriptMatch?.[1] ?? "auto",
  };
}

async function loadOmkConfig(): Promise<string> {
  const root = getProjectRoot();
  return readTextFile(join(root, ".omk", "config.toml"), "");
}

// ── omk spec init ─────────────────────────────────────────────

export async function specInitCommand(options: { force?: boolean } = {}): Promise<void> {
  const root = getProjectRoot();
  const specDir = join(root, SPEC_DIR);

  if (await pathExists(specDir)) {
    if (!options.force) {
      console.log(status.warn(".specify/ already exists. Use --force to reinitialize."));
      return;
    }
    console.log(status.warn("Reinitializing .specify/ with --force"));
  }

  const cli = await resolveSpecifyCli();
  if (!cli) {
    console.error(status.error("spec-kit CLI not found. Install: pip install specify-cli"));
    process.exit(1);
  }

  const args = [...cli.args, "init", "--here"];
  if (options.force) args.push("--force");

  console.log(header("omk spec init"));
  console.log(label("Command", `${cli.cmd} ${args.join(" ")}`));
  console.log();

  const result = await runShell(cli.cmd, args, { cwd: root, timeout: 60000 });
  if (result.failed) {
    console.error(result.stderr);
    process.exit(result.exitCode);
  }
  console.log(result.stdout);
}

// ── omk spec status ───────────────────────────────────────────

export async function specStatusCommand(): Promise<void> {
  const root = getProjectRoot();
  const specDir = join(root, SPEC_DIR);

  console.log(header("omk spec status"));

  if (!(await pathExists(specDir))) {
    console.log(status.warn(".specify/ not found"));
    console.log(style.gray("Run 'omk spec init' to initialize spec-kit."));
    return;
  }

  const artifacts = [
    { name: "spec.md", path: join(specDir, "spec.md") },
    { name: "plan.md", path: join(specDir, "plan.md") },
    { name: "tasks.md", path: join(specDir, "tasks.md") },
    { name: "constitution.md", path: join(specDir, "constitution.md") },
  ];

  const results = await Promise.all(
    artifacts.map(async (a) => {
      const exists = await pathExists(a.path);
      let size = 0;
      if (exists) {
        const content = await readTextFile(a.path, "");
        size = content.length;
      }
      return { ...a, exists, size };
    })
  );

  for (const r of results) {
    const icon = r.exists ? "✅" : "❌";
    console.log(`  ${icon} ${r.name.padEnd(18)} ${r.exists ? `${r.size} bytes` : "missing"}`);
  }

  const ready = results.filter((r) => r.exists).length;
  console.log();
  console.log(label("Ready", `${ready}/${results.length} artifacts`));

  if (ready === results.length) {
    console.log(status.ok("Spec kit is ready for planning."));
  } else if (ready > 0) {
    console.log(status.warn("Partial spec kit — some artifacts missing."));
  } else {
    console.log(status.error("No spec artifacts found. Run 'omk spec init' first."));
  }
}

// ── omk spec check ────────────────────────────────────────────

export async function specCheckCommand(): Promise<void> {
  const root = getProjectRoot();
  const specDir = join(root, SPEC_DIR);

  console.log(header("omk spec check"));

  const checks: Array<{ name: string; status: "ok" | "warn" | "fail" | "info"; message: string }> = [];

  // Check specify CLI
  const cli = await resolveSpecifyCli();
  checks.push({
    name: "spec-kit CLI",
    status: cli ? "ok" : "fail",
    message: cli ? `${cli.cmd} ${cli.args.join(" ")}` : "not found",
  });

  // Check uv/uvx
  const uvExists = await checkCommand("uv");
  const uvxExists = await checkCommand("uvx");
  checks.push({
    name: "uv / uvx",
    status: uvExists || uvxExists ? "ok" : "warn",
    message: uvExists ? "uv found" : uvxExists ? "uvx found" : "not found (optional)",
  });

  // Check .specify/
  const specExists = await pathExists(specDir);
  checks.push({
    name: ".specify/",
    status: specExists ? "ok" : "warn",
    message: specExists ? "initialized" : "not initialized",
  });

  // Check artifacts
  if (specExists) {
    const artifacts = ["spec.md", "plan.md", "tasks.md"];
    const artifactChecks = await Promise.all(
      artifacts.map(async (name) => ({
        name,
        exists: await pathExists(join(specDir, name)),
      }))
    );
    const missing = artifactChecks.filter((a) => !a.exists).map((a) => a.name);
    checks.push({
      name: "Artifacts",
      status: missing.length === 0 ? "ok" : "warn",
      message: missing.length === 0 ? "all present" : `missing: ${missing.join(", ")}`,
    });
  }

  // Check config
  const config = await loadOmkConfig();
  const specConfig = readSpecConfig(config);
  checks.push({
    name: "Config [spec]",
    status: specConfig.enabled ? "ok" : "info",
    message: `enabled=${specConfig.enabled}, auto_init=${specConfig.autoInit}, provider=${specConfig.provider}`,
  });

  for (const c of checks) {
    const icon = c.status === "ok" ? "✅" : c.status === "warn" ? "⚠️" : c.status === "fail" ? "❌" : "ℹ️";
    console.log(`  ${icon} ${c.name.padEnd(14)} ${c.message}`);
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  console.log();
  if (fails > 0) {
    console.log(status.error(`${fails} check(s) failed`));
    throw new Error(`${fails} spec kit check(s) failed`);
  } else {
    console.log(status.ok("Spec kit check passed"));
  }
}

// ── Plan integration helpers ──────────────────────────────────

export interface SpecKitPlanContext {
  useSpecKit: boolean;
  specDir: string;
  artifacts: {
    spec?: string;
    plan?: string;
    tasks?: string;
  };
}

export async function detectSpecKitContext(
  explicitFlag: "yes" | "no" | "auto"
): Promise<SpecKitPlanContext> {
  const root = getProjectRoot();
  const specDir = join(root, SPEC_DIR);
  const specExists = await pathExists(specDir);

  if (explicitFlag === "no") {
    return { useSpecKit: false, specDir, artifacts: {} };
  }

  if (explicitFlag === "yes") {
    return await loadSpecArtifacts(specDir);
  }

  // auto mode
  if (!specExists) {
    return { useSpecKit: false, specDir, artifacts: {} };
  }

  return await loadSpecArtifacts(specDir);
}

async function loadSpecArtifacts(specDir: string): Promise<SpecKitPlanContext> {
  const artifacts: SpecKitPlanContext["artifacts"] = {};

  const [spec, plan, tasks] = await Promise.all([
    readTextFile(join(specDir, "spec.md"), ""),
    readTextFile(join(specDir, "plan.md"), ""),
    readTextFile(join(specDir, "tasks.md"), ""),
  ]);

  if (spec.trim()) artifacts.spec = spec;
  if (plan.trim()) artifacts.plan = plan;
  if (tasks.trim()) artifacts.tasks = tasks;

  const useSpecKit = Object.keys(artifacts).length > 0;
  return { useSpecKit, specDir, artifacts };
}

export function injectSpecKitPrompt(basePrompt: string, ctx: SpecKitPlanContext): string {
  if (!ctx.useSpecKit) return basePrompt;

  const sections: string[] = [basePrompt];
  sections.push("\n\n--- SPEC KIT CONTEXT ---");

  if (ctx.artifacts.spec) {
    sections.push(`\n## Specification (${join(ctx.specDir, "spec.md")})\n${ctx.artifacts.spec}`);
  }
  if (ctx.artifacts.plan) {
    sections.push(`\n## Plan (${join(ctx.specDir, "plan.md")})\n${ctx.artifacts.plan}`);
  }
  if (ctx.artifacts.tasks) {
    sections.push(`\n## Tasks (${join(ctx.specDir, "tasks.md")})\n${ctx.artifacts.tasks}`);
  }

  sections.push("\n--- END SPEC KIT CONTEXT ---");
  return sections.join("\n");
}

// ── omk spec preset install ───────────────────────────────────

export async function specPresetInstallCommand(name: string): Promise<void> {
  const root = getProjectRoot();
  const builtinPresetDir = join(root, ".omk", "templates", "spec-kit-omk-preset");
  const installDir = join(root, ".omk", "spec-kit-preset");

  if (name === "omk") {
    if (!(await pathExists(builtinPresetDir))) {
      console.error(status.error(`Built-in OMK preset not found at ${builtinPresetDir}`));
      process.exit(1);
    }

    console.log(header("Install OMK Spec-Kit Preset"));
    console.log(label("Source", builtinPresetDir));
    console.log(label("Target", installDir));

    await mkdir(installDir, { recursive: true });

    // Copy preset files
    const result = await runShell("cp", ["-r", `${builtinPresetDir}/.`, installDir], { cwd: root, timeout: 10000 });
    if (result.failed) {
      console.error(status.error(`Failed to copy preset: ${result.stderr}`));
      process.exit(1);
    }

    console.log(status.ok("Preset copied to .omk/spec-kit-preset/"));

    // Register with specify CLI if available
    const cli = await resolveSpecifyCli();
    if (cli) {
      console.log(style.purple("Registering with specify..."));
      const regResult = await runShell(cli.cmd, [...cli.args, "preset", "add", name, "--dev", installDir], {
        cwd: root,
        timeout: 15000,
      });
      if (regResult.failed) {
        console.log(status.warn(`Specify registration failed: ${regResult.stderr}`));
        console.log(style.gray("You can register manually:"));
        console.log(style.cream(`  specify preset add ${name} --dev ${installDir}`));
      } else {
        console.log(status.ok("Preset registered with specify"));
      }
    } else {
      console.log(status.warn("specify CLI not found. Install it to use the preset:"));
      console.log(style.gray("  pip install specify-cli"));
      console.log(style.gray("Then register manually:"));
      console.log(style.cream(`  specify preset add ${name} --dev ${installDir}`));
    }

    console.log("");
    console.log(style.mint("OMK preset installed. Usage:"));
    console.log(style.cream("  specify init --preset omk"));
    console.log(style.cream("  omk feature \"your goal\" --spec-kit"));
  } else {
    console.error(status.error(`Unknown preset: ${name}. Only "omk" is supported.`));
    process.exit(1);
  }
}

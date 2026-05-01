import { join } from "path";
import { homedir } from "os";
import { runShell, checkCommand, getKimiVersion } from "../util/shell.js";
import { pathExists, getKimiConfigPath, readTextFile, getProjectRoot } from "../util/fs.js";
import { isGitRepo, getCurrentBranch, getGitStatus } from "../util/git.js";
import { style, status, header, separator } from "../util/theme.js";
import { getGlobalMemoryConfigPath, isGraphMemoryBackend, loadMemorySettings, usesExternalNeo4jBackend, usesLocalGraphBackend } from "../memory/memory-config.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { formatBytes } from "../util/output-buffer.js";
import { resolveBundledLspBinary } from "./lsp.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
}

export async function doctorCommand(): Promise<void> {
  console.log(header("oh-my-kimichan doctor"));
  const results: CheckResult[] = [];

  // 1. Node version
  const resources = await getOmkResourceSettings();
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "warn",
    message: nodeMajor >= 20 ? `${nodeVersion}` : `${nodeVersion} ${t("doctor.nodeRecommend")}`,
  });
  results.push({
    name: "OMK Runtime",
    status: resources.profile === "lite" ? "info" : "ok",
    message: `profile=${resources.profile}, RAM=${resources.totalMemoryGb}GB, workers=${resources.maxWorkers}, buffer=${formatBytes(resources.shellMaxBufferBytes)}, MCP=${resources.mcpScope}, skills=${resources.skillsScope}`,
  });

  // 2-5. Check external commands in parallel
  const [kimiExists, gitExists, jqExists, tmuxExists] = await Promise.all([
    checkCommand("kimi"),
    checkCommand("git"),
    checkCommand("jq"),
    checkCommand("tmux"),
  ]);

  // 2. Kimi CLI
  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({ name: "Kimi CLI", status: "ok", message: version ?? t("doctor.kimiInstalled") });
  } else {
    results.push({ name: "Kimi CLI", status: "fail", message: t("doctor.kimiNotFound") });
  }

  // 3. Verify Kimi execution (reuses getKimiVersion() which already called --version)
  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({
      name: "Kimi CLI",
      status: version ? "ok" : "warn",
      message: version ? t("doctor.kimiRunnable") : t("doctor.kimiRunFailed"),
    });
  }

  // 4. Git
  if (gitExists) {
    const isRepo = await isGitRepo();
    if (isRepo) {
      const branch = await getCurrentBranch();
      const status = await getGitStatus();
      results.push({
        name: "Git",
        status: status.clean ? "ok" : "warn",
        message: t("doctor.gitBranchChanges", branch ?? "?", status.changes),
      });
    } else {
      results.push({ name: "Git", status: "warn", message: t("doctor.gitNotRepo") });
    }
  } else {
    results.push({ name: "Git", status: "fail", message: t("doctor.gitNotFound") });
  }

  // 5. jq (hooks depend on it; fail-open without jq = security bypass)
  results.push({
    name: "jq",
    status: jqExists ? "ok" : "fail",
    message: jqExists ? t("doctor.jqInstalled") : t("doctor.jqMissing"),
  });

  // 6. Kimi default config + OMK hooks (parallel check)
  const kimiConfigPath = getKimiConfigPath();
  const root = getProjectRoot();
  const [kimiConfigExists, omkExists] = await Promise.all([
    pathExists(kimiConfigPath),
    pathExists(join(root, ".omk")),
  ]);

  results.push({
    name: "Kimi Config",
    status: kimiConfigExists ? "ok" : "warn",
    message: kimiConfigExists ? t("doctor.kimiConfigExists") : t("doctor.kimiConfigMissing"),
  });

  if (kimiConfigExists) {
    const kimiContent = await readTextFile(kimiConfigPath, "");
    const hasOmkHooks = kimiContent.includes("# >>> omk managed hooks");
    results.push({
      name: "OMK Hooks",
      status: hasOmkHooks ? "ok" : "warn",
      message: hasOmkHooks ? t("doctor.hooksSynced") : t("doctor.hooksRecommendSync"),
    });
  }

  // 7. .omk directory
  results.push({
    name: "OMK Scaffold",
    status: omkExists ? "ok" : "warn",
    message: omkExists ? t("doctor.omkInitialized") : t("doctor.omkInitNeeded"),
  });

  // AGENTS.md
  const agentsMdExists = await pathExists(join(process.cwd(), "AGENTS.md"));
  results.push({
    name: "AGENTS.md",
    status: agentsMdExists ? "ok" : "warn",
    message: agentsMdExists ? t("doctor.agentsMdExists") : t("doctor.agentsMdMissing"),
  });

  // .kimi/AGENTS.md
  const kimiAgentsMdExists = await pathExists(join(process.cwd(), ".kimi", "AGENTS.md"));
  results.push({
    name: ".kimi/AGENTS.md",
    status: kimiAgentsMdExists ? "ok" : "warn",
    message: kimiAgentsMdExists ? t("doctor.kimiAgentsMdExists") : t("doctor.kimiAgentsMdMissing"),
  });

  // .omk/agents/root.yaml
  const rootYamlExists = await pathExists(join(process.cwd(), ".omk", "agents", "root.yaml"));
  results.push({
    name: "root.yaml",
    status: rootYamlExists ? "ok" : "warn",
    message: rootYamlExists ? t("doctor.rootYamlExists") : t("doctor.rootYamlMissing"),
  });

  let okabeAgentCount = 0;
  let totalAgentCount = 0;
  const agentYamlPaths = [
    join(process.cwd(), ".omk", "agents", "root.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "architect.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "coder.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "explorer.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "planner.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "qa.yaml"),
    join(process.cwd(), ".omk", "agents", "roles", "reviewer.yaml"),
  ];
  for (const agentPath of agentYamlPaths) {
    if (!(await pathExists(agentPath))) continue;
    totalAgentCount += 1;
    const content = await readTextFile(agentPath, "");
    if (/^\s*extend:\s*(?:\.\.\/|\.)?\/?okabe\.yaml\b/m.test(content)) okabeAgentCount += 1;
  }
  const okabeBase = await readTextFile(join(process.cwd(), ".omk", "agents", "okabe.yaml"), "");
  const okabeBaseHasDMail = okabeBase.includes("kimi_cli.tools.dmail:SendDMail");
  results.push({
    name: "Okabe Agents",
    status: totalAgentCount > 0 && okabeAgentCount === totalAgentCount && okabeBaseHasDMail ? "ok" : "warn",
    message: totalAgentCount > 0 && okabeBaseHasDMail
      ? `${okabeAgentCount}/${totalAgentCount} agents inherit okabe.yaml (SendDMail)`
      : t("doctor.okabeMissing"),
  });

  // root prompt includes required variables
  const rootPromptPath = join(process.cwd(), ".omk", "prompts", "root.md");
  let rootPromptValid = false;
  let rootPromptHasAgentsMd = false;
  let rootPromptHasSkills = false;
  if (await pathExists(rootPromptPath)) {
    const rootPrompt = await readTextFile(rootPromptPath, "");
    rootPromptHasAgentsMd = rootPrompt.includes("${KIMI_AGENTS_MD}");
    rootPromptHasSkills = rootPrompt.includes("${KIMI_SKILLS}");
    rootPromptValid = rootPromptHasAgentsMd && rootPromptHasSkills;
  }
  results.push({
    name: "Root Prompt",
    status: rootPromptValid ? "ok" : "warn",
    message: rootPromptValid
      ? t("doctor.rootPromptInjected")
      : t("doctor.rootPromptPartial", !rootPromptHasAgentsMd ? "AGENTS_MD " : "", !rootPromptHasSkills ? "SKILLS" : ""),
  });

  // .kimi/skills
  const kimiSkillsDir = join(root, ".kimi", "skills");
  let kimiSkillsCount = 0;
  if (await pathExists(kimiSkillsDir)) {
    try {
      const entries = await (await import("fs/promises")).readdir(kimiSkillsDir, { withFileTypes: true });
      kimiSkillsCount = entries.filter((e) => e.isDirectory()).length;
    } catch { /* ignore */ }
  }
  results.push({
    name: ".kimi/skills",
    status: kimiSkillsCount > 0 ? "ok" : "warn",
    message: kimiSkillsCount > 0 ? t("doctor.skillsExist", kimiSkillsCount) : t("doctor.skillsMissing"),
  });

  // .agents/skills
  const agentsSkillsDir = join(process.cwd(), ".agents", "skills");
  let agentsSkillsCount = 0;
  if (await pathExists(agentsSkillsDir)) {
    try {
      const entries = await (await import("fs/promises")).readdir(agentsSkillsDir, { withFileTypes: true });
      agentsSkillsCount = entries.filter((e) => e.isDirectory()).length;
    } catch { /* ignore */ }
  }
  results.push({
    name: ".agents/skills",
    status: agentsSkillsCount > 0 ? "ok" : "warn",
    message: agentsSkillsCount > 0 ? t("doctor.agentSkillsExist", agentsSkillsCount) : t("doctor.agentSkillsMissing"),
  });

  // .omk/mcp.json
  const omkMcpExists = await pathExists(join(process.cwd(), ".omk", "mcp.json"));
  results.push({
    name: "OMK MCP",
    status: omkMcpExists ? "ok" : "info",
    message: omkMcpExists ? t("doctor.mcpExists") : t("doctor.mcpMissing"),
  });

  const lspConfigPath = join(process.cwd(), ".omk", "lsp.json");
  const lspConfigExists = await pathExists(lspConfigPath);
  let lspConfigValid = false;
  if (lspConfigExists) {
    try {
      const parsed = JSON.parse(await readTextFile(lspConfigPath, "{}")) as {
        enabled?: boolean;
        servers?: Record<string, unknown>;
      };
      lspConfigValid = parsed.enabled === true && typeof parsed.servers?.typescript === "object";
    } catch {
      lspConfigValid = false;
    }
  }
  const tsLspBinary = resolveBundledLspBinary("typescript");
  const tsLspAvailable = tsLspBinary.includes("/") || tsLspBinary.includes("\\")
    ? await pathExists(tsLspBinary)
    : await checkCommand(tsLspBinary);
  results.push({
    name: "Built-in LSP",
    status: lspConfigValid && tsLspAvailable ? "ok" : "warn",
    message: lspConfigValid && tsLspAvailable
      ? `.omk/lsp.json + TypeScript LSP (${tsLspBinary})`
      : t("doctor.lspMissing"),
  });

  // dangerous hooks executable
  const hooksDir = join(process.cwd(), ".omk", "hooks");
  let hooksExecutable = true;
  if (await pathExists(hooksDir)) {
    try {
      const entries = await (await import("fs/promises")).readdir(hooksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".sh")) {
          const stat = await (await import("fs/promises")).stat(join(hooksDir, entry.name));
          if ((stat.mode & 0o111) === 0) hooksExecutable = false;
        }
      }
    } catch { /* ignore */ }
  }
  results.push({
    name: "Hooks Exec",
    status: hooksExecutable ? "ok" : "warn",
    message: hooksExecutable ? t("doctor.hooksExecutable") : t("doctor.hooksNotExecutable"),
  });

  // 8-9. Global MCP + Global Skills (parallel)
  const globalMcpPath = join(homedir(), ".kimi", "mcp.json");
  const globalSkillsDir = join(homedir(), ".kimi", "skills");
  const [globalMcpExists, globalSkillsExists] = await Promise.all([
    pathExists(globalMcpPath),
    pathExists(globalSkillsDir),
  ]);

  let globalMcpCount = 0;
  if (globalMcpExists) {
    try {
      const content = await readTextFile(globalMcpPath, "{}");
      const parsed = JSON.parse(content);
      globalMcpCount = Object.keys(parsed.mcpServers ?? {}).length;
    } catch {
      // ignore
    }
  }
  results.push({
    name: "Global MCP",
    status: globalMcpCount > 0 ? "ok" : "warn",
    message: globalMcpCount > 0 ? t("doctor.globalMcpSynced", globalMcpCount) : t("doctor.globalMcpMissing"),
  });

  let globalSkillCount = 0;
  if (globalSkillsExists) {
    try {
      const entries = await (await import("fs/promises")).readdir(globalSkillsDir, { withFileTypes: true });
      globalSkillCount = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).length;
    } catch {
      // ignore
    }
  }
  results.push({
    name: "Global Skills",
    status: globalSkillCount > 0 ? "ok" : "info",
    message: globalSkillCount > 0 ? t("doctor.globalSkillsSynced", globalSkillCount) : t("doctor.globalSkillsMissing"),
  });

  const globalMemoryConfigPath = getGlobalMemoryConfigPath();
  const [globalMemoryConfigExists, memorySettings] = await Promise.all([
    pathExists(globalMemoryConfigPath),
    loadMemorySettings(process.cwd()),
  ]);
  results.push({
    name: "Global Memory",
    status: globalMemoryConfigExists ? "ok" : "warn",
    message: globalMemoryConfigExists
      ? t("doctor.memorySynced")
      : t("doctor.memoryMissing"),
  });
  results.push({
    name: "Graph Memory",
    status: isGraphMemoryBackend(memorySettings.backend)
      ? usesExternalNeo4jBackend(memorySettings.backend)
        ? memorySettings.neo4j.configured ? "ok" : memorySettings.strict ? "fail" : "warn"
        : "ok"
      : "info",
    message: isGraphMemoryBackend(memorySettings.backend)
      ? usesLocalGraphBackend(memorySettings.backend)
        ? `backend=local_graph, ontology=${memorySettings.localGraph.ontology}, state=${memorySettings.localGraph.path}`
        : memorySettings.neo4j.configured
          ? `backend=${memorySettings.backend}, database=${memorySettings.neo4j.database}, project=${memorySettings.project.key}`
          : t("doctor.memoryNeo4jBackend", memorySettings.backend, memorySettings.neo4j.missing.join(", "))
      : t("doctor.memoryFileBackend"),
  });

  // Global ~/.kimi pollution check
  const globalKimiDir = join(homedir(), ".kimi");
  let globalPollution = false;
  if (await pathExists(globalKimiDir)) {
    try {
      const entries = await (await import("fs/promises")).readdir(globalKimiDir, { withFileTypes: true });
      const unexpected = entries.filter((e) => e.isFile() && !e.name.match(/^(config\.toml|mcp\.json|omk\.memory\.toml)$/)).map((e) => e.name);
      if (unexpected.length > 0) globalPollution = true;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Pollution",
    status: globalPollution ? "warn" : "ok",
    message: globalPollution ? t("doctor.globalPollution") : t("doctor.globalClean"),
  });

  // 12. Tmux (optional for team mode)
  results.push({
    name: "tmux",
    status: tmuxExists ? "ok" : "info",
    message: tmuxExists ? t("doctor.tmuxInstalled") : t("doctor.tmuxRecommend"),
  });

  // Print results
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️" : r.status === "fail" ? "❌" : "ℹ️";
    console.log(`${icon} ${r.name.padEnd(14)} ${r.message}`);
  }

  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;

  console.log();
  if (fails > 0) {
    console.log(t("doctor.failures", fails, warns));
    process.exit(1);
  } else if (warns > 0) {
    console.log(t("doctor.warnings", warns));
  } else {
    console.log(t("doctor.allPassed"));
  }
}

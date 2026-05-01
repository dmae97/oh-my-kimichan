import { getProjectRoot, pathExists, getOmkPath, syncAllKimiGlobals } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { mkdir, symlink, writeFile } from "fs/promises";
import { join, relative } from "path";
import { style, header, status } from "../util/theme.js";
import { t } from "../util/i18n.js";

export async function syncCommand(): Promise<void> {
  const root = getProjectRoot();
  console.log(header("oh-my-kimichan sync"));

  // Create empty .kimi/mcp.json template if missing (space for user-added Kimi-specific MCPs)
  const kimiMcpPath = join(root, ".kimi", "mcp.json");
  if (!(await pathExists(kimiMcpPath))) {
    await writeFile(kimiMcpPath, JSON.stringify({ mcpServers: {} }, null, 2));
    console.log(status.ok(t("sync.mcpCreated")));
  }

  // Always sync hooks + MCP + skills + local graph memory policy globally to ~/.kimi/
  // + create local directories in parallel
  const agentsSkills = join(root, ".agents/skills");
  const kimiSkills = join(root, ".kimi/skills");
  await Promise.all([
    syncAllKimiGlobals(),
    mkdir(agentsSkills, { recursive: true }),
    mkdir(kimiSkills, { recursive: true }),
  ]);
  console.log(status.ok(t("sync.globalComplete")));
  console.log("");
  console.log(status.ok(t("sync.mcpOk")));
  console.log(status.ok(t("sync.skillsOk")));
  console.log(status.ok(t("sync.agentSkillsOk")));
  console.log("\n" + status.success(t("sync.complete")));
}

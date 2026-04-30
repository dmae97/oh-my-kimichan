import { execa } from "execa";
import { getOmkPath, pathExists } from "../util/fs.js";

export async function chatCommand(options: { agentFile?: string }): Promise<void> {
  const agentFile = options.agentFile ?? getOmkPath("agents/root.yaml");
  const configFile = getOmkPath("kimi.config.toml");
  const mcpFile = getOmkPath("mcp.json");

  if (!(await pathExists(agentFile))) {
    console.error("❌ root agent YAML이 없습니다. omk init을 먼저 실행하세요.");
    process.exit(1);
  }

  console.log("🤖 Kimi root coordinator 시작...\n");
  const args: string[] = [];
  args.push("--agent-file", agentFile);
  if (await pathExists(configFile)) args.push("--config-file", configFile);
  if (await pathExists(mcpFile)) args.push("--mcp-config-file", mcpFile);

  await execa("kimi", args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

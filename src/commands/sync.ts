import { getProjectRoot, pathExists } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { mkdir, symlink } from "fs/promises";
import { join, relative } from "path";

export async function syncCommand(): Promise<void> {
  const root = getProjectRoot();
  console.log("🔄 oh-my-kimichan sync\n");

  // Ensure .agents/skills exists
  const agentsSkills = join(root, ".agents/skills");
  await mkdir(agentsSkills, { recursive: true });

  // Ensure .kimi/skills exists
  const kimiSkills = join(root, ".kimi/skills");
  await mkdir(kimiSkills, { recursive: true });

  console.log("✅ .kimi/skills 확인");
  console.log("✅ .agents/skills 확인");
  console.log("\n🎉 동기화 완료");
}

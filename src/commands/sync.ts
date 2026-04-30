import { getOmkPath, getProjectRoot, pathExists } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { mkdir, writeFile, symlink } from "fs/promises";
import { join, relative } from "path";

export async function syncCommand(): Promise<void> {
  const root = getProjectRoot();
  console.log("🔄 oh-my-kimichan sync\n");

  // Ensure .kimi/skills symlink points to .omk/skills
  const kimiSkills = join(root, ".kimi/skills");
  const omkSkills = join(root, ".omk/skills");
  if (await pathExists(omkSkills)) {
    try {
      await runShell("rm", ["-rf", kimiSkills], { timeout: 5000 });
      await symlink(relative(join(root, ".kimi"), omkSkills), kimiSkills, "dir");
      console.log("✅ .kimi/skills -> .omk/skills 심볼릭 링크 동기화");
    } catch (e) {
      console.warn("⚠️ symlink 실패:", (e as Error).message);
    }
  }

  // Ensure .agents/skills exists
  const agentsSkills = join(root, ".agents/skills");
  await mkdir(agentsSkills, { recursive: true });
  console.log("✅ .agents/skills 확인");

  console.log("\n🎉 동기화 완료");
}

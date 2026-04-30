import { getProjectRoot, pathExists, getOmkPath, syncAllKimiGlobals } from "../util/fs.js";
import { runShell } from "../util/shell.js";
import { mkdir, symlink } from "fs/promises";
import { join, relative } from "path";
import { style, header, status } from "../util/theme.js";

export async function syncCommand(): Promise<void> {
  const root = getProjectRoot();
  console.log(header("oh-my-kimichan sync"));

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  // + 로컬 디렉토리 생성도 병렬
  const agentsSkills = join(root, ".agents/skills");
  const kimiSkills = join(root, ".kimi/skills");
  await Promise.all([
    syncAllKimiGlobals(),
    mkdir(agentsSkills, { recursive: true }),
    mkdir(kimiSkills, { recursive: true }),
  ]);
  console.log(status.ok("~/.kimi/ 글로벌 동기화 완료 (hooks + MCP + skills)"));
  console.log("");
  console.log(status.ok(".kimi/skills 확인"));
  console.log(status.ok(".agents/skills 확인"));
  console.log("\n" + status.success("동기화 완료"));
}

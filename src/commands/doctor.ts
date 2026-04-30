import { join } from "path";
import { homedir } from "os";
import { runShell, checkCommand, getKimiVersion } from "../util/shell.js";
import { pathExists, getKimiConfigPath, readTextFile, getKimiSkillsDir } from "../util/fs.js";
import { isGitRepo, getCurrentBranch, getGitStatus } from "../util/git.js";
import { style, status, header, separator } from "../util/theme.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
}

export async function doctorCommand(): Promise<void> {
  console.log(header("oh-my-kimichan doctor"));
  const results: CheckResult[] = [];

  // 1. Node version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "warn",
    message: nodeMajor >= 20 ? `${nodeVersion}` : `${nodeVersion} (>=20 권장)`,
  });

  // 2-5. 병렬로 외부 명령어 존재 여부 확인
  const [kimiExists, gitExists, jqExists, tmuxExists] = await Promise.all([
    checkCommand("kimi"),
    checkCommand("git"),
    checkCommand("jq"),
    checkCommand("tmux"),
  ]);

  // 2. Kimi CLI
  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({ name: "Kimi CLI", status: "ok", message: version ?? "설치됨" });
  } else {
    results.push({ name: "Kimi CLI", status: "fail", message: "kimi 명령을 찾을 수 없습니다. npm install -g kimi-cli 또는 공식 설치 필요" });
  }

  // 3. Kimi 실행 확인 (getKimiVersion()으로 이미 --version 호출했으므로 재사용)
  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({
      name: "Kimi CLI",
      status: version ? "ok" : "warn",
      message: version ? "실행 가능" : "kimi 실행 확인 실패",
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
        message: `브랜치: ${branch ?? "?"}, 변경: ${status.changes}개`,
      });
    } else {
      results.push({ name: "Git", status: "warn", message: "Git 저장소가 아닙니다. omk team/merge 기능이 제한됩니다." });
    }
  } else {
    results.push({ name: "Git", status: "fail", message: "git 명령을 찾을 수 없습니다" });
  }

  // 5. jq (hooks depend on it; fail-open without jq = security bypass)
  results.push({
    name: "jq",
    status: jqExists ? "ok" : "fail",
    message: jqExists ? "설치됨 (hooks 보장)" : "미설치 — pre-shell-guard / protect-secrets hooks가 작동하지 않아 보안 게이트가 열립니다. apt/brew install jq 필수",
  });

  // 6. Kimi default config + OMK hooks (병렬 검사)
  const kimiConfigPath = getKimiConfigPath();
  const [kimiConfigExists, omkExists, skillsDir, kimiMcpPath] = await Promise.all([
    pathExists(kimiConfigPath),
    pathExists(".omk"),
    Promise.resolve(getKimiSkillsDir()),
    Promise.resolve(join(process.cwd(), ".kimi", "mcp.json")),
  ]);

  results.push({
    name: "Kimi Config",
    status: kimiConfigExists ? "ok" : "warn",
    message: kimiConfigExists ? "~/.kimi/config.toml 존재" : "~/.kimi/config.toml 없음 — kimi 로그인 필요",
  });

  if (kimiConfigExists) {
    const kimiContent = await readTextFile(kimiConfigPath, "");
    const hasOmkHooks = kimiContent.includes("# >>> omk managed hooks");
    results.push({
      name: "OMK Hooks",
      status: hasOmkHooks ? "ok" : "warn",
      message: hasOmkHooks ? "hooks 동기화됨" : "omk sync 실행 권장",
    });
  }

  // 7. .omk directory
  results.push({
    name: "OMK Scaffold",
    status: omkExists ? "ok" : "warn",
    message: omkExists ? "초기화됨" : "omk init 실행 필요",
  });

  // AGENTS.md
  const agentsMdExists = await pathExists(join(process.cwd(), "AGENTS.md"));
  results.push({
    name: "AGENTS.md",
    status: agentsMdExists ? "ok" : "warn",
    message: agentsMdExists ? "존재" : "AGENTS.md 없음 — omk init 실행 필요",
  });

  // .kimi/AGENTS.md
  const kimiAgentsMdExists = await pathExists(join(process.cwd(), ".kimi", "AGENTS.md"));
  results.push({
    name: ".kimi/AGENTS.md",
    status: kimiAgentsMdExists ? "ok" : "warn",
    message: kimiAgentsMdExists ? "존재" : ".kimi/AGENTS.md 없음 — omk init 실행 필요",
  });

  // .omk/agents/root.yaml
  const rootYamlExists = await pathExists(join(process.cwd(), ".omk", "agents", "root.yaml"));
  results.push({
    name: "root.yaml",
    status: rootYamlExists ? "ok" : "warn",
    message: rootYamlExists ? "존재" : ".omk/agents/root.yaml 없음 — omk init 실행 필요",
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
      ? "${KIMI_AGENTS_MD} + ${KIMI_SKILLS} 주입됨"
      : `root.md 누락: ${!rootPromptHasAgentsMd ? "${KIMI_AGENTS_MD} " : ""}${!rootPromptHasSkills ? "${KIMI_SKILLS}" : ""}`,
  });

  // .kimi/skills
  const kimiSkillsDir = join(process.cwd(), ".kimi", "skills");
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
    message: kimiSkillsCount > 0 ? `${kimiSkillsCount}개 skills 존재` : ".kimi/skills 없음 또는 비어 있음",
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
    message: agentsSkillsCount > 0 ? `${agentsSkillsCount}개 skills 존재` : ".agents/skills 없음 또는 비어 있음",
  });

  // .omk/mcp.json
  const omkMcpExists = await pathExists(join(process.cwd(), ".omk", "mcp.json"));
  results.push({
    name: "OMK MCP",
    status: omkMcpExists ? "ok" : "info",
    message: omkMcpExists ? ".omk/mcp.json 존재" : ".omk/mcp.json 없음 — MCP intentionally disabled 가능",
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
    message: hooksExecutable ? "dangerous hooks executable" : ".omk/hooks/*.sh 실행 권한 없음 — chmod +x 필요",
  });

  // 8. .kimi/skills (병렬로 카운트)
  const [skillsExists, kimiMcpExists] = await Promise.all([
    pathExists(skillsDir),
    pathExists(kimiMcpPath),
  ]);
  let skillsCount = 0;
  if (skillsExists) {
    try {
      const entries = await (await import("fs/promises")).readdir(skillsDir, { withFileTypes: true });
      skillsCount = entries.filter((e) => e.isDirectory()).length;
    } catch {
      // ignore
    }
  }
  results.push({
    name: "Kimi Skills",
    status: skillsCount > 0 ? "ok" : "info",
    message: skillsCount > 0 ? `${skillsCount}개 skills 발견 (${skillsDir})` : `${skillsDir} 없음 또는 비어 있음`,
  });

  // 9. .kimi/mcp.json
  results.push({
    name: "Kimi MCP",
    status: kimiMcpExists ? "ok" : "info",
    message: kimiMcpExists ? `.kimi/mcp.json 존재` : `.kimi/mcp.json 없음`,
  });

  // 10-11. Global MCP + Global Skills (병렬)
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
    message: globalMcpCount > 0 ? `${globalMcpCount}개 MCP 동기화됨 (~/.kimi/mcp.json)` : "~/.kimi/mcp.json 없음 — omk sync 실행 권장",
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
    message: globalSkillCount > 0 ? `${globalSkillCount}개 skills 동기화됨 (~/.kimi/skills/)` : "~/.kimi/skills/ 없음",
  });

  // Global ~/.kimi pollution check
  const globalKimiDir = join(homedir(), ".kimi");
  let globalPollution = false;
  if (await pathExists(globalKimiDir)) {
    try {
      const entries = await (await import("fs/promises")).readdir(globalKimiDir, { withFileTypes: true });
      const unexpected = entries.filter((e) => e.isFile() && !e.name.match(/^(config\.toml|mcp\.json)$/)).map((e) => e.name);
      if (unexpected.length > 0) globalPollution = true;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Pollution",
    status: globalPollution ? "warn" : "ok",
    message: globalPollution ? "~/.kimi에 예상外 파일 존재 — omk --global opt-in 확인" : "~/.kimi 정상",
  });

  // 12. Tmux (optional for team mode)
  results.push({
    name: "tmux",
    status: tmuxExists ? "ok" : "info",
    message: tmuxExists ? "설치됨" : "omk team 사용 시 권장 (apt/brew install tmux)",
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
    console.log(`❌ ${fails}개 실패, ${warns}개 경고. 해결 후 다시 실행하세요.`);
    process.exit(1);
  } else if (warns > 0) {
    console.log(`⚠️ ${warns}개 경고. 동작에는 문제 없으나 개선 권장.`);
  } else {
    console.log("✅ 모든 검사 통과!");
  }
}

import { runShell, checkCommand, getKimiVersion } from "../util/shell.js";
import { pathExists } from "../util/fs.js";
import { isGitRepo, getCurrentBranch, getGitStatus } from "../util/git.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
}

export async function doctorCommand(): Promise<void> {
  console.log("🔍 oh-my-kimichan doctor\n");
  const results: CheckResult[] = [];

  // 1. Node version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "warn",
    message: nodeMajor >= 20 ? `${nodeVersion}` : `${nodeVersion} (>=20 권장)`,
  });

  // 2. Kimi CLI
  const kimiExists = await checkCommand("kimi");
  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({ name: "Kimi CLI", status: "ok", message: version ?? "설치됨" });
  } else {
    results.push({ name: "Kimi CLI", status: "fail", message: "kimi 명령을 찾을 수 없습니다. npm install -g kimi-cli 또는 공식 설치 필요" });
  }

  // 3. Kimi version check (auth status may not exist; use --version info as proxy)
  if (kimiExists) {
    const infoResult = await runShell("kimi", ["--version"], { timeout: 10000 });
    results.push({
      name: "Kimi CLI",
      status: infoResult.failed ? "warn" : "ok",
      message: infoResult.failed ? "kimi 실행 확인 실패" : "실행 가능",
    });
  }

  // 4. Git
  const gitExists = await checkCommand("git");
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
  const jqExists = await checkCommand("jq");
  results.push({
    name: "jq",
    status: jqExists ? "ok" : "warn",
    message: jqExists ? "설치됨 (hooks 보장)" : "미설치 — hooks가 fail-open 될 수 있습니다. apt/brew install jq 권장",
  });

  // 6. .omk directory
  const omkExists = await pathExists(".omk");
  results.push({
    name: "OMK Scaffold",
    status: omkExists ? "ok" : "warn",
    message: omkExists ? "초기화됨" : "omk init 실행 필요",
  });

  // 7. Tmux (optional for team mode)
  const tmuxExists = await checkCommand("tmux");
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

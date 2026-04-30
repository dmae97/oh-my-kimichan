import { runShell, checkCommand } from "../util/shell.js";
import { getProjectRoot } from "../util/fs.js";
import { style, header, status, bullet, label } from "../util/theme.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

export async function teamCommand(options: { workers?: string } = {}): Promise<void> {
  const root = getProjectRoot();
  const resources = await getOmkResourceSettings();
  const workerCount = normalizeWorkerCount(options.workers, resources.maxWorkers);

  const tmuxExists = await checkCommand("tmux");
  if (!tmuxExists) {
    console.error(status.error("tmux가 설치되어 있지 않습니다."));
    console.error(style.gray("   apt install tmux  또는  brew install tmux"));
    process.exit(1);
  }

  const session = "omk-team";

  // Check if session already exists
  const lsResult = await runShell("tmux", ["ls"], { timeout: 5000 });
  const sessionExists = !lsResult.failed && lsResult.stdout.includes(session);

  if (sessionExists) {
    console.log(style.purpleBold(`🔌 기존 tmux 세션 '${session}'에 연결합니다.`));
    console.log(style.gray("   (종료하려면 세션 내에서 Ctrl+b, d 입력)"));
    await runShell("tmux", ["attach", "-t", session], { timeout: 0, stdio: "inherit" });
    return;
  }

  console.log(header("tmux 팀 세션 생성"));
  console.log(label("Resource profile", `${resources.profile} (${resources.reason})`));
  console.log(label("Worker windows", String(workerCount)) + "\n");

  // Create new session with a main window
  const createResult = await runShell("tmux", ["new-session", "-d", "-s", session, "-n", "coordinator"], {
    cwd: root,
    timeout: 10000,
  });
  if (createResult.failed) {
    console.error(status.error("tmux 세션 생성 실패:"), createResult.stderr);
    process.exit(1);
  }

  // Create additional windows for workers (순차 — tmux 세션 동시 수정 race condition 방지)
  for (let i = 1; i <= workerCount; i += 1) {
    await runShell("tmux", ["new-window", "-t", `${session}:${i}`, "-n", `worker-${i}`], { timeout: 5000 });
  }
  await runShell("tmux", ["new-window", "-t", `${session}:${workerCount + 1}`, "-n", "reviewer"], { timeout: 5000 });

  // Split coordinator window vertically
  await runShell("tmux", ["split-window", "-h", "-t", `${session}:coordinator`], { timeout: 5000 });

  console.log(status.ok("팀 세션 준비 완료."));
  console.log(bullet("coordinator: 메인 계획/조율", "purple"));
  console.log(bullet(workerCount === 1 ? "worker-1:     작업 실행" : `worker-1..${workerCount}: 병렬 작업 실행`, "mint"));
  console.log(bullet("reviewer:    코드 리뷰/검증", "pink"));
  console.log("");
  console.log(style.pinkBold("💡 tmux 단축키:"));
  console.log(style.gray(`   Ctrl+b, 0~${workerCount + 1}  — 창 전환`));
  console.log(style.gray("   Ctrl+b, d    — 세션 분리 (백그라운드 유지)"));
  console.log(style.gray("   omk team     — 세션 재연결"));
  console.log("");
  console.log(style.purple("   연결 중..."));

  await runShell("tmux", ["attach", "-t", session], { timeout: 0, stdio: "inherit" });
}

function normalizeWorkerCount(value: string | undefined, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 6);
}

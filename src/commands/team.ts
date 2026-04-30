import { runShell, checkCommand } from "../util/shell.js";
import { getProjectRoot } from "../util/fs.js";
import { style, header, status, bullet } from "../util/theme.js";

export async function teamCommand(): Promise<void> {
  const root = getProjectRoot();

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
    await runShell("tmux", ["attach", "-t", session], { timeout: 0 });
    return;
  }

  console.log(header("tmux 팀 세션 생성"));

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
  await runShell("tmux", ["new-window", "-t", `${session}:1`, "-n", "worker-1"], { timeout: 5000 });
  await runShell("tmux", ["new-window", "-t", `${session}:2`, "-n", "worker-2"], { timeout: 5000 });
  await runShell("tmux", ["new-window", "-t", `${session}:3`, "-n", "reviewer"], { timeout: 5000 });

  // Split coordinator window vertically
  await runShell("tmux", ["split-window", "-h", "-t", `${session}:coordinator`], { timeout: 5000 });

  console.log(status.ok("팀 세션 준비 완료."));
  console.log(bullet("coordinator: 메인 계획/조율", "purple"));
  console.log(bullet("worker-1/2:  병렬 작업 실행", "mint"));
  console.log(bullet("reviewer:    코드 리뷰/검증", "pink"));
  console.log("");
  console.log(style.pinkBold("💡 tmux 단축키:"));
  console.log(style.gray("   Ctrl+b, 0~3  — 창 전환"));
  console.log(style.gray("   Ctrl+b, d    — 세션 분리 (백그라운드 유지)"));
  console.log(style.gray("   omk team     — 세션 재연결"));
  console.log("");
  console.log(style.purple("   연결 중..."));

  await runShell("tmux", ["attach", "-t", session], { timeout: 0 });
}

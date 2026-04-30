import pty from "node-pty";
import { BannerReplacer } from "./kimi-banner.js";
import { KimiBugFilter } from "./kimi-bug-filter.js";
import { kimichanBanner, kimichanMetaBox } from "./theme.js";
import { getOmkLogoImagePath, pathExists } from "./fs.js";
import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { runShell } from "./shell.js";
import { getOmkResourceSettings } from "./resource-profile.js";
import { KimiStatusLineEnhancer } from "./kimi-statusline.js";

export async function runKimiInteractive(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    onMeta?: (meta: { directory?: string; session?: string; model?: string }) => void;
  }
): Promise<void> {
  const resources = await getOmkResourceSettings();

  // ── 커스텀 로고 이미지 pre-render ──
  const logoPath = await getOmkLogoImagePath();
  let preRenderedLogo: string | null = null;
  if (resources.renderLogo && process.stdout.isTTY && logoPath && (await pathExists(logoPath))) {
    try {
      const terminalImage = await import("terminal-image").then((m) => m.default);
      preRenderedLogo = await withTimeout(
        terminalImage.file(logoPath, {
          width: 60,
          preserveAspectRatio: true,
        }),
        2000,
      );
    } catch (err) {
      // 이미지 렌더링 실패 시 기본 ASCII art 로 폰백
      if (process.env.OMK_DEBUG === "1") {
        console.warn("⚠️  logo_image 렌더링 실패:", (err as Error).message);
      } else {
        console.warn("⚠️  logo_image 렌더링 실패: 내장 Kimichan ASCII로 대체합니다.");
      }
    }
  }

  const replacer = new BannerReplacer((meta) => {
    if (preRenderedLogo) {
      console.log(preRenderedLogo);
      const metaBox = kimichanMetaBox(meta);
      if (metaBox) console.log(metaBox);
    } else {
      console.log(kimichanBanner(meta));
    }
    options?.onMeta?.(meta);
  });
  const bugFilter = new KimiBugFilter();
  const statusLine = await KimiStatusLineEnhancer.create();

  const env = options?.env
    ? { ...(process.env as Record<string, string>), OMK_RESOURCE_PROFILE_EFFECTIVE: resources.profile, ...options.env }
    : { ...(process.env as Record<string, string>), OMK_RESOURCE_PROFILE_EFFECTIVE: resources.profile };

  const ptyProcess = pty.spawn("kimi", args, {
    name: "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: options?.cwd ?? process.cwd(),
    env,
  });

  // stdout → 터미널 (버그 필터 → 배너 필터링 적용)
  ptyProcess.onData((data) => {
    const bugResult = bugFilter.process(data);
    if (bugResult.sendEnter) {
      ptyProcess.write("\n");
    }
    if (bugResult.output === null) {
      return;
    }
    const output = replacer.process(bugResult.output);
    if (output !== null) {
      process.stdout.write(statusLine.process(output));
    }
  });

  // stdin → pty
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (data: Buffer) => {
    ptyProcess.write(data.toString());
  });

  // 터미널 리사이즈 → pty 동기화
  process.stdout.on("resize", () => {
    ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  });

  // 종료 대기
  return new Promise<void>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      const bugRest = bugFilter.forceFlush();
      if (bugRest) process.stdout.write(statusLine.process(bugRest));
      const replacerRest = replacer.forceFlush();
      if (replacerRest) process.stdout.write(statusLine.process(replacerRest));
      statusLine.dispose();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.exit(exitCode);
    });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("logo render timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface KimiTaskRunnerOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export function createKimiTaskRunner(options: KimiTaskRunnerOptions = {}): TaskRunner {
  const { cwd, timeout = 120000, env } = options;

  return {
    async run(node: DagNode, nodeEnv: Record<string, string>): Promise<TaskResult> {
      const args = ["agent", "--message", `Execute node ${node.id} (${node.name}) as role ${node.role}`];

      const mergedEnv = { ...env, ...nodeEnv };

      const result = await runShell("kimi", args, {
        cwd: node.worktree ?? cwd,
        timeout,
        env: mergedEnv,
      });

      return {
        success: !result.failed && result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}

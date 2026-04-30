import pty from "node-pty";
import { BannerReplacer } from "./kimi-banner.js";
import { KimiBugFilter } from "./kimi-bug-filter.js";
import { kimichanBanner, kimichanMetaBox } from "./theme.js";
import { getOmkLogoImagePath, pathExists } from "./fs.js";

export async function runKimiInteractive(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    onMeta?: (meta: { directory?: string; session?: string; model?: string }) => void;
  }
): Promise<void> {
  // ── 커스텀 로고 이미지 pre-render ──
  const logoPath = await getOmkLogoImagePath();
  let preRenderedLogo: string | null = null;
  if (logoPath && (await pathExists(logoPath))) {
    try {
      const terminalImage = await import("terminal-image").then((m) => m.default);
      preRenderedLogo = await terminalImage.file(logoPath, {
        width: 60,
        preserveAspectRatio: true,
      });
    } catch (err) {
      // 이미지 렌더링 실패 시 기본 ASCII art 로 폰백
      console.warn("⚠️  logo_image 렌더링 실패:", (err as Error).message);
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

  const env = options?.env
    ? { ...(process.env as Record<string, string>), ...options.env }
    : (process.env as Record<string, string>);

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
      process.stdout.write(output);
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
      if (bugRest) process.stdout.write(bugRest);
      const replacerRest = replacer.forceFlush();
      if (replacerRest) process.stdout.write(replacerRest);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.exit(exitCode);
    });
  });
}

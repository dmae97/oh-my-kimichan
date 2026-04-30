/**
 * Kimi CLI 배너 필터 — 기본 웰컴 배너를 키미짱 커스텀 배너로 교체
 *
 * node-pty 스트림에서 Kimi CLI의 기본 배너 블록을 감지하고,
 * Directory / Session / Model 메타 정보를 추출한 뒤
 * omk 테마의 커스텀 배너로 대체 출력합니다.
 */

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export interface BannerMeta {
  directory?: string;
  session?: string;
  model?: string;
}

type ReplacerState = "buffering" | "passthrough" | "replaced";

export class BannerReplacer {
  private state: ReplacerState = "buffering";
  private chunks: string[] = [];
  private strippedCache = "";
  private cacheDirty = true;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly WELCOME = "Welcome to Kimi Code CLI!";
  private readonly MAX_LINES = 20;
  private readonly TIMEOUT_MS = 300;
  private readonly MAX_BYTES = 4096;

  constructor(private onReplace: (meta: BannerMeta) => void) {}

  private get buffer(): string {
    return this.chunks.join("");
  }

  private getStripped(): string {
    if (this.cacheDirty) {
      this.strippedCache = stripAnsi(this.buffer);
      this.cacheDirty = false;
    }
    return this.strippedCache;
  }

  /** 데이터 청크를 받아 배너 교체 또는 그대로 통과시킴 */
  process(data: string): string | null {
    if (this.state !== "buffering") {
      return data;
    }

    if (this.timeout === null) {
      this.startTimeout();
    }

    // Passthrough terminal setup sequences immediately
    const setupMatch = data.match(/^(\x1b\[(?:2J|H|f|\?1049[hl]))/);
    if (setupMatch) {
      process.stdout.write(setupMatch[1]);
      data = data.slice(setupMatch[1].length);
      if (data.length === 0) return null;
    }

    this.chunks.push(data);
    this.cacheDirty = true;

    const buf = this.buffer;

    if (buf.length > this.MAX_BYTES) {
      return this.flushPassthrough();
    }

    const lineCount = this.countLines(buf);
    if (lineCount > this.MAX_LINES) {
      return this.flushPassthrough();
    }

    const clean = this.getStripped();
    if (this.isBannerComplete(clean)) {
      return this.flushReplace();
    }

    return null;
  }

  /** 타임아웃 등으로 인한 강제 플러시 */
  forceFlush(): string | null {
    this.clearTimeout();
    if (this.state === "buffering") {
      return this.flushPassthrough();
    }
    return null;
  }

  private startTimeout(): void {
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      if (this.state === "buffering") {
        const rest = this.flushPassthrough();
        if (rest !== null) {
          process.stdout.write(rest);
        }
      }
    }, this.TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private countLines(buf: string): number {
    if (buf.length === 0) return 0;
    return buf.split(/\r?\n/).length;
  }

  /** 버퍼에 배너 상단(╭)과 하단(╰)이 모두 존재하면 배너 완료로 판단 */
  private isBannerComplete(clean: string): boolean {
    if (!clean.includes(this.WELCOME)) {
      return false;
    }

    const lines = clean.split(/\r?\n/);
    let sawTop = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!sawTop && (trimmed.startsWith("╭") || trimmed.includes("╭─"))) {
        sawTop = true;
        continue;
      }
      if (sawTop && (trimmed.startsWith("╰") || trimmed.includes("╰─"))) {
        if (!trimmed.includes("╭")) {
          return true;
        }
      }
    }

    // Fallback: WELCOME present and contains meta lines
    return this.hasMetaLines(clean);
  }

  private hasMetaLines(clean: string): boolean {
    return /Directory:|Session:|Model:/.test(clean);
  }

  private flushReplace(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "replaced";
    this.clearTimeout();

    const meta = this.extractMeta(this.buffer);
    this.onReplace(meta);

    const after = this.extractAfterBanner(this.buffer);
    this.chunks = [];
    this.cacheDirty = true;
    return after;
  }

  private flushPassthrough(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "passthrough";
    this.clearTimeout();

    const result = this.buffer;
    this.chunks = [];
    this.cacheDirty = true;
    return result.length > 0 ? result : null;
  }

  private extractMeta(_buf: string): BannerMeta {
    const meta: BannerMeta = {};
    const clean = this.getStripped();
    for (const line of clean.split(/\r?\n/)) {
      const stripped = line.replace(/[│║┃╔╗╚╝╭╮╰╯─═]/g, "").trim();
      const dirMatch = stripped.match(/Directory:\s*(.+)/);
      if (dirMatch) meta.directory = dirMatch[1].trim();
      const sesMatch = stripped.match(/Session:\s*(.+)/);
      if (sesMatch) meta.session = sesMatch[1].trim();
      const modelMatch = stripped.match(/Model:\s*(.+)/);
      if (modelMatch) meta.model = modelMatch[1].trim();
    }
    return meta;
  }

  /** 배너 하단(╰─) 이후의 데이터만 추출 */
  private extractAfterBanner(buf: string): string | null {
    const origLines = buf.split(/\r?\n/);
    const cleanLines = this.getStripped().split(/\r?\n/);
    let endIdx = -1;

    for (let i = 0; i < cleanLines.length; i++) {
      const trimmed = cleanLines[i].trim();
      if (trimmed.startsWith("╰") || trimmed.includes("╰─")) {
        if (!trimmed.includes("╭")) {
          endIdx = i;
          break;
        }
      }
    }

    // Fallback: use last meta line as banner end
    if (endIdx === -1) {
      for (let i = 0; i < cleanLines.length; i++) {
        const trimmed = cleanLines[i].trim();
        if (/Directory:|Session:|Model:/.test(trimmed)) {
          endIdx = i;
        }
      }
    }

    if (endIdx === -1) return null;

    const after = origLines.slice(endIdx + 1);
    const result = after.join("\n");
    return result.length > 0 ? result : null;
  }
}

/**
 * Kimi CLI 배너 필터 — 기본 웰컴 배너를 키미짱 커스텀 배너로 교체
 *
 * node-pty 스트림에서 Kimi CLI의 기본 배너 블록을 감지하고,
 * Directory / Session / Model 메타 정보를 추출한 뒤
 * omk 테마의 커스텀 배너로 대체 출력합니다.
 */

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
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
  private readonly MAX_LINES = 200; // high: spinner sequences + erase-in-line inflate raw line count
  private readonly TIMEOUT_MS = 8000;
  private readonly MAX_BYTES = 32768;

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
    if (this.state === "replaced") {
      const stripped = this.stripKimiBanner(data);
      return stripped.length > 0 ? stripped : null;
    }
    if (this.state === "passthrough") {
      return data;
    }

    data = this.passthroughTerminalSetupPrefix(data);
    if (data.length === 0) return null;

    if (this.timeout === null) {
      this.startTimeout();
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

    if (!this.shouldContinueBuffering(clean)) {
      return this.flushPassthrough();
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

  private passthroughTerminalSetupPrefix(data: string): string {
    let rest = data;

    while (rest.length > 0) {
      const setupMatch = rest.match(/^(\x1b\[(?:\?1049[hl]|\?25[hl]|[0-9;]*[Hf]|[0-9;]*[JK]|2K))/);
      const resetMatch = rest.match(/^(\x1bc)/);
      const charsetMatch = rest.match(/^(\x1b\([A-Za-z0-9])/);
      const match = setupMatch ?? resetMatch ?? charsetMatch;
      if (!match) break;
      process.stdout.write(match[1]);
      rest = rest.slice(match[1].length);
    }

    return rest;
  }

  private shouldContinueBuffering(clean: string): boolean {
    const trimmed = clean.trim();
    if (trimmed.length === 0) return true;
    if (this.hasWelcomeLine(clean) || this.hasMetaLines(clean)) return true;

    if (this.hasCompleteBox(clean)) return false;

    // Prompt-like lines should pass through immediately (not buffered).
    if (/^kimi❯/.test(trimmed)) return false;

    // Keep buffering even for non-frame text (e.g. Python deprecation
    // warnings emitted before the banner). Rely on timeout/byte/line
    // limits to avoid hanging indefinitely.
    return true;
  }

  /** 버퍼에 Kimi CLI 배너 시그널과 배너 상단(╭)/하단(╰)이 모두 존재하면 완료로 판단 */
  private isBannerComplete(clean: string): boolean {
    const hasWelcome = this.hasWelcomeLine(clean);
    const hasMeta = this.hasMetaLines(clean);
    if (!hasWelcome && !hasMeta) {
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

    // Require the bottom border (╰) to confirm the banner block is complete.
    // This prevents premature flush before Session/Model lines and the bottom border arrive.
    return false;
  }

  private hasWelcomeLine(clean: string): boolean {
    return /Welcome\s+to\s+Kimi(?:\s+Code)?\s+CLI!?/i.test(clean)
      || /\bKimi(?:\s+Code)?\s+CLI\b/i.test(clean);
  }

  private hasMetaLines(clean: string): boolean {
    return /Directory:|Session:|Model:/.test(clean);
  }

  private hasCompleteBox(clean: string): boolean {
    const lines = clean.split(/\r?\n/);
    let sawTop = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!sawTop && (trimmed.startsWith("╭") || trimmed.startsWith("╔") || trimmed.startsWith("┌"))) {
        sawTop = true;
        continue;
      }
      if (sawTop && (trimmed.startsWith("╰") || trimmed.startsWith("╚") || trimmed.startsWith("└"))) {
        return true;
      }
    }
    return false;
  }

  private flushReplace(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "replaced";
    this.clearTimeout();

    const meta = this.extractMeta(this.buffer);
    this.onReplace(meta);

    let after = this.extractAfterBanner(this.buffer);
    if (after === null) {
      after = this.stripKimiBanner(this.buffer);
    } else {
      // Also strip any trailing banner fragments that may have been buffered
      after = this.stripKimiBanner(after);
    }
    this.chunks = [];
    this.cacheDirty = true;
    return after.length > 0 ? after : null;
  }

  private flushPassthrough(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "passthrough";
    this.clearTimeout();

    let result = this.stripKimiBanner(this.buffer);
    result = this.stripKimiBanner(result);
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

    if (endIdx === -1) return null;

    const after = origLines.slice(endIdx + 1);
    const result = after.join("\n");
    return result.length > 0 ? result : null;
  }

  /**
   * Fallback banner stripper: removes the Kimi CLI default banner block
   * (╭...╰) when the precise extractAfterBanner fails or we timeout.
   */
  private stripKimiBanner(buf: string): string {
    const lines = buf.split(/\r?\n/);
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const stripped = stripAnsi(lines[i]).trim();
      if (startIdx === -1 && (stripped.startsWith("╭") || stripped.includes("╭─"))) {
        startIdx = i;
      }
      if (startIdx !== -1 && (stripped.startsWith("╰") || stripped.includes("╰─"))) {
        if (!stripped.includes("╭")) {
          endIdx = i;
          break;
        }
      }
    }

    if (startIdx !== -1 && endIdx !== -1 && this.looksLikeKimiBanner(lines, startIdx, endIdx)) {
      return lines.slice(0, startIdx).concat(lines.slice(endIdx + 1)).join("\n");
    }

    return buf;
  }

  private looksLikeKimiBanner(lines: string[], start: number, end: number): boolean {
    const block = lines.slice(start, end + 1).join("\n");
    const clean = stripAnsi(block);
    return /Welcome\s+to\s+Kimi/i.test(clean)
      || /\bKimi\s+Code\s+CLI\b/i.test(clean)
      || (/Directory:/.test(clean) && /Session:/.test(clean));
  }
}

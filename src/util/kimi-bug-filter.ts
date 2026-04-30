function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Map a position in stripped text back to the corresponding position in the original text. */
function strippedToOriginal(original: string, strippedIndex: number): number {
  let origIdx = 0;
  let stripIdx = 0;
  const ansiRegex = /\x1b\[[0-9;]*[A-Za-z]/g;

  while (stripIdx < strippedIndex && origIdx < original.length) {
    ansiRegex.lastIndex = origIdx;
    const match = ansiRegex.exec(original);
    if (match && match.index === origIdx) {
      origIdx += match[0].length;
    } else {
      origIdx++;
      stripIdx++;
    }
  }
  return origIdx;
}

const START_MARKER = "Unhandled exception in event loop:";
const END_MARKER = "Press ENTER to continue...";

export class KimiBugFilter {
  private state: "idle" | "in_bug" = "idle";
  private buffer = "";
  // No longer needed with immediate-flush idle strategy
  // private readonly IDLE_LIMIT = 256;
  private readonly BUG_LIMIT = 1024;

  process(chunk: string): { output: string | null; sendEnter: boolean } {
    if (this.state === "idle") {
      return this.processIdle(chunk);
    }
    this.buffer += chunk;
    return this.processInBug();
  }

  private processIdle(chunk: string): { output: string | null; sendEnter: boolean } {
    this.buffer += chunk;
    const stripped = stripAnsi(this.buffer);

    if (stripped.includes(START_MARKER)) {
      const startIdx = stripped.indexOf(START_MARKER);
      const origStart = strippedToOriginal(this.buffer, startIdx);
      const beforeBug = this.buffer.slice(0, origStart);
      this.buffer = this.buffer.slice(origStart);
      this.state = "in_bug";
      const result = this.processInBug();
      const before = beforeBug.length > 0 ? beforeBug : "";
      const after = result.output ?? "";
      const combined = before + after;
      return {
        output: combined.length > 0 ? combined : null,
        sendEnter: result.sendEnter,
      };
    }

    // No bug start found — flush everything except a small tail to handle
    // chunk splits (e.g. "Unhandled exception in" at end of chunk 1,
    // "event loop:" at start of chunk 2).
    const keep = START_MARKER.length;
    if (this.buffer.length > keep) {
      const flushed = this.buffer.slice(0, -keep);
      this.buffer = this.buffer.slice(-keep);
      return { output: flushed.length > 0 ? flushed : null, sendEnter: false };
    }

    return { output: null, sendEnter: false };
  }

  /** Flush any remaining buffered data. Called on PTY exit. */
  forceFlush(): string | null {
    if (this.state === "idle") {
      const flushed = this.buffer;
      this.buffer = "";
      return flushed.length > 0 ? flushed : null;
    }
    // Try to finish any in-progress bug extraction
    const result = this.processInBug();
    if (result.output !== null) {
      return result.output;
    }
    const flushed = this.buffer;
    this.buffer = "";
    this.state = "idle";
    return flushed.length > 0 ? flushed : null;
  }

  private processInBug(): { output: string | null; sendEnter: boolean } {
    const stripped = stripAnsi(this.buffer);

    if (!stripped.includes(END_MARKER)) {
      if (this.buffer.length > this.BUG_LIMIT) {
        const flushed = this.buffer;
        this.buffer = "";
        this.state = "idle";
        return { output: flushed.length > 0 ? flushed : null, sendEnter: false };
      }
      return { output: null, sendEnter: false };
    }

    const regex =
      /Unhandled exception in event loop:\s*(?:\n\s*)*Exception None\s*(?:\n\s*)*Press ENTER to continue\.\.\.\s*\n?/g;
    let match: RegExpExecArray | null;
    let lastEndOrig = 0;
    let sendEnter = false;
    const parts: string[] = [];

    while ((match = regex.exec(stripped)) !== null) {
      const origStart = strippedToOriginal(this.buffer, match.index);
      const origEnd = strippedToOriginal(
        this.buffer,
        match.index + match[0].length
      );
      parts.push(this.buffer.slice(lastEndOrig, origStart));
      lastEndOrig = origEnd;
      sendEnter = true;
    }

    parts.push(this.buffer.slice(lastEndOrig));
    const remaining = parts.join("");

    const remainingStripped = stripAnsi(remaining);
    if (remainingStripped.includes(START_MARKER)) {
      this.buffer = remaining;
      this.state = "in_bug";
      return { output: null, sendEnter };
    }

    this.buffer = remaining;
    this.state = "idle";
    return { output: remaining.length > 0 ? remaining : null, sendEnter };
  }
}

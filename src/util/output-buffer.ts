export class CappedOutputBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private omittedBytes = 0;
  private truncated = false;

  constructor(
    private readonly maxBytes: number,
    private readonly label = "output"
  ) {}

  append(value: unknown): void {
    const text = String(value ?? "");
    if (!text) return;

    const input = Buffer.from(text, "utf8");
    if (this.maxBytes <= 0) {
      this.truncated = true;
      this.omittedBytes += input.byteLength;
      return;
    }

    const remaining = this.maxBytes - this.bytes;
    if (remaining <= 0) {
      this.truncated = true;
      this.omittedBytes += input.byteLength;
      return;
    }

    if (input.byteLength <= remaining) {
      this.chunks.push(text);
      this.bytes += input.byteLength;
      return;
    }

    this.chunks.push(input.subarray(0, remaining).toString("utf8"));
    this.bytes = this.maxBytes;
    this.omittedBytes += input.byteLength - remaining;
    this.truncated = true;
  }

  toString(): string {
    const output = this.chunks.join("");
    if (!this.truncated) return output;
    const marker = `\n[omk: ${this.label} truncated at ${formatBytes(this.maxBytes)}; omitted at least ${formatBytes(this.omittedBytes)}]\n`;
    return `${output}${marker}`;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(1)} GiB`;
}

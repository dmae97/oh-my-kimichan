import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve, relative, isAbsolute } from "path";

export class MemoryStore {
  constructor(private basePath: string) {}

  private safePath(inputPath: string): string {
    if (isAbsolute(inputPath)) {
      throw new Error(`MemoryStore: absolute paths are not allowed: ${inputPath}`);
    }
    const full = resolve(join(this.basePath, inputPath));
    const rel = relative(this.basePath, full);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`MemoryStore: path traversal detected: ${inputPath}`);
    }
    return full;
  }

  async read(path: string): Promise<string> {
    try {
      return await readFile(this.safePath(path), "utf-8");
    } catch {
      return "";
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.safePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing + "\n" + content);
  }
}

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve, relative, isAbsolute } from "path";
import { getProjectRoot } from "../util/fs.js";

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

  async readRunMemory(runId: string, path: string): Promise<string> {
    if (runId.includes("..") || runId.startsWith("/") || runId.startsWith("\\")) {
      throw new Error(`MemoryStore: invalid runId: ${runId}`);
    }
    const root = getProjectRoot();
    const runBase = join(root, ".omk", "runs", runId, "memory");
    const full = resolve(join(runBase, path));
    const rel = relative(runBase, full);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`MemoryStore: path traversal detected: ${path}`);
    }
    try {
      return await readFile(full, "utf-8");
    } catch {
      return "";
    }
  }

  async writeRunMemory(runId: string, path: string, content: string): Promise<void> {
    if (runId.includes("..") || runId.startsWith("/") || runId.startsWith("\\")) {
      throw new Error(`MemoryStore: invalid runId: ${runId}`);
    }
    const root = getProjectRoot();
    const runBase = join(root, ".omk", "runs", runId, "memory");
    const full = resolve(join(runBase, path));
    const rel = relative(runBase, full);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`MemoryStore: path traversal detected: ${path}`);
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
}

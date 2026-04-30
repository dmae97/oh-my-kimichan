import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

export class MemoryStore {
  constructor(private basePath: string) {}

  async read(path: string): Promise<string> {
    try {
      return await readFile(join(this.basePath, path), "utf-8");
    } catch {
      return "";
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = join(this.basePath, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing + "\n" + content);
  }
}

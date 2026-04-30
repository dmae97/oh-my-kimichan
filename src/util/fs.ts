import { mkdir, writeFile, readFile, access, constants, readdir } from "fs/promises";
import { dirname, join } from "path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeFileSafe(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf-8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(path: string, defaultValue = ""): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return defaultValue;
  }
}

export function getProjectRoot(): string {
  return process.cwd();
}

export function getOmkPath(subPath?: string): string {
  const root = getProjectRoot();
  return subPath ? join(root, ".omk", subPath) : join(root, ".omk");
}

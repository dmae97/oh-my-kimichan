import { mkdir, readdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { getProjectRoot, pathExists, readTextFile } from "./fs.js";

const SNIPPETS_DIR = ".omk/snippets";

export interface Snippet {
  name: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function getSnippetsPath(): string {
  return join(getProjectRoot(), SNIPPETS_DIR);
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 128);
}

function parseSnippetFile(content: string, name: string): Snippet {
  const lines = content.split("\n");
  const meta: Record<string, string> = {};
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("<!-- ") && line.endsWith(" -->")) {
      const inner = line.slice(5, -4).trim();
      const eq = inner.indexOf("=");
      if (eq > 0) {
        meta[inner.slice(0, eq).trim()] = inner.slice(eq + 1).trim();
      }
      bodyStart = i + 1;
    } else if (line.trim() === "---") {
      bodyStart = i + 1;
      break;
    } else if (line.trim() !== "" && !line.startsWith("<!--")) {
      break;
    } else {
      bodyStart = i + 1;
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  const now = new Date().toISOString();

  return {
    name,
    content: body,
    tags: meta.tags ? meta.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || now,
  };
}

function serializeSnippet(snippet: Snippet): string {
  const tagsLine = snippet.tags.length > 0 ? `<!-- tags=${snippet.tags.join(",")} -->` : "";
  const createdLine = `<!-- createdAt=${snippet.createdAt} -->`;
  const updatedLine = `<!-- updatedAt=${snippet.updatedAt} -->`;
  return [tagsLine, createdLine, updatedLine, "", snippet.content].filter((l) => l !== undefined).join("\n");
}

export async function saveSnippet(name: string, content: string, tags?: string[]): Promise<{ success: boolean; path: string }> {
  const safeName = sanitizeName(name);
  const dir = getSnippetsPath();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${safeName}.md`);
  const now = new Date().toISOString();
  const snippet: Snippet = {
    name: safeName,
    content,
    tags: tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(filePath, serializeSnippet(snippet), "utf-8");
  return { success: true, path: filePath };
}

export async function getSnippet(name: string): Promise<Snippet | null> {
  const safeName = sanitizeName(name);
  const filePath = join(getSnippetsPath(), `${safeName}.md`);
  if (!(await pathExists(filePath))) return null;
  const content = await readTextFile(filePath, "");
  if (!content.trim()) return null;
  return parseSnippetFile(content, safeName);
}

export async function deleteSnippet(name: string): Promise<{ success: boolean }> {
  const safeName = sanitizeName(name);
  const filePath = join(getSnippetsPath(), `${safeName}.md`);
  if (!(await pathExists(filePath))) return { success: false };
  await rm(filePath);
  return { success: true };
}

export async function searchSnippets(query: string, limit = 20): Promise<Snippet[]> {
  const dir = getSnippetsPath();
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const results: Snippet[] = [];
  const lowerQuery = query.toLowerCase();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    const content = await readTextFile(join(dir, entry.name), "");
    if (!content.trim()) continue;

    const snippet = parseSnippetFile(content, name);
    const text = `${snippet.name} ${snippet.content} ${snippet.tags.join(" ")}`.toLowerCase();
    if (!lowerQuery || text.includes(lowerQuery)) {
      results.push(snippet);
    }
  }

  return results.slice(0, limit);
}

export async function listSnippets(): Promise<Snippet[]> {
  return searchSnippets("", 1000);
}

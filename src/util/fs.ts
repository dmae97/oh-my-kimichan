import {
  mkdir,
  writeFile,
  readFile,
  access,
  constants,
  readdir,
  symlink,
  rm,
  unlink,
  lstat,
  copyFile,
} from "fs/promises";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

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
  // Git 저장소 루트를 우선 찾고, 실패 시 cwd 폴백
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    if (gitRoot) return gitRoot;
  } catch {
    // ignore — git 없거나非저장소
  }
  return process.cwd();
}

export function getOmkPath(subPath?: string): string {
  const root = getProjectRoot();
  return subPath ? join(root, ".omk", subPath) : join(root, ".omk");
}

export function getRunPath(runId: string, subPath?: string): string {
  const runDir = getOmkPath(join("runs", runId));
  return subPath ? join(runDir, subPath) : runDir;
}

export function getKimiConfigPath(): string {
  return join(homedir(), ".kimi", "config.toml");
}

const OMK_START_MARKER = "# >>> omk managed hooks — do not edit manually";
const OMK_END_MARKER = "# >>> end omk managed hooks";

/**
 * .omk/kimi.config.toml 의 hooks 를 ~/.kimi/config.toml 에 병합.
 * 상대 경로를 절대 경로로 변환하여 어디서 실행돼도 작동하도록 함.
 */
export async function mergeKimiHooks(omkConfigPath: string): Promise<boolean> {
  const kimiConfigPath = getKimiConfigPath();
  const omkContent = await readTextFile(omkConfigPath, "");
  if (!omkContent.trim()) return false;

  const root = getProjectRoot();
  const resolvedContent = resolveHookPaths(omkContent, root);

  const hooksContent = extractHooksBlocks(resolvedContent);
  if (!hooksContent) return false;

  let kimiContent = await readTextFile(kimiConfigPath, "");

  // 기존 omk 섹션 제거
  const startIdx = kimiContent.indexOf(OMK_START_MARKER);
  if (startIdx !== -1) {
    const endIdx = kimiContent.indexOf(OMK_END_MARKER, startIdx);
    if (endIdx !== -1) {
      const before = kimiContent.slice(0, startIdx).trimEnd();
      const after = kimiContent.slice(endIdx + OMK_END_MARKER.length).trimStart();
      kimiContent = before + (before && after ? "\n\n" : before ? "\n" : "") + after;
    }
  }

  const omkSection = `${OMK_START_MARKER}\n${hooksContent}\n${OMK_END_MARKER}\n`;

  if (!kimiContent.trim()) {
    kimiContent = omkSection;
  } else {
    kimiContent = kimiContent.trimEnd() + "\n\n" + omkSection;
  }

  await writeFileSafe(kimiConfigPath, kimiContent);
  return true;
}

function resolveHookPaths(content: string, root: string): string {
  return content.replace(
    /command\s*=\s*["'](\.omk\/hooks\/[^"']+)["']/g,
    (_match, p1) => {
      const absPath = join(root, p1).replace(/\\/g, "/");
      return `command = "${absPath}"`;
    }
  );
}

function extractHooksBlocks(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let foundHooks = false;
  for (const line of lines) {
    if (line.trim().startsWith("[[hooks]]")) foundHooks = true;
    if (foundHooks) result.push(line);
  }
  return result.join("\n").trim();
}

/* ──────────────────────────────────────────────
 *  Global sync: .kimi/  →  ~/.kimi/
 * ────────────────────────────────────────────── */

/** 프로젝트의 .omk/mcp.json + .kimi/mcp.json → ~/.kimi/mcp.json 병합 */
export async function syncKimiMcpGlobal(): Promise<boolean> {
  const globalMcpPath = join(homedir(), ".kimi", "mcp.json");
  const projectConfigs = [getOmkPath("mcp.json"), join(getProjectRoot(), ".kimi", "mcp.json")];

  const mergedServers: Record<string, unknown> = {};
  let hasAny = false;

  for (const p of projectConfigs) {
    if (!(await pathExists(p))) continue;
    try {
      const content = await readTextFile(p, "{}");
      const parsed = JSON.parse(content);
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        const root = getProjectRoot();
        for (const [name, server] of Object.entries(parsed.mcpServers)) {
          const s = server as Record<string, unknown>;
          // args의 상대 경로를 MCP 설정 파일 기준 절대 경로로 변환
          if (Array.isArray(s.args)) {
            s.args = s.args.map((arg: string) => {
              if (typeof arg === "string" && !arg.startsWith("/") && !arg.startsWith("http")) {
                // 상대 경로이면서 -/-- 로 시작하지 않는 옵션이 아닌 경우
                if (!arg.startsWith("-")) {
                  return join(root, arg);
                }
              }
              return arg;
            });
          }
          mergedServers[name] = s;
        }
        hasAny = true;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  if (!hasAny) return false;

  // 기존 글로벌 mcp.json 읽기
  let globalParsed: { mcpServers?: Record<string, unknown> } = {};
  if (await pathExists(globalMcpPath)) {
    try {
      const content = await readTextFile(globalMcpPath, "{}");
      globalParsed = JSON.parse(content);
    } catch {
      // ignore
    }
  }

  // 병합: 글로벌 먼저, 프로젝트가 같은 키 덮어씀
  const finalServers = { ...(globalParsed.mcpServers ?? {}), ...mergedServers };

  await writeFileSafe(globalMcpPath, JSON.stringify({ mcpServers: finalServers }, null, 2));
  return true;
}

/** 프로젝트의 .kimi/skills/* → ~/.kimi/skills/ 심링크 */
export async function syncKimiSkillsGlobal(): Promise<boolean> {
  const projectSkillsDir = join(getProjectRoot(), ".kimi", "skills");
  const globalSkillsDir = join(homedir(), ".kimi", "skills");

  if (!(await pathExists(projectSkillsDir))) return false;

  const entries = await readdir(projectSkillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory());
  if (skillDirs.length === 0) return false;

  await ensureDir(globalSkillsDir);

  // 깨진 심링크 정리
  try {
    const globalEntries = await readdir(globalSkillsDir, { withFileTypes: true });
    for (const e of globalEntries) {
      if (!e.isSymbolicLink()) continue;
      const linkPath = join(globalSkillsDir, e.name);
      try {
        await access(linkPath, constants.F_OK);
      } catch {
        await unlink(linkPath);
      }
    }
  } catch {
    // ignore
  }

  for (const dir of skillDirs) {
    const src = resolve(join(projectSkillsDir, dir.name));
    const dest = join(globalSkillsDir, dir.name);

    // 사용자가 직접 설치한 폴더(심링크 아님)는 건드리지 않음
    try {
      const destStat = await lstat(dest);
      if (!destStat.isSymbolicLink()) continue;
      await unlink(dest);
    } catch {
      // dest 없음 → OK
    }

    try {
      await symlink(src, dest, "dir");
    } catch {
      // 심링크 실패 시 복사 fallback — dest 가 실제 사용자 디렉토리가 아닌지 재확인
      try {
        const st = await lstat(dest);
        if (!st.isSymbolicLink()) continue; // 사용자 데이터 보호
        await rm(dest, { recursive: true, force: true });
      } catch {
        // dest 없음 → 복사만 진행
      }
      await copyDir(src, dest);
    }
  }

  return true;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/** hooks + MCP + skills 를 ~/.kimi/ 에 한 번에 동기화 */
export async function syncAllKimiGlobals(): Promise<void> {
  const configFile = getOmkPath("kimi.config.toml");
  if (await pathExists(configFile)) {
    try {
      await mergeKimiHooks(configFile);
    } catch (err) {
      console.warn("⚠️  hooks 동기화 실패:", (err as Error).message);
    }
  }

  try {
    await syncKimiMcpGlobal();
  } catch (err) {
    console.warn("⚠️  MCP 글로벌 동기화 실패:", (err as Error).message);
  }

  try {
    await syncKimiSkillsGlobal();
  } catch (err) {
    console.warn("⚠️  skills 글로벌 동기화 실패:", (err as Error).message);
  }
}

/** .omk/mcp.json + .kimi/mcp.json + ~/.kimi/mcp.json 모두 수집 */
export async function collectMcpConfigs(): Promise<string[]> {
  const configs: string[] = [];
  const omkMcp = getOmkPath("mcp.json");
  const kimiMcp = join(getProjectRoot(), ".kimi", "mcp.json");
  const globalMcp = join(homedir(), ".kimi", "mcp.json");
  if (await pathExists(omkMcp)) configs.push(omkMcp);
  if (await pathExists(kimiMcp)) configs.push(kimiMcp);
  if (await pathExists(globalMcp)) configs.push(globalMcp);
  return configs;
}

/** 프로젝트의 .kimi/skills 디렉토리 경로 */
export function getKimiSkillsDir(): string {
  return join(getProjectRoot(), ".kimi", "skills");
}

/** ~/.kimi/config.toml 에서 default_model 읽기 */
export async function getKimiDefaultModel(): Promise<string | null> {
  const configPath = getKimiConfigPath();
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/^default_model\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** .omk/config.toml 에서 logo_image 경로 읽기 (상대경로는 프로젝트 루트 기준) */
export async function getOmkLogoImagePath(): Promise<string | null> {
  const configPath = getOmkPath("config.toml");
  try {
    const content = await readTextFile(configPath, "");
    const match = content.match(/^\s*logo_image\s*=\s*["']([^"']+)["']/m);
    if (!match) return null;
    const p = match[1].trim();
    // 절대 경로 판정 (Unix /, Windows \, C:\)
    if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) {
      return p;
    }
    return join(getProjectRoot(), p);
  } catch {
    return null;
  }
}

/** Kimi CLI 실행 인자에 model + MCP + Skills 주입 (전역 동기화는 별도) */
export async function injectKimiGlobals(args: string[]): Promise<void> {
  // default_model이 있으면 주입 (agent-file 사용 시 model이 unset 될 수 있음)
  const defaultModel = await getKimiDefaultModel();
  if (defaultModel) {
    args.push("--model", defaultModel);
  }

  for (const mcp of await collectMcpConfigs()) {
    args.push("--mcp-config-file", mcp);
  }

  const globalSkillsDir = join(homedir(), ".kimi", "skills");
  const projectSkillsDir = getKimiSkillsDir();
  if (await pathExists(globalSkillsDir)) args.push("--skills-dir", globalSkillsDir);
  if (await pathExists(projectSkillsDir)) args.push("--skills-dir", projectSkillsDir);
}

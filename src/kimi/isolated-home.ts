import { lstat, mkdtemp, mkdir, symlink, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { pathExists, readTextFile, getProjectRoot, getUserHome } from "../util/fs.js";

export interface IsolatedKimiHomeOptions {
  originalHome?: string;
  projectRoot?: string;
  inheritLocalAuth?: boolean;
  env?: NodeJS.ProcessEnv;
}

const KIMI_INHERITED_DIRS = ["credentials", "skills", "agents", "logs"];

/**
 * Local agent/OMK auth paths that should remain visible when OMK gives Kimi a
 * sanitized temporary HOME. Keep this default intentionally narrow for public
 * installs: broad OS/cloud credentials require explicit trusted-local opt-in.
 */
const DEFAULT_LOCAL_TERMINAL_AUTH_PATHS = [
  ".codex",
  ".opencode",
  ".claude",
  ".gemini",
  ".railway",
  ".config/gh",
  ".config/omk",
  ".config/github-copilot",
  ".config/railway",
] as const;

const TRUSTED_LOCAL_TERMINAL_AUTH_PATHS = [
  ...DEFAULT_LOCAL_TERMINAL_AUTH_PATHS,
  ".ssh",
  ".aws",
  ".azure",
  ".docker",
  ".kube",
  ".gnupg",
  ".config/gcloud",
  ".config/vercel",
  ".config/netlify",
  ".config/heroku",
  ".config/hub",
  ".gitconfig",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  ".yarnrc.yml",
] as const;

/**
 * Create a temporary HOME directory that isolates Kimi's global MCP config
 * while preserving credentials and skills.
 */
export async function prepareIsolatedKimiHome(options: IsolatedKimiHomeOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const originalHome = options.originalHome ?? resolveOriginalHome(env);
  const projectRoot = options.projectRoot ?? getProjectRoot();
  const tmpHome = await mkdtemp(join(tmpdir(), "omk-home-"));
  const originalKimi = join(originalHome, ".kimi");
  const tmpKimi = join(tmpHome, ".kimi");
  await mkdir(tmpKimi, { recursive: true });

  // Symlink directories that Kimi CLI needs (credentials, skills, etc.)
  for (const name of KIMI_INHERITED_DIRS) {
    const src = join(originalKimi, name);
    const dst = join(tmpKimi, name);
    if (await pathExists(src)) {
      if (name === "credentials") {
        try {
          await symlink(src, dst, "dir");
        } catch (err) {
          throw new Error(`[omk] Fatal: failed to symlink ~/.kimi/credentials to isolated HOME: ${(err as Error).message ?? err}`);
        }
      } else {
        await symlink(src, dst, "dir").catch((err) => {
          console.warn(`[omk] Failed to symlink ~/.kimi/${name} to isolated HOME: ${(err as Error).message ?? err}`);
        });
      }
    }
  }

  if (shouldInheritLocalAuth(options.inheritLocalAuth, env)) {
    await inheritLocalTerminalAuth(originalHome, tmpHome, env);
  }

  // Build sanitized mcp.json: copy global servers unless the user explicitly
  // deny-lists them for this isolated-home launch.
  const mcpServers: Record<string, unknown> = {};
  const deniedGlobalMcpServers = getDeniedGlobalMcpServers(env);
  const globalMcpPath = join(originalKimi, "mcp.json");
  if (await pathExists(globalMcpPath)) {
    try {
      const content = await readTextFile(globalMcpPath, "{}");
      const parsed = JSON.parse(content) as {
        mcpServers?: Record<string, unknown>;
      };
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        if (deniedGlobalMcpServers.has(name)) continue;
        mcpServers[name] = cfg;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Merge project-local MCP config
  const projectMcpPath = join(projectRoot, ".kimi", "mcp.json");
  if (await pathExists(projectMcpPath)) {
    try {
      const content = await readTextFile(projectMcpPath, "{}");
      const parsed = JSON.parse(content) as {
        mcpServers?: Record<string, unknown>;
      };
      Object.assign(mcpServers, parsed.mcpServers ?? {});
    } catch {
      /* ignore parse errors */
    }
  }

  await writeFile(
    join(tmpKimi, "mcp.json"),
    JSON.stringify({ mcpServers }, null, 2)
  );

  // Symlink config.toml if present
  const originalConfig = join(originalKimi, "config.toml");
  const tmpConfig = join(tmpKimi, "config.toml");
  if (await pathExists(originalConfig)) {
    await symlink(originalConfig, tmpConfig).catch(() => {});
  }

  return tmpHome;
}

export async function cleanupIsolatedKimiHome(tmpHome: string): Promise<void> {
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
}

export function resolveOriginalHome(env: NodeJS.ProcessEnv = process.env): string {
  return getUserHome(env);
}

async function inheritLocalTerminalAuth(originalHome: string, tmpHome: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (const relativePath of localTerminalAuthPaths(env)) {
    const src = join(originalHome, relativePath);
    const dst = join(tmpHome, relativePath);
    await symlinkIfExists(src, dst, relativePath);
  }
}

function shouldInheritLocalAuth(optionValue: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  if (typeof optionValue === "boolean") return optionValue;
  const value = env.OMK_ISOLATED_HOME_INHERIT_AUTH ?? env.OMK_INHERIT_LOCAL_AUTH;
  return !value || !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function localTerminalAuthPaths(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const explicit = parseListEnv(env.OMK_ISOLATED_HOME_AUTH_PATHS);
  if (explicit.length > 0) return explicit;

  const scope = (env.OMK_ISOLATED_HOME_AUTH_SCOPE ?? env.OMK_INHERIT_LOCAL_AUTH_SCOPE ?? "default").toLowerCase();
  if (["trusted", "broad", "all"].includes(scope)) {
    return TRUSTED_LOCAL_TERMINAL_AUTH_PATHS;
  }
  return DEFAULT_LOCAL_TERMINAL_AUTH_PATHS;
}

function getDeniedGlobalMcpServers(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(parseListEnv(env.OMK_ISOLATED_HOME_MCP_DENYLIST ?? env.OMK_DISABLED_GLOBAL_MCP_SERVERS));
}

function parseListEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function symlinkIfExists(src: string, dst: string, label: string): Promise<void> {
  let type: "dir" | "file";
  try {
    const stat = await lstat(src);
    type = stat.isDirectory() ? "dir" : "file";
  } catch {
    return;
  }

  if (await pathExists(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await symlink(src, dst, type).catch((err) => {
    console.warn(`[omk] Failed to symlink local auth path ${label} to isolated HOME: ${(err as Error).message ?? err}`);
  });
}

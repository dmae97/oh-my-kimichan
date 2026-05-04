import { mkdtemp, mkdir, symlink, rm, writeFile } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { pathExists, readTextFile, getProjectRoot } from "../util/fs.js";

/**
 * Create a temporary HOME directory that isolates Kimi's global MCP config
 * while preserving credentials and skills. This prevents broken stdio MCP
 * servers (e.g. firecrawl) in ~/.kimi/mcp.json from crashing Kimi CLI sessions.
 */
export async function prepareIsolatedKimiHome(): Promise<string> {
  const originalHome = homedir();
  const tmpHome = await mkdtemp(join(tmpdir(), "omk-home-"));
  const originalKimi = join(originalHome, ".kimi");
  const tmpKimi = join(tmpHome, ".kimi");
  await mkdir(tmpKimi, { recursive: true });

  // Symlink directories that Kimi CLI needs (credentials, skills, etc.)
  for (const name of ["credentials", "skills", "agents", "logs"]) {
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
  // Build sanitized mcp.json: copy global servers except known broken ones
  const mcpServers: Record<string, unknown> = {};
  const globalMcpPath = join(originalKimi, "mcp.json");
  if (await pathExists(globalMcpPath)) {
    try {
      const content = await readTextFile(globalMcpPath, "{}");
      const parsed = JSON.parse(content) as {
        mcpServers?: Record<string, unknown>;
      };
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        if (name === "firecrawl") continue;
        mcpServers[name] = cfg;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Merge project-local MCP config
  const projectMcpPath = join(getProjectRoot(), ".kimi", "mcp.json");
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

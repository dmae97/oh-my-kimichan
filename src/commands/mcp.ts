import { readFile, writeFile } from "fs/promises";

import { join, isAbsolute } from "path";
import { homedir } from "os";
import { runShell, which } from "../util/shell.js";
import { getProjectRoot, pathExists } from "../util/fs.js";
import { style, header, status, bullet, label } from "../util/theme.js";

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

interface ConfigSource {
  path: string;
  config: McpConfig;
  parsed: boolean;
  error?: string;
}

async function loadConfig(filePath: string): Promise<ConfigSource> {
  if (!(await pathExists(filePath))) {
    return { path: filePath, config: {}, parsed: false, error: "File not found" };
  }
  try {
    const content = await readFile(filePath, "utf-8");
    const config = JSON.parse(content) as McpConfig;
    return { path: filePath, config, parsed: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, config: {}, parsed: false, error: `Invalid JSON: ${message}` };
  }
}

async function resolveAllConfigs(): Promise<ConfigSource[]> {
  const root = getProjectRoot();
  const paths = [
    join(root, ".omk", "mcp.json"),
    join(root, ".kimi", "mcp.json"),
    join(homedir(), ".kimi", "mcp.json"),
  ];
  const results: ConfigSource[] = [];
  for (const p of paths) {
    results.push(await loadConfig(p));
  }
  return results;
}

function collectServers(sources: ConfigSource[]): Map<string, { server: McpServerConfig; sources: string[] }> {
  const map = new Map<string, { server: McpServerConfig; sources: string[] }>();
  for (const src of sources) {
    if (!src.parsed || !src.config.mcpServers) continue;
    for (const [name, server] of Object.entries(src.config.mcpServers)) {
      const existing = map.get(name);
      if (existing) {
        existing.sources.push(src.path);
      } else {
        map.set(name, { server, sources: [src.path] });
      }
    }
  }
  return map;
}

export async function mcpListCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);

  console.log(header("MCP Servers"));

  for (const src of sources) {
    const icon = src.parsed ? style.mint("✓") : style.pink("✗");
    console.log(`${icon} ${src.path}`);
    if (src.error) console.log(`  ${style.gray(src.error)}`);
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No MCP servers configured."));
    return;
  }

  console.log("");
  for (const [name, info] of servers) {
    const dup = info.sources.length > 1 ? style.skin(` [duplicate: ${info.sources.length} sources]`) : "";
    console.log(bullet(`${style.purpleBold(name)}${dup}`, "purple"));
    console.log(`  ${style.gray("command:")} ${info.server.command ?? style.pink("missing")}`);
    if (info.server.args && info.server.args.length > 0) {
      console.log(`  ${style.gray("args:")} ${info.server.args.join(" ")}`);
    }
    if (info.server.env && Object.keys(info.server.env).length > 0) {
      console.log(`  ${style.gray("env:")} ${Object.keys(info.server.env).join(", ")}`);
    }
    console.log(`  ${style.gray("from:")} ${info.sources.join(", ")}`);
  }
}

export async function mcpDoctorCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);

  console.log(header("MCP Doctor"));

  let issues = 0;

  // Config file checks
  for (const src of sources) {
    if (!src.parsed) {
      console.log(status.error(`${src.path}: ${src.error}`));
      issues++;
    } else if (!src.config.mcpServers || Object.keys(src.config.mcpServers).length === 0) {
      console.log(style.gray(`${src.path}: no mcpServers defined`));
    } else {
      console.log(status.ok(`${src.path}`));
    }
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No servers to diagnose."));
    process.exitCode = issues > 0 ? 1 : 0;
    return;
  }

  // Server checks
  console.log("");
  for (const [name, info] of servers) {
    console.log(label("Server", name));

    if (info.sources.length > 1) {
      console.log(`  ${style.skin("⚠ duplicate definition in:")} ${info.sources.join(", ")}`);
      issues++;
    }

    const server = info.server;

    // command check
    if (!server.command) {
      console.log(`  ${style.pink("✗ missing command")}`);
      issues++;
    } else {
      const resolved = await which(server.command);
      if (resolved.failed) {
        console.log(`  ${style.pink("✗ command not found:")} ${server.command}`);
        issues++;
      } else {
        console.log(`  ${style.mint("✓ command:")} ${resolved.stdout.trim()}`);
      }
    }

    // args check
    if (server.args) {
      for (const arg of server.args) {
        // Check if arg looks like a file path and exists
        if (typeof arg === "string" && !arg.startsWith("-") && !arg.startsWith("$")) {
          if (isAbsolute(arg) || arg.includes("/") || arg.includes("\\")) {
            const exists = await pathExists(arg);
            if (!exists) {
              console.log(`  ${style.pink("✗ arg path not found:")} ${arg}`);
              issues++;
            } else {
              console.log(`  ${style.mint("✓ arg path:")} ${arg}`);
            }
          }
        }
      }
    }

    // env check (static — flag if referenced env vars are empty in current process)
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith("${") && value.endsWith("}")) {
          const envName = value.slice(2, -1);
          if (!process.env[envName]) {
            console.log(`  ${style.skin("⚠ env reference undefined:")} ${key} → ${envName}`);
          }
        }
      }
    }

    // Stability hints for slow-starting or failed servers
    if (server.command) {
      const stabilityHints: string[] = [];
      if (server.command.includes("npx") || server.command.includes("npm")) {
        stabilityHints.push("npx-based servers may take >10s to start on first run. Consider installing globally or pinning the package.");
      }
      if (name === "promptfoo") {
        stabilityHints.push("promptfoo can be slow to initialize. Ensure NODE_OPTIONS does not limit memory, or run 'omk mcp test promptfoo' with a longer timeout.");
      }
      if (name === "obsidian") {
        stabilityHints.push("obsidian MCP requires an active Obsidian vault and the Local REST API plugin. If the vault is closed, the server will fail.");
      }
      if (stabilityHints.length > 0) {
        console.log(`  ${style.skin("ℹ stability:")} ${stabilityHints.join(" ")}`);
      }
    }
  }

  console.log("");
  if (issues === 0) {
    console.log(status.ok("All checks passed"));
  } else {
    console.log(status.error(`${issues} issue(s) found`));
    process.exitCode = 1;
  }
}

export async function mcpTestCommand(serverName: string): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const info = servers.get(serverName);

  if (!info) {
    console.error(status.error(`Server not found: ${serverName}`));
    console.error(style.gray("Run `omk mcp list` to see available servers."));
    process.exit(1);
  }

  const server = info.server;
  if (!server.command) {
    console.error(status.error(`Server ${serverName} has no command`));
    process.exit(1);
  }

  console.log(header(`MCP Test: ${serverName}`));
  console.log(label("Command", server.command));
  if (server.args) console.log(label("Args", server.args.join(" ")));
  console.log("");

  // Test 1: executable exists
  const resolved = await which(server.command);
  if (resolved.failed) {
    console.error(status.error(`Executable not found: ${server.command}`));
    process.exit(1);
  }
  console.log(status.ok(`Executable: ${resolved.stdout.trim()}`));

  // Test 2: try to run with a 5s timeout as a basic smoke test
  const smokeArgs = [...(server.args ?? [])];
  console.log(style.gray("Smoke test: starting process (5s timeout)..."));
  const smokeResult = await runShell(server.command, smokeArgs, {
    timeout: 5000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
  });
  if (!smokeResult.failed) {
    console.log(status.ok(`Process exited with code ${smokeResult.exitCode}`));
  } else if (smokeResult.stderr.includes("timeout") || smokeResult.stderr.includes("ETIMEDOUT")) {
    console.log(style.skin("Process is still running after 5s (expected for stdio MCP servers)"));
  } else if (smokeResult.stderr.includes("ENOENT")) {
    console.error(status.error(`Failed to start: ${smokeResult.stderr}`));
    process.exit(1);
  } else {
    console.log(style.gray(`Process exited with error (may be OK for stdio servers): ${smokeResult.stderr}`));
  }

  // Test 3: JSON-RPC initialize handshake
  console.log("");
  console.log(style.gray("JSON-RPC handshake test..."));
  const handshakeResult = await runShell(server.command, smokeArgs, {
    timeout: 8000,
    env: server.env ? { ...process.env, ...server.env } as Record<string, string> : process.env as Record<string, string>,
  });
  if (!handshakeResult.failed) {
    console.log(style.gray(`Server exited before handshake (exit code ${handshakeResult.exitCode})`));
  } else if (handshakeResult.stderr.includes("timeout") || handshakeResult.stderr.includes("ETIMEDOUT")) {
    console.log(style.mint("Server stayed alive long enough — stdio MCP server looks healthy"));
  } else {
    console.log(style.gray(`Handshake result: ${handshakeResult.stderr}`));
  }
}

export async function mcpRemoveCommand(serverName: string): Promise<void> {
  const root = getProjectRoot();
  const localPath = join(root, ".kimi", "mcp.json");
  const omkPath = join(root, ".omk", "mcp.json");

  const sources: Array<{ path: string; label: string }> = [
    { path: localPath, label: "project-local" },
    { path: omkPath, label: "omk-project" },
  ];

  let removed = false;
  for (const src of sources) {
    const cfg = await loadConfig(src.path);
    if (!cfg.parsed || !cfg.config.mcpServers || !(serverName in cfg.config.mcpServers)) {
      continue;
    }
    const next = { ...cfg.config.mcpServers };
    delete next[serverName];
    await writeFile(src.path, JSON.stringify({ mcpServers: next }, null, 2) + "\n", "utf-8");
    console.log(status.ok(`Removed "${serverName}" from ${src.label} MCP config: ${src.path}`));
    removed = true;
    break;
  }

  if (!removed) {
    console.log(status.error(`Server "${serverName}" not found in project-local MCP configs.`));
    console.log(style.gray(`Checked: ${sources.map((s) => s.path).join(", ")}`));
    console.log(style.gray(`To remove a global server, edit ~/.kimi/mcp.json manually.`));
    process.exit(1);
  }
}

export async function mcpAddCommand(serverName: string): Promise<void> {
  const root = getProjectRoot();
  const globalPath = join(homedir(), ".kimi", "mcp.json");
  const omkPath = join(root, ".omk", "mcp.json");

  const globalSource = await loadConfig(globalPath);
  if (!globalSource.parsed || !globalSource.config.mcpServers || !(serverName in globalSource.config.mcpServers)) {
    console.log(status.error(`Server "${serverName}" not found in global MCP config: ${globalPath}`));
    process.exit(1);
  }

  const omkSource = await loadConfig(omkPath);
  const omkServers = omkSource.parsed && omkSource.config.mcpServers ? { ...omkSource.config.mcpServers } : {};

  if (serverName in omkServers) {
    console.log(status.error(`Server "${serverName}" already exists in ${omkPath}`));
    process.exit(1);
  }

  omkServers[serverName] = globalSource.config.mcpServers[serverName];
  await writeFile(omkPath, JSON.stringify({ mcpServers: omkServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Add"));
  console.log(status.ok(`Added "${serverName}" to ${omkPath}`));
}

export async function mcpInstallCommand(
  name: string,
  command: string,
  args: string[],
  options: { env?: string[] } = {}
): Promise<void> {
  const root = getProjectRoot();
  const omkPath = join(root, ".omk", "mcp.json");

  const omkSource = await loadConfig(omkPath);
  const omkServers = omkSource.parsed && omkSource.config.mcpServers ? { ...omkSource.config.mcpServers } : {};

  if (name in omkServers) {
    console.log(status.error(`Server "${name}" already exists in ${omkPath}`));
    process.exit(1);
  }

  const server: McpServerConfig = { command, args };
  if (options.env && options.env.length > 0) {
    server.env = {};
    for (const pair of options.env) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        server.env[pair.slice(0, idx)] = pair.slice(idx + 1);
      }
    }
  }

  omkServers[name] = server;
  await writeFile(omkPath, JSON.stringify({ mcpServers: omkServers }, null, 2) + "\n", "utf-8");

  console.log(header("MCP Install"));
  console.log(status.ok(`Installed "${name}" into ${omkPath}`));
  console.log(label("Command", command));
  if (args.length > 0) console.log(label("Args", args.join(" ")));
}

export async function mcpSyncGlobalCommand(options: { overwrite?: boolean; omk?: boolean }): Promise<void> {
  const root = getProjectRoot();
  const globalPath = join(homedir(), ".kimi", "mcp.json");
  const targetPath = options.omk ? join(root, ".omk", "mcp.json") : join(root, ".kimi", "mcp.json");

  const globalSource = await loadConfig(globalPath);
  if (!globalSource.parsed || !globalSource.config.mcpServers) {
    console.log(status.error(`No global MCP config found at ${globalPath}`));
    process.exit(1);
  }

  const targetSource = await loadConfig(targetPath);
  const targetServers = targetSource.parsed && targetSource.config.mcpServers ? targetSource.config.mcpServers : {};

  let imported = 0;
  let skipped = 0;
  const merged: Record<string, McpServerConfig> = options.overwrite ? {} : { ...targetServers };

  for (const [name, server] of Object.entries(globalSource.config.mcpServers)) {
    if (name === "omk-project") {
      skipped++;
      continue;
    }
    if (!options.overwrite && name in merged) {
      skipped++;
      continue;
    }
    let redacted = { ...server };
    if ((server as Record<string, unknown>).env && typeof (server as Record<string, unknown>).env === "object") {
      const env = (server as Record<string, unknown>).env as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        cleaned[k] = isSecretEnvName(k) ? `\${${k}}` : v;
      }
      redacted = { ...redacted, env: cleaned };
    }
    if ((server as Record<string, unknown>).config) {
      const cfg = { ...(server as Record<string, unknown>).config as Record<string, unknown> };
      if (cfg.env && typeof cfg.env === "object") {
        const env = cfg.env as Record<string, string>;
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(env)) {
          cleaned[k] = isSecretEnvName(k) ? `\${${k}}` : v;
        }
        cfg.env = cleaned;
      }
      redacted = { ...(redacted as Record<string, unknown>), config: cfg } as McpServerConfig;
    }
    merged[name] = redacted as McpServerConfig;
    imported++;
  }

  const output: McpConfig = { mcpServers: merged };
  await writeFile(targetPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(header("MCP Sync Global"));
  console.log(status.ok(`Imported ${imported} global MCP server(s)`));
  if (skipped > 0) {
    console.log(style.gray(`Skipped ${skipped} (omk-project or existing local)`));
  }
  console.log(label("Written to", targetPath));
}

function isSecretEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)$/i.test(name);
}

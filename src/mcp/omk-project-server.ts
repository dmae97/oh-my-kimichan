#!/usr/bin/env node
import { createInterface } from "readline";
import { readFile, writeFile, readdir, access } from "fs/promises";
import { join, resolve, relative, dirname } from "path";
import { execSync } from "child_process";

// ─── Types ──────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Constants ──────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const OMK_DIR = join(PROJECT_ROOT, ".omk");
const OMK_MEMORY_DIR = join(OMK_DIR, "memory");
const OMK_AGENTS_DIR = join(OMK_DIR, "agents", "roles");
const OMK_RUNS_DIR = join(OMK_DIR, "runs");
const OMK_CONFIG_PATH = join(OMK_DIR, "config.toml");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "omk-project";
const SERVER_VERSION = "0.1.0";

// ─── Security helpers ───────────────────────────────────────────────────

function safePath(inputPath: string, baseDir: string): string {
  if (inputPath.includes("..") || inputPath.startsWith("/") || inputPath.startsWith("\\")) {
    throw new Error(`Invalid path: ${inputPath}`);
  }
  const full = resolve(join(baseDir, inputPath));
  const rel = relative(baseDir, full);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`Path traversal detected: ${inputPath}`);
  }
  return full;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Tool handlers ──────────────────────────────────────────────────────

async function handleReadMemory(args: { path: string }): Promise<{ content: string }> {
  const full = safePath(args.path, OMK_MEMORY_DIR);
  const content = await readFile(full, "utf-8").catch(() => "");
  return { content };
}

async function handleWriteMemory(args: { path: string; content: string }): Promise<{ success: boolean }> {
  const full = safePath(args.path, OMK_MEMORY_DIR);
  await writeFile(full, args.content, "utf-8");
  return { success: true };
}

async function handleReadConfig(): Promise<{ content: string }> {
  const content = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  return { content };
}

async function handleWriteConfig(args: { content: string }): Promise<{ success: boolean }> {
  await writeFile(OMK_CONFIG_PATH, args.content, "utf-8");
  return { success: true };
}

async function handleListAgents(): Promise<{ agents: string[] }> {
  if (!(await pathExists(OMK_AGENTS_DIR))) return { agents: [] };
  const entries = await readdir(OMK_AGENTS_DIR, { withFileTypes: true });
  const agents = entries.filter((e) => e.isFile() && e.name.endsWith(".yaml")).map((e) => e.name.replace(/\.yaml$/, ""));
  return { agents };
}

async function handleReadAgent(args: { name: string }): Promise<{ content: string }> {
  const full = safePath(`${args.name}.yaml`, OMK_AGENTS_DIR);
  const content = await readFile(full, "utf-8").catch(() => "");
  return { content };
}

async function handleListRuns(): Promise<{ runs: Array<{ id: string; createdAt: string }> }> {
  if (!(await pathExists(OMK_RUNS_DIR))) return { runs: [] };
  const entries = await readdir(OMK_RUNS_DIR, { withFileTypes: true });
  const runs = entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      createdAt: parseRunDate(e.name),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { runs };
}

function parseRunDate(runId: string): string {
  try {
    const iso = runId.replace(/-/g, ":").replace(/T/g, "-").replace(/:/g, ":");
    // runId format: 2025-04-30T12-34-56-789Z
    const parts = runId.split("T");
    if (parts.length === 2) {
      const date = parts[0];
      const time = parts[1].replace(/-/g, ":").replace(/:(\d+)Z$/, ".$1Z");
      return `${date}T${time}`;
    }
    return runId;
  } catch {
    return runId;
  }
}

async function handleReadRun(args: { runId: string }): Promise<{ goal: string; plan: string }> {
  const runDir = safePath(args.runId, OMK_RUNS_DIR);
  const goal = await readFile(join(runDir, "goal.md"), "utf-8").catch(() => "");
  const plan = await readFile(join(runDir, "plan.md"), "utf-8").catch(() => "");
  return { goal, plan };
}

async function handleGetProjectInfo(): Promise<{
  name: string;
  description?: string;
  gitBranch?: string;
  gitClean?: boolean;
  gitChanges?: number;
}> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const nameMatch = config.match(/^name\s*=\s*"([^"]+)"/m);
  const descMatch = config.match(/^description\s*=\s*"([^"]*)"/m);

  let gitBranch: string | undefined;
  let gitClean = true;
  let gitChanges = 0;

  try {
    const { execSync } = await import("child_process");
    gitBranch = execSync("git branch --show-current", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 3000 }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 3000 }).trim();
    const lines = status.split("\n").filter((l) => l.trim().length > 0);
    gitChanges = lines.length;
    gitClean = lines.length === 0;
  } catch {
    // ignore git errors
  }

  return {
    name: nameMatch?.[1] ?? "my-project",
    description: descMatch?.[1] ?? undefined,
    gitBranch,
    gitClean,
    gitChanges,
  };
}

async function handleGetQualitySettings(): Promise<{
  lint: string;
  test: string;
  typecheck: string;
  build: string;
}> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const lint = config.match(/^lint\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const test = config.match(/^test\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const typecheck = config.match(/^typecheck\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  const build = config.match(/^build\s*=\s*"([^"]+)"/m)?.[1] ?? "auto";
  return { lint, test, typecheck, build };
}

async function handleGetApprovalPolicy(): Promise<{ policy: string }> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");
  const policy = config.match(/^approval_policy\s*=\s*"([^"]+)"/m)?.[1] ?? "interactive";
  return { policy };
}

async function handleListWorktrees(): Promise<{ worktrees: string[] }> {
  const worktreesDir = join(OMK_DIR, "worktrees");
  if (!(await pathExists(worktreesDir))) return { worktrees: [] };

  const result: string[] = [];
  const runEntries = await readdir(worktreesDir, { withFileTypes: true });
  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory()) continue;
    const runPath = join(worktreesDir, runEntry.name);
    const nodeEntries = await readdir(runPath, { withFileTypes: true });
    for (const nodeEntry of nodeEntries) {
      if (nodeEntry.isDirectory()) {
        result.push(join(runPath, nodeEntry.name));
      }
    }
  }
  return { worktrees: result };
}

async function handleRunQualityGate(): Promise<{
  lint: { command: string; exitCode: number; stdout: string; stderr: string };
  typecheck: { command: string; exitCode: number; stdout: string; stderr: string };
  test: { command: string; exitCode: number; stdout: string; stderr: string };
  build: { command: string; exitCode: number; stdout: string; stderr: string };
}> {
  const config = await readFile(OMK_CONFIG_PATH, "utf-8").catch(() => "");

  function getSetting(key: string): string {
    // Match both top-level and [quality] section entries
    const regex = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
    return config.match(regex)?.[1] ?? "auto";
  }

  function detectPm(): string {
    try {
      execSync("test -f pnpm-lock.yaml", { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe" });
      return "pnpm";
    } catch { /* ignore */ }
    try {
      execSync("test -f yarn.lock", { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe" });
      return "yarn";
    } catch { /* ignore */ }
    try {
      execSync("test -f bun.lockb", { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe" });
      return "bun";
    } catch { /* ignore */ }
    return "npm";
  }

  const pm = detectPm();

  function runGate(setting: string, defaultCmd: string): { command: string; exitCode: number; stdout: string; stderr: string } {
    if (setting === "off") {
      return { command: "", exitCode: 0, stdout: "", stderr: "skipped (off)" };
    }
    const command = setting === "auto" ? `${pm} run ${defaultCmd}` : setting;
    try {
      const stdout = execSync(command, { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: "pipe", timeout: 120000 });
      return { command, exitCode: 0, stdout: stdout ?? "", stderr: "" };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return {
        command,
        exitCode: e.status ?? 1,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  }

  const lint = runGate(getSetting("lint"), "lint");
  const typecheck = runGate(getSetting("typecheck"), "typecheck");
  const test = runGate(getSetting("test"), "test");
  const build = runGate(getSetting("build"), "build");

  return { lint, typecheck, test, build };
}

// ─── Tool registry ──────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "omk_read_memory",
    description: "Read a file from .omk/memory/",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Relative path under .omk/memory/" } }, required: ["path"] },
  },
  {
    name: "omk_write_memory",
    description: "Write a file to .omk/memory/",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "omk_read_config",
    description: "Read .omk/config.toml",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_write_config",
    description: "Write .omk/config.toml (overwrite)",
    inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
  },
  {
    name: "omk_list_agents",
    description: "List available agent roles (.omk/agents/roles/*.yaml)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_read_agent",
    description: "Read an agent role YAML",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "omk_list_runs",
    description: "List past run IDs (.omk/runs/)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_read_run",
    description: "Read goal.md and plan.md for a run",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "omk_get_project_info",
    description: "Get project name, git branch, and status",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_get_quality_settings",
    description: "Get quality gate settings from config",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_get_approval_policy",
    description: "Get approval policy from config",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_list_worktrees",
    description: "List all worktrees under .omk/worktrees/",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "omk_run_quality_gate",
    description: "Run lint, typecheck, test, and build quality gates",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleToolCall(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "omk_read_memory":
      return handleReadMemory(args as { path: string });
    case "omk_write_memory":
      return handleWriteMemory(args as { path: string; content: string });
    case "omk_read_config":
      return handleReadConfig();
    case "omk_write_config":
      return handleWriteConfig(args as { content: string });
    case "omk_list_agents":
      return handleListAgents();
    case "omk_read_agent":
      return handleReadAgent(args as { name: string });
    case "omk_list_runs":
      return handleListRuns();
    case "omk_read_run":
      return handleReadRun(args as { runId: string });
    case "omk_get_project_info":
      return handleGetProjectInfo();
    case "omk_get_quality_settings":
      return handleGetQualitySettings();
    case "omk_get_approval_policy":
      return handleGetApprovalPolicy();
    case "omk_list_worktrees":
      return handleListWorktrees();
    case "omk_run_quality_gate":
      return handleRunQualityGate();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server loop ────────────────────────────────────────────────────────

function sendResponse(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + "\n");
}

function sendError(id: string | number, code: number, message: string, data?: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, error: { code, message, data } });
}

function sendResult(id: string | number, result: unknown): void {
  sendResponse({ jsonrpc: "2.0", id, result });
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  switch (req.method) {
    case "initialize": {
      sendResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    case "notifications/initialized":
      // No response needed for notifications
      return;

    case "tools/list": {
      sendResult(req.id, { tools: TOOLS });
      return;
    }

    case "tools/call": {
      const params = req.params as { name?: string; arguments?: unknown } | undefined;
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      if (!toolName || typeof toolName !== "string") {
        sendError(req.id, -32602, "Invalid params: missing 'name'");
        return;
      }
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendResult(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendError(req.id, -32603, `Tool execution error: ${message}`);
      }
      return;
    }

    default: {
      sendError(req.id, -32601, `Method not found: ${req.method}`);
      return;
    }
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      if (req.jsonrpc !== "2.0") continue;
      await handleRequest(req);
    } catch {
      // Ignore malformed JSON lines
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

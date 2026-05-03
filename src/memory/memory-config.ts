import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import {
  type EmbeddingConfig,
  loadEmbeddingConfig,
  redactEmbeddingConfig,
} from "./embedding.js";

export type MemoryBackend = "local_graph" | "neo4j" | "dual" | "kuzu";
export type Neo4jAuthMode = "basic" | "none";

export interface MemorySettings {
  backend: MemoryBackend;
  strict: boolean;
  force: boolean;
  mirrorFiles: boolean;
  migrateFiles: boolean;
  project: {
    key: string;
    name: string;
    root: string;
  };
  session: {
    id: string;
    key: string;
  };
  localGraph: {
    path: string;
    ontology: string;
    query: "graphql-lite";
    configured: boolean;
  };
  neo4j: {
    uri: string;
    username: string;
    password?: string;
    database: string;
    auth: Neo4jAuthMode;
    configured: boolean;
    missing: string[];
  };
  embedding: EmbeddingConfig;
}

export interface MemoryStatus {
  backend: MemoryBackend;
  strict: boolean;
  force: boolean;
  mirrorFiles: boolean;
  migrateFiles: boolean;
  projectKey: string;
  projectName: string;
  sessionId: string;
  localGraph: {
    configured: boolean;
    path: string;
    ontology: string;
    query: "graphql-lite";
  };
  neo4j: {
    configured: boolean;
    uri: string;
    username: string;
    database: string;
    auth: Neo4jAuthMode;
    missing: string[];
  };
  embedding: Omit<EmbeddingConfig, "apiKey">;
}

type FlatToml = Record<string, string>;

type Env = NodeJS.ProcessEnv;

const FALLBACK_SESSION_ID = `process-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

export const GLOBAL_MEMORY_CONFIG_TOML = `# oh-my-kimichan global memory policy
# Default is project-local graph memory: open-source friendly, no daemon, no secrets.
# Optional external Neo4j credentials must stay in env vars, never in this file.
[memory]
backend = "local_graph"    # local_graph | neo4j | dual | kuzu
scope = "project-session"
strict = true               # fail memory writes if the selected graph backend is unavailable
force = true                # global policy wins over project-local backend overrides
mirror_files = true         # keep .omk/memory/*.md as readable mirrors
migrate_files = true        # seed the graph from existing .omk/memory files on first read

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"

[neo4j]
uri_env = "OMK_NEO4J_URI"
username_env = "OMK_NEO4J_USERNAME"
password_env = "OMK_NEO4J_PASSWORD"
database_env = "OMK_NEO4J_DATABASE"
uri = "bolt://localhost:7687"
username = "neo4j"
database = "neo4j"
auth = "basic"             # basic | none
`;

export function getGlobalMemoryConfigPath(): string {
  return join(homedir(), ".kimi", "omk.memory.toml");
}

export function isGraphMemoryBackend(backend: MemoryBackend): boolean {
  return backend === "local_graph" || backend === "neo4j" || backend === "dual" || backend === "kuzu";
}

export function usesLocalGraphBackend(backend: MemoryBackend): boolean {
  return backend === "local_graph";
}

export function usesExternalNeo4jBackend(backend: MemoryBackend): boolean {
  return backend === "neo4j" || backend === "dual";
}

export function usesKuzuBackend(backend: MemoryBackend): boolean {
  return backend === "kuzu";
}

export async function loadMemorySettings(projectRoot = process.cwd(), env: Env = process.env): Promise<MemorySettings> {
  const normalizedRoot = resolve(projectRoot);
  const [globalConfig, projectConfig] = await Promise.all([
    readSimpleToml(getGlobalMemoryConfigPath()),
    readSimpleToml(join(normalizedRoot, ".omk", "config.toml")),
  ]);

  const envForce = parseOptionalBoolean(env.OMK_MEMORY_FORCE);
  const force = envForce ?? readBoolean(globalConfig, "memory.force") ?? false;

  const readSetting = (key: string): string | undefined => {
    const envKey = toEnvKey(key);
    const envValue = env[envKey];
    if (envValue !== undefined && envValue !== "") return envValue;
    return force ? globalConfig[key] ?? projectConfig[key] : projectConfig[key] ?? globalConfig[key];
  };

  const backend = normalizeBackend(env.OMK_MEMORY_BACKEND ?? readSetting("memory.backend"));
  const strict = parseOptionalBoolean(env.OMK_MEMORY_STRICT) ?? parseOptionalBoolean(readSetting("memory.strict")) ?? true;
  const mirrorFiles = parseOptionalBoolean(env.OMK_MEMORY_MIRROR_FILES) ?? parseOptionalBoolean(readSetting("memory.mirror_files")) ?? true;
  const migrateFiles = parseOptionalBoolean(env.OMK_MEMORY_MIGRATE_FILES) ?? parseOptionalBoolean(readSetting("memory.migrate_files")) ?? true;

  const projectName = env.OMK_PROJECT_NAME ?? readSetting("project.name") ?? (basename(normalizedRoot) || "project");
  const projectKey = env.OMK_PROJECT_ID ?? readSetting("memory.project_id") ?? `${basename(normalizedRoot) || "project"}:${hashShort(normalizedRoot)}`;
  const sessionId = env.OMK_SESSION_ID ?? env.OMK_RUN_ID ?? env.KIMI_SESSION_ID ?? FALLBACK_SESSION_ID;
  const sessionKey = `${projectKey}:${sessionId}`;

  const localGraphPath = resolve(
    normalizedRoot,
    env.OMK_LOCAL_GRAPH_PATH ?? readSetting("local_graph.path") ?? ".omk/memory/graph-state.json"
  );
  const localGraphOntology = env.OMK_LOCAL_GRAPH_ONTOLOGY ?? readSetting("local_graph.ontology") ?? "omk-ontology-mindmap-v1";

  const uriEnv = readSetting("neo4j.uri_env") ?? "OMK_NEO4J_URI";
  const usernameEnv = readSetting("neo4j.username_env") ?? "OMK_NEO4J_USERNAME";
  const passwordEnv = readSetting("neo4j.password_env") ?? "OMK_NEO4J_PASSWORD";
  const databaseEnv = readSetting("neo4j.database_env") ?? "OMK_NEO4J_DATABASE";
  const auth = normalizeAuth(readSetting("neo4j.auth"));

  // Neo4j credentials ONLY from environment variables — never from config files.
  const uri = env[uriEnv] ?? env.NEO4J_URI ?? "bolt://localhost:7687";
  const username = env[usernameEnv] ?? env.NEO4J_USERNAME ?? "neo4j";
  const password = env[passwordEnv] ?? env.NEO4J_PASSWORD;
  const database = env[databaseEnv] ?? env.NEO4J_DATABASE ?? "neo4j";

  if (globalConfig["neo4j.password"] || projectConfig["neo4j.password"] || globalConfig["neo4j.username"] || projectConfig["neo4j.username"]) {
    console.warn("[memory-config] Neo4j credentials found in config file are ignored. Use environment variables only.");
  }

  const missing: string[] = [];
  if (!uri) missing.push(uriEnv);
  if (auth === "basic") {
    if (!username) missing.push(usernameEnv);
    if (!password) missing.push(passwordEnv);
  }

  const embedding = loadEmbeddingConfig(env);

  return {
    backend,
    strict,
    force,
    mirrorFiles,
    migrateFiles,
    project: {
      key: projectKey,
      name: projectName,
      root: normalizedRoot,
    },
    session: {
      id: sessionId,
      key: sessionKey,
    },
    localGraph: {
      path: localGraphPath,
      ontology: localGraphOntology,
      query: "graphql-lite",
      configured: true,
    },
    neo4j: {
      uri,
      username,
      password,
      database,
      auth,
      configured: missing.length === 0,
      missing,
    },
    embedding,
  };
}

export function summarizeMemorySettings(settings: MemorySettings): MemoryStatus {
  return {
    backend: settings.backend,
    strict: settings.strict,
    force: settings.force,
    mirrorFiles: settings.mirrorFiles,
    migrateFiles: settings.migrateFiles,
    projectKey: settings.project.key,
    projectName: settings.project.name,
    sessionId: settings.session.id,
    localGraph: {
      configured: settings.localGraph.configured,
      path: settings.localGraph.path,
      ontology: settings.localGraph.ontology,
      query: settings.localGraph.query,
    },
    neo4j: {
      configured: settings.neo4j.configured,
      uri: redactUri(settings.neo4j.uri),
      username: settings.neo4j.username,
      database: settings.neo4j.database,
      auth: settings.neo4j.auth,
      missing: settings.neo4j.missing,
    },
    embedding: redactEmbeddingConfig(settings.embedding),
  };
}

async function readSimpleToml(path: string): Promise<FlatToml> {
  try {
    const content = await readFile(path, "utf-8");
    return parseSimpleToml(content);
  } catch {
    return {};
  }
}

function parseSimpleToml(content: string): FlatToml {
  const result: FlatToml = {};
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = section ? `${section}.${kv[1].trim()}` : kv[1].trim();
    result[key] = normalizeTomlValue(kv[2].trim());
  }
  return result;
}

function stripComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
      }
    }
    if (char === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function normalizeTomlValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeBackend(value: string | undefined): MemoryBackend {
  if (value === "local_graph" || value === "neo4j" || value === "dual" || value === "kuzu") return value;
  if (value === "graph" || value === "local-graph") return "local_graph";
  return "local_graph";
}

function normalizeAuth(value: string | undefined): Neo4jAuthMode {
  return value === "none" ? "none" : "basic";
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readBoolean(config: FlatToml, key: string): boolean | undefined {
  return parseOptionalBoolean(config[key]);
}

function toEnvKey(key: string): string {
  return `OMK_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function redactUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
      return parsed.toString();
    }
  } catch {
    // Non-URL-ish Bolt strings should be safe enough as long as credentials are not embedded.
  }
  return uri;
}

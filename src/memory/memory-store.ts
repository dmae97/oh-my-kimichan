import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve, relative, isAbsolute } from "path";
import { getProjectRoot } from "../util/fs.js";
import {
  loadMemorySettings,
  summarizeMemorySettings,
  usesExternalNeo4jBackend,
  usesLocalGraphBackend,
  type MemorySettings,
  type MemoryStatus,
} from "./memory-config.js";
import type {
  GraphQueryResult,
  MemoryMindmap,
  MemoryOntology,
  MemorySearchResult,
} from "./local-graph-memory-store.js";

export interface MemoryStoreOptions {
  projectRoot?: string;
  sessionId?: string;
  source?: string;
  env?: NodeJS.ProcessEnv;
}

export class MemoryStore {
  private readonly basePath: string;
  private settingsPromise?: Promise<MemorySettings>;
  private graphStorePromise?: Promise<GraphMemoryStore | null>;

  constructor(basePath: string, private readonly options: MemoryStoreOptions = {}) {
    this.basePath = resolve(basePath);
  }

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
    const full = this.safePath(path);
    const graph = await this.getGraphStore();
    if (graph) {
      try {
        const graphContent = await graph.read(path);
        if (graphContent) return graphContent;
        const fileContent = await this.readFileContent(full);
        if (fileContent && graph.migrateFiles) {
          await graph.write(path, fileContent);
          return fileContent;
        }
        if (graph.strict) return graphContent;
        return fileContent;
      } catch (err) {
        if (graph.strict) throw err;
      }
    }
    return this.readFileContent(full);
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.safePath(path);
    const graph = await this.getGraphStore();
    if (graph) {
      try {
        await graph.write(path, content);
      } catch (err) {
        if (graph.strict) throw err;
      }
      if (!graph.mirrorFiles) return;
    }
    await this.writeFileContent(full, content);
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing ? `${existing}\n${content}` : content);
  }

  async readRunMemory(runId: string, path: string): Promise<string> {
    const { full, graphPath } = this.safeRunPath(runId, path);
    const graph = await this.getGraphStore();
    if (graph) {
      try {
        const graphContent = await graph.read(graphPath);
        if (graphContent) return graphContent;
        const fileContent = await this.readFileContent(full);
        if (fileContent && graph.migrateFiles) {
          await graph.write(graphPath, fileContent);
          return fileContent;
        }
        if (graph.strict) return graphContent;
        return fileContent;
      } catch (err) {
        if (graph.strict) throw err;
      }
    }
    return this.readFileContent(full);
  }

  async writeRunMemory(runId: string, path: string, content: string): Promise<void> {
    const { full, graphPath } = this.safeRunPath(runId, path);
    const graph = await this.getGraphStore();
    if (graph) {
      try {
        await graph.write(graphPath, content);
      } catch (err) {
        if (graph.strict) throw err;
      }
      if (!graph.mirrorFiles) return;
    }
    await this.writeFileContent(full, content);
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const graph = await this.getGraphStore();
    if (!graph) return [];
    return graph.search(query, limit);
  }

  async ontology(): Promise<MemoryOntology | null> {
    const graph = await this.getGraphStore();
    return typeof graph?.ontology === "function" ? graph.ontology() : null;
  }

  async mindmap(query?: string, limit?: number): Promise<MemoryMindmap | null> {
    const graph = await this.getGraphStore();
    return typeof graph?.mindmap === "function" ? graph.mindmap(query, limit) : null;
  }

  async graphQuery(query: string): Promise<GraphQueryResult> {
    const graph = await this.getGraphStore();
    if (typeof graph?.graphQuery !== "function") {
      throw new Error("omk_graph_query requires a graph memory backend (local_graph or neo4j)");
    }
    return graph.graphQuery(query);
  }

  async status(): Promise<MemoryStatus> {
    const graph = await this.getGraphStore();
    if (graph) return graph.status;
    return summarizeMemorySettings(await this.getSettings());
  }

  private async readFileContent(fullPath: string): Promise<string> {
    try {
      return await readFile(fullPath, "utf-8");
    } catch {
      return "";
    }
  }

  private async writeFileContent(fullPath: string, content: string): Promise<void> {
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  private safeRunPath(runId: string, path: string): { full: string; graphPath: string } {
    if (runId.includes("..") || runId.startsWith("/") || runId.startsWith("\\")) {
      throw new Error(`MemoryStore: invalid runId: ${runId}`);
    }
    const root = this.options.projectRoot ?? getProjectRoot();
    const runBase = resolve(join(root, ".omk", "runs", runId, "memory"));
    const full = resolve(join(runBase, path));
    const rel = relative(runBase, full);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`MemoryStore: path traversal detected: ${path}`);
    }
    return { full, graphPath: join("runs", runId, path).replace(/\\/g, "/") };
  }

  private async getSettings(): Promise<MemorySettings> {
    const env = this.options.sessionId
      ? { ...(this.options.env ?? process.env), OMK_SESSION_ID: this.options.sessionId }
      : this.options.env;
    this.settingsPromise ??= loadMemorySettings(this.options.projectRoot, env);
    return this.settingsPromise;
  }

  private async getGraphStore(): Promise<GraphMemoryStore | null> {
    this.graphStorePromise ??= (async () => {
      const settings = await this.getSettings();
      const options = {
        projectRoot: this.options.projectRoot,
        sessionId: this.options.sessionId,
        source: this.options.source,
        env: this.options.env,
      };
      if (usesLocalGraphBackend(settings.backend)) {
        const { LocalGraphMemoryStore } = await import("./local-graph-memory-store.js");
        return LocalGraphMemoryStore.create(options);
      }
      if (usesExternalNeo4jBackend(settings.backend)) {
        const { Neo4jMemoryStore } = await import("./neo4j-memory-store.js");
        return Neo4jMemoryStore.create(options);
      }
      return null;
    })();
    return this.graphStorePromise;
  }
}

interface GraphMemoryStore {
  readonly status: MemoryStatus;
  readonly strict: boolean;
  readonly mirrorFiles: boolean;
  readonly migrateFiles: boolean;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  ontology?: () => Promise<MemoryOntology>;
  mindmap?: (query?: string, limit?: number) => Promise<MemoryMindmap>;
  graphQuery?: (query: string) => Promise<GraphQueryResult>;
}

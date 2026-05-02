import { createHash } from "crypto";
import neo4j, { type Driver } from "neo4j-driver";
import {
  loadMemorySettings,
  summarizeMemorySettings,
  usesExternalNeo4jBackend,
  type MemorySettings,
  type MemoryStatus,
} from "./memory-config.js";
import {
  ONTOLOGY_SCHEMA_VERSION,
  createOntologyConstraints,
  containsMutation,
} from "./ontology-model.js";

interface Neo4jRecordLike {
  keys: string[];
  get(key: string): unknown;
}

interface Neo4jResultLike {
  records: Neo4jRecordLike[];
}

export interface Neo4jMemorySearchResult {
  path: string;
  content: string;
  sessionId: string;
  updatedAt: string;
  source: string;
}

export interface Neo4jGraphQueryResult {
  data: {
    records: Array<Record<string, unknown>>;
  };
  extensions: {
    dialect: "cypher";
    backend: "neo4j";
    database: string;
  };
}

export interface Neo4jMemoryStoreOptions {
  projectRoot?: string;
  sessionId?: string;
  source?: string;
  env?: NodeJS.ProcessEnv;
}

export class Neo4jMemoryStore {
  private driver?: Driver;
  private schemaReady = false;
  private closeHookRegistered = false;

  constructor(
    private readonly settings: MemorySettings,
    private readonly source = "omk-memory"
  ) {}

  static async create(options: Neo4jMemoryStoreOptions = {}): Promise<Neo4jMemoryStore | null> {
    const env = options.sessionId
      ? { ...(options.env ?? process.env), OMK_SESSION_ID: options.sessionId }
      : options.env ?? process.env;
    const settings = await loadMemorySettings(options.projectRoot, env);
    if (!usesExternalNeo4jBackend(settings.backend)) return null;
    return new Neo4jMemoryStore(settings, options.source ?? "omk-memory");
  }

  get status(): MemoryStatus {
    return summarizeMemorySettings(this.settings);
  }

  get strict(): boolean {
    return this.settings.strict;
  }

  get mirrorFiles(): boolean {
    return this.settings.mirrorFiles;
  }

  get migrateFiles(): boolean {
    return this.settings.migrateFiles;
  }

  async assertReady(): Promise<void> {
    this.assertConfigured();
    await this.ensureSchema();
  }

  async read(path: string): Promise<string> {
    this.assertConfigured();
    await this.ensureSchema();
    const result = await this.execute(
      `MATCH (:OmkProject {key: $projectKey})-[:HAS_MEMORY]->(m:OmkMemory {key: $memoryKey})
       RETURN m.content AS content
       LIMIT 1`,
      {
        projectKey: this.settings.project.key,
        memoryKey: this.memoryKey(path),
      }
    );
    const content = result.records[0]?.get("content");
    return typeof content === "string" ? content : "";
  }

  async write(path: string, content: string): Promise<void> {
    this.assertConfigured();
    await this.ensureSchema();
    const now = new Date().toISOString();
    const memoryKey = this.memoryKey(path);
    const versionKey = this.versionKey(path, content, now);
    const rootHash = hash(this.settings.project.root);
    await this.execute(
      `MERGE (p:OmkProject {key: $projectKey})
         ON CREATE SET p.createdAt = $now
       SET p.name = $projectName,
           p.root = $projectRoot,
           p.updatedAt = $now,
           p.id = $projectKey,
           p.projectId = $projectKey,
           p.workspaceRootHash = $workspaceRootHash,
           p.schemaVersion = $schemaVersion
       MERGE (s:OmkSession {key: $sessionKey})
         ON CREATE SET s.createdAt = $now,
                       s.id = $sessionId,
                       s.projectKey = $projectKey
       SET s.updatedAt = $now,
           s.projectId = $projectKey,
           s.workspaceRootHash = $workspaceRootHash,
           s.schemaVersion = $schemaVersion
       MERGE (p)-[:HAS_SESSION]->(s)
       MERGE (m:OmkMemory {key: $memoryKey})
         ON CREATE SET m.createdAt = $now,
                       m.path = $path,
                       m.projectKey = $projectKey
       SET m.content = $content,
           m.updatedAt = $now,
           m.sessionId = $sessionId,
           m.source = $source,
           m.id = $memoryKey,
           m.projectId = $projectKey,
           m.workspaceRootHash = $workspaceRootHash,
           m.schemaVersion = $schemaVersion
       MERGE (p)-[:HAS_MEMORY]->(m)
       CREATE (v:OmkMemoryVersion {
         key: $versionKey,
         path: $path,
         content: $content,
         createdAt: $now,
         projectKey: $projectKey,
         sessionId: $sessionId,
         source: $source,
         id: $versionKey,
         projectId: $projectKey,
         workspaceRootHash: $workspaceRootHash,
         schemaVersion: $schemaVersion
       })
       MERGE (s)-[:WROTE]->(v)
       MERGE (v)-[:UPDATES]->(m)`,
      {
        projectKey: this.settings.project.key,
        projectName: this.settings.project.name,
        projectRoot: this.settings.project.root,
        sessionKey: this.settings.session.key,
        sessionId: this.settings.session.id,
        memoryKey,
        versionKey,
        path,
        content,
        now,
        source: this.source,
        workspaceRootHash: rootHash,
        schemaVersion: ONTOLOGY_SCHEMA_VERSION,
      }
    );
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    await this.write(path, existing ? `${existing}\n${content}` : content);
  }

  async search(query: string, limit = 10): Promise<Neo4jMemorySearchResult[]> {
    this.assertConfigured();
    await this.ensureSchema();
    const normalizedQuery = query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const result = await this.execute(
      `MATCH (:OmkProject {key: $projectKey})-[:HAS_MEMORY]->(m:OmkMemory)
       WHERE $query = "" OR toLower(m.path) CONTAINS $query OR toLower(m.content) CONTAINS $query
       RETURN m.path AS path,
              m.content AS content,
              m.sessionId AS sessionId,
              m.updatedAt AS updatedAt,
              m.source AS source
       ORDER BY m.updatedAt DESC
       LIMIT ${safeLimit}`,
      {
        projectKey: this.settings.project.key,
        query: normalizedQuery,
      }
    );
    return result.records.map((record) => ({
      path: String(record.get("path") ?? ""),
      content: String(record.get("content") ?? ""),
      sessionId: String(record.get("sessionId") ?? ""),
      updatedAt: String(record.get("updatedAt") ?? ""),
      source: String(record.get("source") ?? ""),
    }));
  }

  async graphQuery(query: string): Promise<Neo4jGraphQueryResult> {
    this.assertConfigured();
    await this.ensureSchema();
    if (containsMutation(query)) {
      throw new Error("omk_graph_query: write mutations are not allowed in Cypher queries");
    }
    const result = await this.execute(query, {});
    return {
      data: {
        records: result.records.map((record) => {
          const obj: Record<string, unknown> = {};
          for (const key of record.keys) {
            obj[key] = record.get(key);
          }
          return obj;
        }),
      },
      extensions: {
        dialect: "cypher",
        backend: "neo4j",
        database: this.settings.neo4j.database || "neo4j",
      },
    };
  }

  async close(): Promise<void> {
    if (!this.driver) return;
    const driver = this.driver;
    this.driver = undefined;
    await driver.close();
  }

  private assertConfigured(): void {
    if (this.settings.neo4j.configured) return;
    const missing = this.settings.neo4j.missing.join(", ");
    throw new Error(`Neo4j memory is enabled but not configured. Missing env: ${missing}`);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.execute("CREATE CONSTRAINT omk_project_key IF NOT EXISTS FOR (p:OmkProject) REQUIRE p.key IS UNIQUE", {});
    await this.execute("CREATE CONSTRAINT omk_session_key IF NOT EXISTS FOR (s:OmkSession) REQUIRE s.key IS UNIQUE", {});
    await this.execute("CREATE CONSTRAINT omk_memory_key IF NOT EXISTS FOR (m:OmkMemory) REQUIRE m.key IS UNIQUE", {});
    await this.execute("CREATE CONSTRAINT omk_memory_version_key IF NOT EXISTS FOR (v:OmkMemoryVersion) REQUIRE v.key IS UNIQUE", {});
    await createOntologyConstraints(
      { executeQuery: (q, p, o) => this.execute(q, p ?? {}, o) },
      this.settings.neo4j.database
    );
    this.schemaReady = true;
  }

  private async execute(query: string, params: Record<string, unknown>, options?: { database?: string }): Promise<Neo4jResultLike> {
    const driver = this.getDriver();
    const dbOptions = options?.database
      ? { database: options.database }
      : this.settings.neo4j.database
        ? { database: this.settings.neo4j.database }
        : undefined;
    return driver.executeQuery(query, params, dbOptions) as Promise<Neo4jResultLike>;
  }

  private getDriver(): Driver {
    if (!this.driver) {
      const authToken = this.settings.neo4j.auth === "none"
        ? undefined
        : neo4j.auth.basic(this.settings.neo4j.username, this.settings.neo4j.password ?? "");
      this.driver = neo4j.driver(this.settings.neo4j.uri, authToken);
      this.registerCloseHook();
    }
    return this.driver;
  }

  private registerCloseHook(): void {
    if (this.closeHookRegistered) return;
    this.closeHookRegistered = true;
    process.once("beforeExit", () => {
      void this.close();
    });
  }

  private memoryKey(path: string): string {
    return `${this.settings.project.key}:${hash(path)}`;
  }

  private versionKey(path: string, content: string, timestamp: string): string {
    return `${this.settings.session.key}:${hash(`${path}\n${timestamp}\n${content}`)}`;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

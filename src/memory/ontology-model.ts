/**
 * Neo4j ontology model for OMK project memory.
 *
 * Defines core node types, relationship types, project-isolation fields,
 * and schema helpers used across all graph-backed memory stores.
 */

export const ONTOLOGY_SCHEMA_VERSION = 1;

export const ONTOLOGY_NODE_TYPES = [
  "Project",
  "Session",
  "Goal",
  "Criterion",
  "Evidence",
  "Decision",
  "Task",
  "Risk",
  "Constraint",
  "File",
  "Symbol",
  "Test",
  "Command",
  "Commit",
  "MCPServer",
  "Skill",
] as const;

export type OntologyNodeType = (typeof ONTOLOGY_NODE_TYPES)[number];

export const ONTOLOGY_RELATIONSHIP_TYPES = [
  "HAS_GOAL",
  "HAS_CRITERION",
  "HAS_EVIDENCE",
  "HAS_DECISION",
  "HAS_TASK",
  "DEPENDS_ON",
  "HAS_RISK",
  "HAS_FILE",
  "HAS_SYMBOL",
  "HAS_TEST",
  "HAS_COMMAND",
  "HAS_COMMIT",
  "USES_MCP",
  "USES_SKILL",
] as const;

export type OntologyRelationshipType = (typeof ONTOLOGY_RELATIONSHIP_TYPES)[number];

/** Base properties present on every ontology node for project isolation. */
export interface OntologyNodeBase {
  /** Unique node identifier (scoped to project). */
  id: string;
  /** Project key for multi-tenant isolation. */
  projectId: string;
  /** SHA-256 hash of the workspace root path. */
  workspaceRootHash: string;
  /** Ontology schema version (default 1). */
  schemaVersion: number;
  /** ISO timestamp when the node was created. */
  createdAt: string;
  /** ISO timestamp when the node was last updated. */
  updatedAt: string;
}

/** Legacy Project node managed by the Neo4j memory store. */
export interface ProjectNode extends OntologyNodeBase {
  key: string;
  name: string;
  root: string;
}

/** Legacy Session node managed by the Neo4j memory store. */
export interface SessionNode extends OntologyNodeBase {
  key: string;
  sessionId: string;
  projectKey: string;
}

/** Legacy Memory node managed by the Neo4j memory store. */
export interface MemoryNode extends OntologyNodeBase {
  key: string;
  path: string;
  content: string;
  source: string;
}

/** Legacy MemoryVersion node managed by the Neo4j memory store. */
export interface MemoryVersionNode extends OntologyNodeBase {
  key: string;
  path: string;
  content: string;
  source: string;
}

/** Goal node in the ontology graph. */
export interface GoalNode extends OntologyNodeBase {
  goalId: string;
  title: string;
  objective: string;
  status: string;
  riskLevel: string;
}

/** Criterion node linked to a Goal. */
export interface CriterionNode extends OntologyNodeBase {
  criterionId: string;
  description: string;
  requirement: string;
  weight: number;
}

/** Evidence node for goal verification. */
export interface EvidenceNode extends OntologyNodeBase {
  evidenceId: string;
  passed: boolean;
  message: string;
  checkedAt: string;
}

/** Decision node capturing project decisions. */
export interface DecisionNode extends OntologyNodeBase {
  decisionId: string;
  description: string;
  decidedAt: string;
}

/** Task node for actionable work items. */
export interface TaskNode extends OntologyNodeBase {
  taskId: string;
  description: string;
  status: string;
  priority: string;
}

/** Risk node for tracked risks. */
export interface RiskNode extends OntologyNodeBase {
  riskId: string;
  description: string;
  level: string;
}

/** Command node for recorded commands. */
export interface CommandNode extends OntologyNodeBase {
  commandId: string;
  command: string;
  description: string;
}

/** File node for referenced files. */
export interface FileNode extends OntologyNodeBase {
  path: string;
  description: string;
}

/** Skill node for available skills. */
export interface SkillNode extends OntologyNodeBase {
  name: string;
  description: string;
}

/** MCP Server node for configured MCP servers. */
export interface MCPServerNode extends OntologyNodeBase {
  name: string;
  description: string;
}

/** Minimal executor interface accepted by {@link createOntologyConstraints}. */
export interface OntologyConstraintExecutor {
  executeQuery(query: string, params?: Record<string, unknown>, options?: { database?: string }): Promise<unknown>;
}

/**
 * Create unique constraints in Neo4j for every ontology node type.
 * Each constraint enforces uniqueness on `(projectId, id)` for the label.
 */
export async function createOntologyConstraints(
  executor: OntologyConstraintExecutor,
  database?: string
): Promise<void> {
  const options = database ? { database } : undefined;
  for (const nodeType of ONTOLOGY_NODE_TYPES) {
    const label = `Omk${nodeType}`;
    const constraintName = `omk_${nodeType.toLowerCase()}_project_id_unique`;
    await executor.executeQuery(
      `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE (n.projectId, n.id) IS UNIQUE`,
      {},
      options
    );
  }
}

/** Cypher write keywords rejected by the read-only graph query guard. */
export const MUTATION_KEYWORDS = ["CREATE", "DELETE", "SET", "REMOVE", "MERGE", "DROP"];

/**
 * Return true if the provided Cypher query contains write mutations.
 * Strips line comments and block comments before scanning.
 */
export function containsMutation(query: string): boolean {
  const normalized = query
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return MUTATION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

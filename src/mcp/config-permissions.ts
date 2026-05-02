const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

export function canWriteConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_VALUES.has(String(env.OMK_MCP_ALLOW_WRITE_CONFIG ?? "").trim().toLowerCase());
}

export function configWriteDeniedMessage(): string {
  return "omk_write_config is disabled by default. Set OMK_MCP_ALLOW_WRITE_CONFIG=1 for trusted local sessions.";
}

/**
 * Recommended MCP permission profiles:
 *
 * - default : Read-only project info, goals, runs, and memory. Safe for general use.
 * - docs    : Includes default + write access to memory and ontology. For documentation agents.
 * - repo    : Includes docs + quality gates and evidence checks. For code-change agents.
 * - browser : Includes repo + config write approval. For agents that need to mutate project settings.
 * - graph   : Includes repo + full graph query and memory write. For ontology-heavy analysis agents.
 *
 * Profiles are not enforced in code; they are documented here for operator reference when
 * configuring MCP server allow-lists and environment variables.
 */

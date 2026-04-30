const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

export function canWriteConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_VALUES.has(String(env.OMK_MCP_ALLOW_WRITE_CONFIG ?? "").trim().toLowerCase());
}

export function configWriteDeniedMessage(): string {
  return "omk_write_config is disabled by default. Set OMK_MCP_ALLOW_WRITE_CONFIG=1 for trusted local sessions.";
}

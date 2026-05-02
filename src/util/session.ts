export function createOmkSessionId(prefix: "chat" | "plan" | "run" | "team" | "session" | "feature" | "bugfix" | "refactor" | "review" = "session"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}-${process.pid}`;
}

export function createOmkSessionEnv(projectRoot: string, sessionId: string): Record<string, string> {
  return {
    OMK_PROJECT_ROOT: projectRoot,
    OMK_SESSION_ID: sessionId,
  };
}

export type ApprovalPolicy = "interactive" | "auto" | "yolo";

export interface ApprovalContext {
  tool: string;
  input: unknown;
  workerId?: string;
  runId?: string;
}

export function decideApproval(
  policy: ApprovalPolicy,
  ctx: ApprovalContext
): "allow" | "block" | "ask" {
  if (policy === "yolo") return "allow";
  if (policy === "auto") {
    // Auto-approve read-only and safe tools
    const safeTools = ["ReadFile", "Glob", "Grep", "SearchWeb", "FetchURL"];
    if (safeTools.includes(ctx.tool)) return "allow";
    return "ask";
  }
  return "ask";
}

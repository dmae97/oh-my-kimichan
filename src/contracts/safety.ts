// Contract: src/contracts/safety.ts
// Owner: Contract Worker (Phase 0)
// Read-only for all other workers. Version-bump only via Integration Worker.

export interface ApprovalContext {
  tool: string;
  input: unknown;
  workerId?: string;
  runId?: string;
}

export type ApprovalDecision = "allow" | "block" | "ask";

export interface PolicyEngine {
  decide(ctx: ApprovalContext): Promise<ApprovalDecision>;
}

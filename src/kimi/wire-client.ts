import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { CappedOutputBuffer } from "../util/output-buffer.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface KimiInitializeParams {
  protocol_version: string;
  client: {
    name: string;
    version: string;
  };
  capabilities: {
    supports_question: boolean;
    supports_plan_mode: boolean;
  };
  external_tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface KimiPromptParams {
  user_input: string;
}

export interface KimiPromptResult {
  status: "finished" | "cancelled";
}

export type WireEvent =
  | { type: "status"; contextUsage: number; maxContextTokens: number; tokenUsage: number; planMode: boolean }
  | { type: "message"; role: "assistant" | "user"; content: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "error"; message: string }
  | { type: "request"; method: string; params: unknown; respond: (result: unknown) => void; reject: (error: { code: number; message: string }) => void };

let requestId = 0;
function nextId(): string {
  return `omk-${++requestId}`;
}

export class KimiWireClient {
  private proc?: ChildProcess;
  private rl?: ReturnType<typeof createInterface>;
  private pending = new Map<string, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private eventHandlers: Array<(event: WireEvent) => void> = [];

  constructor(
    private options: {
      agentFile?: string;
      configFile?: string;
      mcpConfigFile?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    } = {}
  ) {}

  onEvent(handler: (event: WireEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private emit(event: WireEvent): void {
    for (const h of this.eventHandlers) {
      try {
        h(event);
      } catch {
        // ignore
      }
    }
  }

  async start(): Promise<void> {
    const args = ["--wire"];
    if (this.options.agentFile) args.push("--agent-file", this.options.agentFile);
    if (this.options.configFile) args.push("--config-file", this.options.configFile);
    if (this.options.mcpConfigFile) args.push("--mcp-config-file", this.options.mcpConfigFile);

    this.proc = spawn("kimi", args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = createInterface({ input: this.proc.stdout! });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcRequest;
        if ("id" in msg && ("result" in msg || "error" in msg)) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if ("error" in msg && msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg as JsonRpcResponse);
            }
          }
        } else if ("method" in msg) {
          this.handleServerMessage(msg as JsonRpcRequest);
        }
      } catch {
        this.emit({ type: "message", role: "assistant", content: trimmed });
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      this.emit({ type: "error", message: text });
    });

    this.proc.on("exit", (code) => {
      this.emit({ type: "error", message: `Kimi process exited with code ${code}` });
      this.rl?.close();
      this.rl = undefined;
      // 프로세스 종료 시 pending Promise 전부 reject — 메모리 누수/데드락 방지
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Kimi process exited (code ${code}) before response to request ${id}`));
      }
      this.pending.clear();
    });

    await new Promise((r) => setTimeout(r, 500));

    await this.call("initialize", {
      protocol_version: "2025-03-11",
      client: { name: "oh-my-kimichan", version: "0.1.0" },
      capabilities: { supports_question: true, supports_plan_mode: true },
      external_tools: [
        {
          name: "omk_claim_task",
          description: "DAG 노드 작업을 할당받습니다",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "omk_update_task",
          description: "작업 상태를 업데이트합니다",
          parameters: {
            type: "object",
            properties: {
              task_id: { type: "string" },
              status: { type: "string", enum: ["running", "done", "failed", "blocked"] },
            },
            required: ["task_id", "status"],
          },
        },
        {
          name: "omk_read_memory",
          description: "프로젝트 메모리를 읽습니다",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "omk_write_memory",
          description: "프로젝트 메모리를 기록합니다",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
        {
          name: "omk_emit_metric",
          description: "메트릭을 기록합니다",
          parameters: {
            type: "object",
            properties: { key: { type: "string" }, value: { type: "number" } },
            required: ["key", "value"],
          },
        },
        {
          name: "omk_report_blocker",
          description: "블로커를 보고합니다",
          parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"],
          },
        },
      ],
    });
  }

  private async call<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    if (!this.proc?.stdin) throw new Error("Wire client not started");
    const id = nextId();
    const req: JsonRpcRequest<TParams> = { jsonrpc: "2.0", id, method, params };
    const timeoutMs = Number(process.env.OMK_WIRE_TIMEOUT_MS || "120000");
    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Wire RPC timeout: ${method} (id: ${id}, timeout: ${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.proc.stdin.write(JSON.stringify(req) + "\n");
    const res = await promise;
    if (res.error) throw new Error(res.error.message);
    return res.result as TResult;
  }

  private handleServerMessage(msg: JsonRpcRequest): void {
    if (msg.method === "status") {
      const p = msg.params as Record<string, unknown>;
      this.emit({
        type: "status",
        contextUsage: Number(p.context_usage ?? 0),
        maxContextTokens: Number(p.max_context_tokens ?? 256000),
        tokenUsage: Number(p.token_usage ?? 0),
        planMode: Boolean(p.plan_mode ?? false),
      });
      return;
    }

    // Handle server->client requests (ApprovalRequest, ToolCallRequest, QuestionRequest)
    const respond = (result: unknown): void => {
      const res: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id, result };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };
    const reject = (error: { code: number; message: string }): void => {
      const res: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id, error };
      this.proc?.stdin?.write(JSON.stringify(res) + "\n");
    };

    this.emit({ type: "request", method: msg.method, params: msg.params, respond, reject });
  }

  async prompt(userInput: string): Promise<KimiPromptResult> {
    return this.call("prompt", { user_input: userInput });
  }

  async steer(userInput: string): Promise<void> {
    await this.call("steer", { user_input: userInput });
  }

  async cancel(): Promise<void> {
    await this.call("cancel", {});
  }

  async stop(): Promise<void> {
    // pending 전부 정리 — 메모리 누수/데드락 방지
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Wire client stopped before response to request ${id}`));
    }
    this.pending.clear();
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = undefined;
    }
  }
}

export function createKimiTaskRunner(client: KimiWireClient): TaskRunner {
  return {
    async run(node: DagNode, env: Record<string, string>): Promise<TaskResult> {
      const resources = await getOmkResourceSettings();
      const prompt = `[${node.role}] ${node.name}`;
      const stdout = new CappedOutputBuffer(resources.wireOutputBytes, "wire stdout");
      const stderr = new CappedOutputBuffer(resources.wireOutputBytes, "wire stderr");

      const offEvent = client.onEvent((event) => {
        if (event.type === "message") {
          stdout.append(`${event.content}\n`);
        } else if (event.type === "error") {
          stderr.append(`${event.message}\n`);
        } else if (event.type === "tool_result") {
          stdout.append(`${JSON.stringify(event.output)}\n`);
        }
      });

      try {
        // Restart client with merged env if needed, or just use existing client
        // For simplicity, we use the existing client and assume env is passed via prompt context
        const result = await client.prompt(prompt);
        const success = result.status === "finished";
        return {
          success,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        };
      } catch (err) {
        stderr.append(`\n${String(err)}`);
        return {
          success: false,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        };
      } finally {
        offEvent();
      }
    },
  };
}

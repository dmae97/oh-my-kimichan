import { deepseekStatusReason } from "./deepseek-balance.js";

export interface DeepSeekChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekClientOptions {
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export interface DeepSeekCompleteOptions {
  messages: DeepSeekChatMessage[];
  temperature?: number;
  maxTokens?: number;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

interface DeepSeekChatChoice {
  finish_reason?: string;
  message?: {
    content?: string;
    reasoning_content?: string;
  };
}

export interface DeepSeekChatResponse {
  choices?: DeepSeekChatChoice[];
}

export class DeepSeekClient {
  private readonly apiKeyEnv: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly thinking: "enabled" | "disabled";
  private readonly reasoningEffort?: "high" | "max";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly apiKey?: string;

  constructor(options: DeepSeekClientOptions = {}) {
    this.apiKeyEnv = options.apiKeyEnv ?? "DEEPSEEK_API_KEY";
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = options.model ?? "deepseek-v4-flash";
    this.thinking = options.thinking ?? "enabled";
    this.reasoningEffort = options.reasoningEffort ?? "max";
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? this.env[this.apiKeyEnv];
  }

  async complete(options: DeepSeekCompleteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error(`${this.apiKeyEnv} is not set`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildRequestBody(options)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await this.errorReason(response));
      }

      const payload = await response.json() as DeepSeekChatResponse;
      return extractAssistantContent(payload);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`DeepSeek request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(options: DeepSeekCompleteOptions): Record<string, unknown> {
    const thinking = options.thinking ?? this.thinking;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens,
      thinking: {
        type: thinking,
      },
    };
    const reasoningEffort = options.reasoningEffort ?? this.reasoningEffort;
    if (thinking === "enabled" && reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    } else if (thinking === "disabled") {
      body.temperature = options.temperature ?? 0.2;
    }
    return body;
  }

  private async errorReason(response: Response): Promise<string> {
    const fallback = deepseekStatusReason(response.status);
    const readText = response.text?.bind(response);
    if (!readText) return fallback;
    try {
      const body = await readText();
      const summary = sanitizeErrorBody(body);
      return summary ? `${fallback}: ${summary}` : fallback;
    } catch {
      return fallback;
    }
  }
}

export function extractAssistantContent(payload: DeepSeekChatResponse): string {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (content) return content;

  const reasoning = choice?.message?.reasoning_content?.trim();
  if (reasoning) {
    throw new Error("DeepSeek response only included reasoning_content and no final assistant content");
  }

  const finish = choice?.finish_reason ? ` (finish_reason=${choice.finish_reason})` : "";
  throw new Error(`DeepSeek response did not include assistant content${finish}`);
}

function sanitizeErrorBody(body: string): string {
  return body
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

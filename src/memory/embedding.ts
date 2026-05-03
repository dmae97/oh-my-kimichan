export type EmbeddingProvider = "none" | "ollama" | "openai_compatible";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled: boolean;
}

export function loadEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = normalizeEmbeddingProvider(env.OMK_EMBEDDING_PROVIDER);
  return {
    provider,
    baseUrl: env.OMK_EMBEDDING_BASE_URL,
    model: env.OMK_EMBEDDING_MODEL,
    apiKey: env.OMK_EMBEDDING_API_KEY,
    enabled: provider !== "none",
  };
}

export function redactEmbeddingConfig(config: EmbeddingConfig): EmbeddingConfig {
  return {
    ...config,
    apiKey: config.apiKey ? "***" : undefined,
  };
}

export function createEmbeddingClient(_config: EmbeddingConfig): never {
  throw new Error(
    "Embedding generation is not yet implemented. Set OMK_EMBEDDING_PROVIDER=none to disable embeddings."
  );
}

function normalizeEmbeddingProvider(value: string | undefined): EmbeddingProvider {
  if (value === "ollama" || value === "openai_compatible") return value;
  return "none";
}

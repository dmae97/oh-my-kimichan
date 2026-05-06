import { chmod, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getUserHome } from "../../util/fs.js";

export type DeepSeekDisabledBy = "user" | "provider-402" | "provider-availability";

export interface DeepSeekProviderConfig {
  enabled?: boolean;
  disabledAt?: string;
  disabledReason?: string;
  disabledBy?: DeepSeekDisabledBy;
  updatedAt?: string;
  apiKeyEnv?: string;
  model?: string;
}

export interface OmkProvidersConfig {
  version: 1;
  providers: {
    deepseek?: DeepSeekProviderConfig;
  };
}

export interface DeepSeekConfigPathOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DeepSeekApiKeyResolution {
  apiKey?: string;
  apiKeyEnv: string;
  source?: "env" | "omk-secrets" | "opencode-secrets";
  sourcePath?: string;
}

export interface DeepSeekProviderStatus {
  provider: "deepseek";
  enabled: boolean;
  disabledReason?: string;
  disabledBy?: DeepSeekDisabledBy;
  apiKeySet: boolean;
  apiKeySource?: DeepSeekApiKeyResolution["source"];
  configPath: string;
  secretsPath: string;
}

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";

export function getDeepSeekProviderConfigPath(options: DeepSeekConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.OMK_PROVIDER_CONFIG_PATH ?? join(resolveHomeDir(options), ".config", "omk", "providers.json");
}

export function getOmkSecretsEnvPath(options: DeepSeekConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.OMK_SECRETS_ENV_PATH ?? join(resolveHomeDir(options), ".config", "omk", "secrets.env");
}

export function getOpenCodeSecretsEnvPath(options: DeepSeekConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  return env.OPENCODE_SECRETS_ENV_PATH ?? join(resolveHomeDir(options), ".config", "opencode", "secrets.env");
}

export async function readOmkProvidersConfig(
  options: DeepSeekConfigPathOptions = {}
): Promise<OmkProvidersConfig> {
  const path = getDeepSeekProviderConfigPath(options);
  const raw = await readFile(path, "utf-8").catch(() => null);
  if (!raw) return emptyProvidersConfig();

  try {
    const parsed = JSON.parse(raw) as Partial<OmkProvidersConfig>;
    return {
      version: 1,
      providers: {
        deepseek: normalizeDeepSeekProviderConfig(parsed.providers?.deepseek),
      },
    };
  } catch {
    return emptyProvidersConfig();
  }
}

export async function writeOmkProvidersConfig(
  config: OmkProvidersConfig,
  options: DeepSeekConfigPathOptions = {}
): Promise<string> {
  const path = getDeepSeekProviderConfigPath(options);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return path;
}

export async function setDeepSeekEnabled(
  enabled: boolean,
  options: DeepSeekConfigPathOptions & { reason?: string; disabledBy?: DeepSeekDisabledBy } = {}
): Promise<DeepSeekProviderConfig> {
  const config = await readOmkProvidersConfig(options);
  const current = normalizeDeepSeekProviderConfig(config.providers.deepseek);
  const updatedAt = new Date().toISOString();
  const next: DeepSeekProviderConfig = enabled
    ? {
        ...current,
        enabled: true,
        disabledAt: undefined,
        disabledReason: undefined,
        disabledBy: undefined,
        updatedAt,
      }
    : {
        ...current,
        enabled: false,
        disabledAt: updatedAt,
        disabledReason: options.reason ?? "Disabled by user",
        disabledBy: options.disabledBy ?? "user",
        updatedAt,
      };

  await writeOmkProvidersConfig({ version: 1, providers: { ...config.providers, deepseek: next } }, options);
  return next;
}

export async function forceDisableDeepSeek(
  reason: string,
  options: DeepSeekConfigPathOptions & { disabledBy?: DeepSeekDisabledBy } = {}
): Promise<DeepSeekProviderConfig> {
  const disabledBy = options.disabledBy ?? (reason.includes("402") ? "provider-402" : "provider-availability");
  return setDeepSeekEnabled(false, { ...options, reason, disabledBy });
}

export async function setDeepSeekApiKey(
  apiKey: string,
  options: DeepSeekConfigPathOptions & { apiKeyEnv?: string } = {}
): Promise<{ secretsPath: string; apiKeyEnv: string }> {
  const value = apiKey.trim();
  if (!value) throw new Error("DeepSeek API key is empty");
  if (/[\r\n\0]/.test(value)) throw new Error("DeepSeek API key must be a single line");

  const apiKeyEnv = options.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const secretsPath = getOmkSecretsEnvPath(options);
  await upsertEnvFileValue(secretsPath, apiKeyEnv, value);

  const config = await readOmkProvidersConfig(options);
  const deepseek = {
    ...normalizeDeepSeekProviderConfig(config.providers.deepseek),
    enabled: true,
    apiKeyEnv,
    disabledAt: undefined,
    disabledReason: undefined,
    disabledBy: undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeOmkProvidersConfig({ version: 1, providers: { ...config.providers, deepseek } }, options);

  return { secretsPath, apiKeyEnv };
}

export async function resolveDeepSeekApiKey(
  options: DeepSeekConfigPathOptions & { apiKeyEnv?: string } = {}
): Promise<DeepSeekApiKeyResolution> {
  const config = await readOmkProvidersConfig(options);
  const apiKeyEnv = options.apiKeyEnv ?? config.providers.deepseek?.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const env = options.env ?? process.env;
  const envValue = env[apiKeyEnv]?.trim();
  if (envValue) return { apiKey: envValue, apiKeyEnv, source: "env" };

  const omkSecretsPath = getOmkSecretsEnvPath(options);
  const omkValue = await readEnvFileValue(omkSecretsPath, apiKeyEnv);
  if (omkValue) return { apiKey: omkValue, apiKeyEnv, source: "omk-secrets", sourcePath: omkSecretsPath };

  const opencodeSecretsPath = getOpenCodeSecretsEnvPath(options);
  const opencodeValue = await readEnvFileValue(opencodeSecretsPath, apiKeyEnv);
  if (opencodeValue) {
    return { apiKey: opencodeValue, apiKeyEnv, source: "opencode-secrets", sourcePath: opencodeSecretsPath };
  }

  return { apiKeyEnv };
}

export async function getDeepSeekProviderStatus(
  options: DeepSeekConfigPathOptions = {}
): Promise<DeepSeekProviderStatus> {
  const [config, key] = await Promise.all([
    readOmkProvidersConfig(options),
    resolveDeepSeekApiKey(options),
  ]);
  const deepseek = normalizeDeepSeekProviderConfig(config.providers.deepseek);
  const enabled = deepseek.enabled !== false;

  return {
    provider: "deepseek",
    enabled,
    disabledReason: deepseek.disabledReason,
    disabledBy: deepseek.disabledBy,
    apiKeySet: Boolean(key.apiKey),
    apiKeySource: key.source,
    configPath: getDeepSeekProviderConfigPath(options),
    secretsPath: getOmkSecretsEnvPath(options),
  };
}

function resolveHomeDir(options: DeepSeekConfigPathOptions): string {
  return options.homeDir ?? getUserHome(options.env ?? process.env);
}

function emptyProvidersConfig(): OmkProvidersConfig {
  return {
    version: 1,
    providers: {},
  };
}

function normalizeDeepSeekProviderConfig(value: unknown): DeepSeekProviderConfig {
  if (!isRecord(value)) return {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
    disabledAt: typeof value.disabledAt === "string" ? value.disabledAt : undefined,
    disabledReason: typeof value.disabledReason === "string" ? value.disabledReason : undefined,
    disabledBy: isDeepSeekDisabledBy(value.disabledBy) ? value.disabledBy : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    apiKeyEnv: typeof value.apiKeyEnv === "string" && value.apiKeyEnv.trim() ? value.apiKeyEnv : undefined,
    model: typeof value.model === "string" && value.model.trim() ? value.model : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDeepSeekDisabledBy(value: unknown): value is DeepSeekDisabledBy {
  return value === "user" || value === "provider-402" || value === "provider-availability";
}

async function upsertEnvFileValue(path: string, name: string, value: string): Promise<void> {
  const existing = await readFile(path, "utf-8").catch(() => "");
  const linePattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`);
  const nextLine = `export ${name}=${shellSingleQuote(value)}`;
  let replaced = false;

  const lines = existing.split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === ""));
  const nextLines = lines.map((line) => {
    if (linePattern.test(line)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });
  if (!replaced) nextLines.push(nextLine);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, nextLines.join("\n") + "\n", { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readEnvFileValue(path: string, name: string): Promise<string | undefined> {
  const raw = await readFile(path, "utf-8").catch(() => null);
  if (!raw) return undefined;

  const linePattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=\\s*(.*)\\s*$`);
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    const parsed = parseEnvValue(match[1] ?? "");
    if (parsed.trim()) return parsed.trim();
  }
  return undefined;
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { join } from "path";
import { readSimpleToml, getProjectRoot } from "./resource-profile.js";

export interface RuntimeProfile {
  /** LLM model identifier (e.g. "kimi-k2-6") */
  model?: string;
  /** Enable/disable thinking mode */
  thinking?: boolean;
  /** Model variant hint (used as profile alias when CLI does not support it) */
  variant?: string;
  /** Sampling temperature (only passed to CLI when supported) */
  temperature?: number;
  /** Nucleus sampling top-p (only passed to CLI when supported) */
  topP?: number;
  /** Max output size in MB (mapped to env or prompt policy) */
  maxOutputMb?: number;
}

const ROLE_DEFAULTS: Record<string, RuntimeProfile> = {
  coder: { thinking: true, temperature: 0.15, topP: 0.85, variant: "coding" },
  planner: { thinking: true, temperature: 0.25, topP: 0.9, variant: "deep" },
  architect: { thinking: true, temperature: 0.25, topP: 0.9, variant: "deep" },
  reviewer: { thinking: true, temperature: 0.05, topP: 0.75, variant: "standard" },
  qa: { thinking: true, temperature: 0.05, topP: 0.75, variant: "standard" },
  security: { thinking: true, temperature: 0.05, topP: 0.75, variant: "standard" },
  tester: { thinking: true, temperature: 0.05, topP: 0.75, variant: "standard" },
  explorer: { thinking: true, temperature: 0.2, topP: 0.85, variant: "balanced" },
  researcher: { thinking: false, temperature: 0.3, topP: 0.9, variant: "fast" },
  docs: { thinking: false, temperature: 0.3, topP: 0.9, variant: "fast" },
  merger: { thinking: true, temperature: 0.1, topP: 0.8, variant: "conservative" },
  release: { thinking: true, temperature: 0.1, topP: 0.8, variant: "conservative" },
  integrator: { thinking: true, temperature: 0.1, topP: 0.8, variant: "conservative" },
  "vision-debugger": { thinking: true, temperature: 0.15, topP: 0.85, variant: "vision" },
};

let profileCache: Record<string, RuntimeProfile> | undefined;

/**
 * Resolve a RuntimeProfile for the given agent role.
 * Merges: role hard-coded defaults → .omk/config.toml [router.profiles.<role>] → env overrides.
 */
export async function resolveRuntimeProfile(role: string): Promise<RuntimeProfile> {
  const defaults = ROLE_DEFAULTS[role] ?? { thinking: true, temperature: 0.2, topP: 0.85, variant: "balanced" };
  const config = await loadProfileConfig(role);
  const env = envProfileOverrides();

  return {
    ...defaults,
    ...config,
    ...env,
    // Allow env to explicitly disable thinking by string "false"
    thinking: env.thinking !== undefined ? env.thinking : config.thinking !== undefined ? config.thinking : defaults.thinking,
  };
}

/**
 * Reset cached profile config (mainly for tests).
 */
export function resetRuntimeProfileCache(): void {
  profileCache = undefined;
}

async function loadProfileConfig(role: string): Promise<RuntimeProfile> {
  if (!profileCache) {
    profileCache = await readProfileConfigs();
  }
  return profileCache[role] ?? {};
}

async function readProfileConfigs(): Promise<Record<string, RuntimeProfile>> {
  const path = join(getProjectRoot(), ".omk", "config.toml");
  const flat = await readSimpleToml(path);
  const profiles: Record<string, RuntimeProfile> = {};

  for (const [key, value] of Object.entries(flat)) {
    const m = key.match(/^router\.profiles\.([A-Za-z0-9_-]+)\.(model|thinking|variant|temperature|topP|top_p|max_output_mb|maxOutputMb)$/);
    if (!m) continue;

    const [, role, field] = m;
    const p = (profiles[role] ??= {});

    switch (field) {
      case "model":
        p.model = value;
        break;
      case "thinking":
        p.thinking = parseBoolean(value);
        break;
      case "variant":
        p.variant = value;
        break;
      case "temperature":
        p.temperature = parseFloatValue(value);
        break;
      case "topP":
      case "top_p":
        p.topP = parseFloatValue(value);
        break;
      case "max_output_mb":
      case "maxOutputMb":
        p.maxOutputMb = parseFloatValue(value);
        break;
    }
  }

  return profiles;
}

function envProfileOverrides(): Partial<RuntimeProfile> {
  const env = process.env;
  const result: Partial<RuntimeProfile> = {};

  if (env.OMK_MODEL) result.model = env.OMK_MODEL;
  if (env.OMK_THINKING !== undefined) {
    const parsed = parseBoolean(env.OMK_THINKING);
    if (parsed !== undefined) result.thinking = parsed;
  }
  if (env.OMK_VARIANT) result.variant = env.OMK_VARIANT;
  if (env.OMK_TEMPERATURE !== undefined) {
    const t = parseFloatValue(env.OMK_TEMPERATURE);
    if (t !== undefined) result.temperature = t;
  }
  if (env.OMK_TOP_P !== undefined) {
    const p = parseFloatValue(env.OMK_TOP_P);
    if (p !== undefined) result.topP = p;
  }
  if (env.OMK_MAX_OUTPUT_MB !== undefined) {
    const m = parseFloatValue(env.OMK_MAX_OUTPUT_MB);
    if (m !== undefined) result.maxOutputMb = m;
  }

  return result;
}

function parseBoolean(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return undefined;
}

function parseFloatValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build CLI args for a profile, filtering by capability.
 * Unsupported flags are silently omitted (soft fallback).
 */
export function buildProfileArgs(profile: RuntimeProfile, caps: { model: boolean; thinking: boolean; temperature: boolean; topP: boolean; variant: boolean }): string[] {
  const args: string[] = [];

  if (caps.model && profile.model) {
    args.push("--model", profile.model);
  }

  if (caps.thinking && profile.thinking !== undefined) {
    args.push(profile.thinking ? "--thinking" : "--no-thinking");
  }

  if (caps.temperature && profile.temperature !== undefined) {
    args.push("--temperature", String(profile.temperature));
  }

  if (caps.topP && profile.topP !== undefined) {
    args.push("--top-p", String(profile.topP));
  }

  if (caps.variant && profile.variant) {
    args.push("--variant", profile.variant);
  }

  return args;
}

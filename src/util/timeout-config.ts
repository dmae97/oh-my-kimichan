import { readSimpleToml, getProjectRoot } from "./resource-profile.js";
import { join } from "path";
import type { TimeoutPreset } from "../contracts/orchestration.js";

const DEFAULT_PRESETS: Record<string, TimeoutPreset> = {
  default: { name: "default", timeoutMs: 120_000, description: "Default 2-minute timeout" },
  quick: { name: "quick", timeoutMs: 30_000, description: "Quick 30-second timeout for simple tasks" },
  standard: { name: "standard", timeoutMs: 120_000, description: "Standard 2-minute timeout" },
  "long-running": { name: "long-running", timeoutMs: 1_800_000, description: "Long-running 30-minute timeout" },
  unlimited: { name: "unlimited", timeoutMs: 0, description: "No timeout (use with caution)" },
};

let presetCache: Promise<Record<string, TimeoutPreset>> | undefined;

/**
 * Resolve timeout presets from .omk/config.toml [timeouts.<preset>] sections.
 * Merges: built-in defaults → config overrides → env override for default.
 */
export async function resolveTimeoutPresets(): Promise<Record<string, TimeoutPreset>> {
  presetCache ??= loadTimeoutPresets();
  return presetCache;
}

/**
 * Reset cached preset config (mainly for tests).
 */
export function resetTimeoutPresetCache(): void {
  presetCache = undefined;
}

/**
 * Resolve the effective timeout in milliseconds for a node or run.
 * Priority: per-node timeoutMs > preset > env OMK_NODE_TIMEOUT_MS > default preset.
 */
export async function resolveTimeoutMs(options: {
  timeoutMs?: number;
  timeoutPreset?: string;
}): Promise<number> {
  // 1. Explicit per-node timeout wins
  if (options.timeoutMs !== undefined && options.timeoutMs >= 0) {
    return options.timeoutMs;
  }

  // 2. Preset lookup
  const presets = await resolveTimeoutPresets();
  const requestedPreset = options.timeoutPreset?.trim();
  const presetName = requestedPreset && requestedPreset.length > 0 ? requestedPreset : "default";
  const preset = presets[presetName];
  if (preset) {
    return preset.timeoutMs;
  }

  const validPresets = Object.keys(presets).sort().join(", ");
  throw new Error(`Unknown timeout preset "${presetName}". Valid presets: ${validPresets}`);
}

async function loadTimeoutPresets(): Promise<Record<string, TimeoutPreset>> {
  const path = join(getProjectRoot(), ".omk", "config.toml");
  const flat = await readSimpleToml(path);
  const presets: Record<string, TimeoutPreset> = { ...DEFAULT_PRESETS };

  for (const [key, value] of Object.entries(flat)) {
    const m = key.match(/^timeouts\.([A-Za-z0-9_-]+)\.(timeout_ms|timeout_minutes|description)$/);
    if (!m) continue;

    const [, presetName, field] = m;
    const preset = (presets[presetName] ??= { name: presetName, timeoutMs: 0 });

    switch (field) {
      case "timeout_ms": {
        const ms = parsePositiveInt(value);
        if (ms !== undefined) preset.timeoutMs = ms;
        break;
      }
      case "timeout_minutes": {
        const minutes = parsePositiveNumber(value);
        if (minutes !== undefined) preset.timeoutMs = Math.round(minutes * 60_000);
        break;
      }
      case "description":
        preset.description = value;
        break;
    }
  }

  // Env override for the default preset
  const envTimeout = parsePositiveInt(process.env.OMK_NODE_TIMEOUT_MS);
  if (envTimeout !== undefined) {
    presets.default = { ...presets.default, timeoutMs: envTimeout };
  }

  return presets;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

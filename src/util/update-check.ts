import { readTextFile, writeFileSafe, pathExists } from "./fs.js";
import { getOmkVersionSync } from "./version.js";
import { getKimiCapabilities } from "../kimi/capability.js";
import { runShell } from "./shell.js";
import { join } from "path";
import { homedir } from "os";

export interface UpdateStatus {
  omk: PackageUpdateStatus;
  kimi: KimiUpdateStatus;
  checkedAt: string;
  cacheHit: boolean;
}

export interface PackageUpdateStatus {
  current: string;
  latest: string | null;
  outdated: boolean;
  error: string | null;
  installCmd: string;
}

export interface KimiUpdateStatus {
  installed: string | null;
  latest: string | null;
  outdated: boolean;
  error: string | null;
  installCmd: string;
  fallbackInstallCmd: string;
  installScript: string;
}

interface UpdateCache {
  omkLatest: string | null;
  kimiLatest: string | null;
  checkedAt: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const FALLBACK_INSTALL_SCRIPT = process.platform === "win32"
  ? "Invoke-Expression (New-Object System.Net.WebClient).DownloadString('https://code.kimi.com/install.ps1')"
  : "curl -LsSf https://code.kimi.com/install.sh | bash";

function getCachePath(): string {
  return join(homedir(), ".omk", "update-cache.json");
}

async function readCache(): Promise<UpdateCache | null> {
  const cachePath = getCachePath();
  if (!(await pathExists(cachePath))) return null;

  try {
    const raw = await readTextFile(cachePath);
    const parsed = JSON.parse(raw) as UpdateCache;
    const age = Date.now() - new Date(parsed.checkedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  const cachePath = getCachePath();
  try {
    await writeFileSafe(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // non-fatal
  }
}

export function parseSemverParts(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  return 0;
}

export function isOutdated(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0;
}

async function fetchOmkLatest(): Promise<string | null> {
  try {
    const result = await runShell("npm", ["view", "@oh-my-kimi/cli", "version"], {
      timeout: 8000,
    });
    if (result.failed) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

async function fetchKimiLatest(): Promise<string | null> {
  // Primary: PyPI JSON API via native fetch
  try {
    const url = "https://pypi.org/pypi/kimi-cli/json";
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { info?: { version?: string } };
    if (data.info?.version && /^\d+\.\d+\.\d+/.test(data.info.version)) {
      return data.info.version;
    }
  } catch {
    // fall through to uv
  }

  // Fallback: uv tool upgrade --dry-run
  try {
    const uvResult = await runShell("uv", ["tool", "upgrade", "kimi-cli", "--dry-run"], {
      timeout: 10000,
    });
    if (uvResult.failed) return null;
    const match = uvResult.stdout.match(/(?:Would upgrade kimi-cli|kimi-cli)\s+(?:from\s+\S+\s+to\s+)?(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    // ignore
  }

  return null;
}

async function getKimiInstalledVersion(): Promise<string | null> {
  try {
    const caps = getKimiCapabilities();
    return caps.version;
  } catch {
    return null;
  }
}

export async function checkUpdates(forceRefresh = false): Promise<UpdateStatus> {
  const cached = forceRefresh ? null : await readCache();
  const cacheHit = cached !== null;

  const omkCurrent = getOmkVersionSync();
  const kimiInstalled = await getKimiInstalledVersion();

  let omkLatest: string | null = cached?.omkLatest ?? null;
  let kimiLatest: string | null = cached?.kimiLatest ?? null;

  if (!cacheHit) {
    const [omk, kimi] = await Promise.all([
      fetchOmkLatest(),
      fetchKimiLatest(),
    ]);
    omkLatest = omk;
    kimiLatest = kimi;

    await writeCache({
      omkLatest,
      kimiLatest,
      checkedAt: new Date().toISOString(),
    });
  }

  const omkOutdated = !!omkLatest && isOutdated(omkCurrent, omkLatest);
  const kimiOutdated = !!kimiLatest && !!kimiInstalled && isOutdated(kimiInstalled, kimiLatest);

  let omkError: string | null = null;
  let kimiError: string | null = null;

  if (!omkLatest && !cacheHit) omkError = "registry unreachable";
  if (!kimiLatest && !cacheHit) kimiError = "PyPI unreachable";

  return {
    omk: {
      current: omkCurrent,
      latest: omkLatest,
      outdated: omkOutdated,
      error: omkError,
      installCmd: "npm i -g @oh-my-kimi/cli",
    },
    kimi: {
      installed: kimiInstalled,
      latest: kimiLatest,
      outdated: kimiOutdated,
      error: kimiError,
      installCmd: "uv tool upgrade kimi-cli --no-cache",
      installScript: process.platform === "win32"
        ? "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression"
        : "curl -LsSf https://code.kimi.com/install.sh | bash",
      fallbackInstallCmd: FALLBACK_INSTALL_SCRIPT,
    },
    checkedAt: new Date().toISOString(),
    cacheHit,
  };
}

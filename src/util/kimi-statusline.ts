import { style } from "./theme.js";
import { formatKimiUsageInline, getKimiUsage, type UsageStats } from "./kimi-usage.js";

const STATUS_VALUE = String.raw`[^\s|\r\n]+`;
const CONTEXT_BASE = String.raw`context:\s*\d+(?:\.\d+)?%\s*(?:\([^\r\n)]*\))?`;
const CONTEXT_WITH_TOKENS_RE = new RegExp(String.raw`${CONTEXT_BASE}\s*\|\s*in:${STATUS_VALUE}\s+out:${STATUS_VALUE}`, "g");
const CONTEXT_BASE_ONLY_RE = new RegExp(String.raw`${CONTEXT_BASE}(?!\s*(?:\(|\|\s*(?:in:|omk:)))`, "g");

export interface KimiStatusLineEnhancerOptions {
  refreshMs?: number;
  initialUsage?: UsageStats;
  disabled?: boolean;
}

export function enhanceKimiContextStatusLine(data: string, inlineUsage: string, colorize = true): string {
  if (!inlineUsage || !data.includes("context:")) return data;
  const segment = colorize ? style.gray(" | ") + style.mint(`omk:${inlineUsage}`) : ` | omk:${inlineUsage}`;
  const appendOnce = (match: string, offset: number, full: string): string => {
    const tail = full.slice(offset + match.length, offset + match.length + 32);
    return /^\s*\|\s*omk:/.test(tail) ? match : `${match}${segment}`;
  };
  return data
    .replace(CONTEXT_WITH_TOKENS_RE, appendOnce)
    .replace(CONTEXT_BASE_ONLY_RE, appendOnce);
}

export class KimiStatusLineEnhancer {
  private usage?: UsageStats;
  private refreshPromise?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private lastRefreshMs = 0;
  private readonly refreshMs: number;
  private readonly disabled: boolean;

  constructor(options: KimiStatusLineEnhancerOptions = {}) {
    this.usage = options.initialUsage;
    this.refreshMs = options.refreshMs ?? 60_000;
    this.disabled = options.disabled ?? isDisabledByEnv();
  }

  static async create(options: KimiStatusLineEnhancerOptions = {}): Promise<KimiStatusLineEnhancer> {
    if (options.disabled ?? isDisabledByEnv()) return new KimiStatusLineEnhancer({ ...options, disabled: true });
    const initialUsage = options.initialUsage ?? await getKimiUsage().catch(() => undefined);
    const enhancer = new KimiStatusLineEnhancer({ ...options, initialUsage });
    if (initialUsage) enhancer.lastRefreshMs = Date.now();
    enhancer.startBackgroundRefresh();
    return enhancer;
  }

  process(data: string): string {
    if (this.disabled || !data.includes("context:")) return data;
    this.refreshIfNeeded();
    if (!this.usage) return data;
    return enhanceKimiContextStatusLine(data, formatKimiUsageInline(this.usage));
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private startBackgroundRefresh(): void {
    if (this.disabled) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
    this.timer.unref?.();
  }

  private refreshIfNeeded(): void {
    if (this.disabled || this.refreshPromise) return;
    if (Date.now() - this.lastRefreshMs < this.refreshMs) return;
    // Opportunistic refresh keeps the status line current even if the interval was delayed.
    this.refreshPromise = this.refresh().finally(() => {
      this.refreshPromise = undefined;
    });
  }

  private async refresh(): Promise<void> {
    const next = await getKimiUsage().catch(() => undefined);
    if (next) {
      this.usage = next;
    }
    this.lastRefreshMs = Date.now();
  }
}

function isDisabledByEnv(): boolean {
  const value = process.env.OMK_KIMI_STATUS_USAGE;
  return value === "0" || value === "false" || value === "off" || value === "no";
}

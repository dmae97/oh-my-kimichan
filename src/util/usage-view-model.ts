import { formatDuration, type UsageStats } from "./kimi-usage.js";

export interface UsageViewModel {
  accountLabel: string;
  authStatus: string;
  source: "remoteQuota" | "localSessionFallback" | "missingAuth" | "networkError";
  fiveHour: {
    percent: number | null;
    label: string;
    resetHint?: string;
  };
  weekly: {
    percent: number | null;
    label: string;
    resetHint?: string;
  };
  today: {
    label: string;
    sessionCount: number;
  };
  error?: string;
}

export function buildUsageViewModel(stats: UsageStats): UsageViewModel {
  const accountLabel = stats.oauth.displayId;
  const authStatus = stats.oauth.tokenStatus;

  let source: UsageViewModel["source"];
  if (!stats.oauth.loggedIn) {
    source = "missingAuth";
  } else if (stats.quota.error && stats.quota.rows.length === 0) {
    source = "networkError";
  } else if (stats.quota.rows.length === 0) {
    source = "localSessionFallback";
  } else {
    source = "remoteQuota";
  }

  const fiveHour = source === "missingAuth"
    ? { percent: null as number | null, label: "login required" }
    : buildWindowViewModel(stats.quota.fiveHour, stats.totalSecondsLast5Hours);

  const weekly = source === "missingAuth"
    ? { percent: null as number | null, label: "login required" }
    : buildWindowViewModel(stats.quota.weekly, stats.totalSecondsWeek);

  return {
    accountLabel,
    authStatus,
    source,
    fiveHour,
    weekly,
    today: {
      label: formatDuration(stats.totalSecondsToday),
      sessionCount: stats.sessionCountToday,
    },
    error: stats.quota.error,
  };
}

function buildWindowViewModel(
  row: { remainingPercent: number | null; resetHint?: string } | undefined,
  fallbackSeconds: number
): UsageViewModel["fiveHour"] {
  if (row && row.remainingPercent !== null) {
    const usedPercent = Math.min(100, Math.max(0, 100 - row.remainingPercent));
    return {
      percent: usedPercent,
      label: `${usedPercent}% used`,
      resetHint: row.resetHint,
    };
  }
  if (row && row.remainingPercent === null) {
    return {
      percent: null,
      label: "unknown",
      resetHint: row.resetHint,
    };
  }
  return {
    percent: null,
    label: formatDuration(fallbackSeconds),
  };
}

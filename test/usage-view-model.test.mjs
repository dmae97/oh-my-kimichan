import test from "node:test";
import assert from "node:assert/strict";

import { buildUsageViewModel } from "../dist/util/usage-view-model.js";

function makeStats(overrides = {}) {
  return {
    totalSecondsToday: 3600,
    sessionCountToday: 2,
    totalSecondsLast5Hours: 1800,
    sessionCountLast5Hours: 1,
    totalSecondsWeek: 7200,
    sessionCountWeek: 3,
    oauth: { loggedIn: true, displayId: "de…r@example.com", tokenStatus: "valid", source: "kimi-code" },
    quota: { rows: [], fetchedAt: undefined, error: undefined, fiveHour: undefined, weekly: undefined },
    ...overrides,
  };
}

test("remote quota available → correct percentages and labels", () => {
  const stats = makeStats({
    quota: {
      rows: [
        { label: "5h limit", used: 1, limit: 10, remaining: 9, remainingPercent: 90, window: "5h" },
        { label: "Weekly limit", used: 20, limit: 100, remaining: 80, remainingPercent: 80, window: "weekly" },
      ],
      fiveHour: { label: "5h limit", used: 1, limit: 10, remaining: 9, remainingPercent: 90, window: "5h" },
      weekly: { label: "Weekly limit", used: 20, limit: 100, remaining: 80, remainingPercent: 80, window: "weekly" },
    },
  });

  const vm = buildUsageViewModel(stats);
  assert.equal(vm.source, "remoteQuota");
  assert.equal(vm.fiveHour.percent, 10);
  assert.equal(vm.fiveHour.label, "10% used");
  assert.equal(vm.weekly.percent, 20);
  assert.equal(vm.weekly.label, "20% used");
  assert.equal(vm.today.label, "1h 0m");
  assert.equal(vm.today.sessionCount, 2);
});

test("not logged in → missingAuth, login required labels", () => {
  const stats = makeStats({
    oauth: { loggedIn: false, displayId: "/login", tokenStatus: "missing", source: "none" },
  });

  const vm = buildUsageViewModel(stats);
  assert.equal(vm.source, "missingAuth");
  assert.equal(vm.authStatus, "missing");
  assert.equal(vm.accountLabel, "/login");
  assert.equal(vm.fiveHour.label, "login required");
  assert.equal(vm.fiveHour.percent, null);
  assert.equal(vm.weekly.label, "login required");
  assert.equal(vm.weekly.percent, null);
  assert.equal(vm.today.label, "1h 0m");
  assert.equal(vm.today.sessionCount, 2);
});

test("network error → networkError, fallback labels", () => {
  const stats = makeStats({
    quota: { rows: [], error: "usage endpoint HTTP 503" },
  });

  const vm = buildUsageViewModel(stats);
  assert.equal(vm.source, "networkError");
  assert.equal(vm.error, "usage endpoint HTTP 503");
  assert.equal(vm.fiveHour.label, "30m");
  assert.equal(vm.fiveHour.percent, null);
  assert.equal(vm.weekly.label, "2h 0m");
  assert.equal(vm.weekly.percent, null);
});

test("limit 0/missing → unknown label, percent = null", () => {
  const stats = makeStats({
    quota: {
      rows: [
        { label: "5h limit", used: 0, limit: 0, remaining: 0, remainingPercent: null, window: "5h" },
      ],
      fiveHour: { label: "5h limit", used: 0, limit: 0, remaining: 0, remainingPercent: null, window: "5h" },
    },
  });

  const vm = buildUsageViewModel(stats);
  assert.equal(vm.fiveHour.percent, null);
  assert.equal(vm.fiveHour.label, "unknown");
});

test("local session fallback when no quota rows and no error", () => {
  const stats = makeStats({
    quota: { rows: [] },
  });

  const vm = buildUsageViewModel(stats);
  assert.equal(vm.source, "localSessionFallback");
  assert.equal(vm.fiveHour.label, "30m");
  assert.equal(vm.weekly.label, "2h 0m");
});

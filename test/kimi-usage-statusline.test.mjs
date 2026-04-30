import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getKimiUsage, formatKimiUsageInline } from "../dist/util/kimi-usage.js";
import { enhanceKimiContextStatusLine } from "../dist/util/kimi-statusline.js";

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("Kimi usage masks OAuth identity and parses 5h/weekly quota", async () => {
  const home = await mkdtemp(join(tmpdir(), "omk-kimi-usage-"));
  try {
    await mkdir(join(home, ".kimi", "credentials"), { recursive: true });
    await writeFile(
      join(home, ".kimi", "credentials", "kimi-code.json"),
      JSON.stringify({
        access_token: fakeJwt({ email: "developer@example.com", exp: 4102444800 }),
        expires_at: 4102444800,
        token_type: "Bearer",
      })
    );

    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          usage: { name: "Weekly limit", used: 20, limit: 100 },
          limits: [
            { window: { duration: 5, timeUnit: "HOUR" }, detail: { used: 3, limit: 10 } },
          ],
        };
      },
    });

    const usage = await getKimiUsage({ homeDir: home, fetchImpl, nowMs: Date.UTC(2026, 4, 1) });

    assert.equal(usage.oauth.loggedIn, true);
    assert.equal(usage.oauth.displayId, "de…r@example.com");
    assert.equal(usage.quota.weekly?.remainingPercent, 80);
    assert.equal(usage.quota.fiveHour?.remainingPercent, 70);
    assert.equal(formatKimiUsageInline(usage), "acct:de…r@example.com | 5h:70% left | wk:80% left");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Kimi context status line is augmented once", () => {
  const input = "context: 35.6% (93.2k/262.1k) | in:93.2k out:1.8k";
  const once = enhanceKimiContextStatusLine(input, "acct:oauth:abc | 5h:70% left | wk:80% left", false);
  const twice = enhanceKimiContextStatusLine(once, "acct:oauth:abc | 5h:70% left | wk:80% left", false);

  assert.equal(once, "context: 35.6% (93.2k/262.1k) | in:93.2k out:1.8k | omk:acct:oauth:abc | 5h:70% left | wk:80% left");
  assert.equal(twice, once);
});

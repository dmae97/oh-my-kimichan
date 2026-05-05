import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCronEngine, loadCronJobs, mergeCronRuntimeState, validateCronJobName } from "../dist/util/cron-engine.js";
import { executeCronDag } from "../dist/commands/cron.js";
import { resetOmkResourceSettingsCache } from "../dist/util/resource-profile.js";

async function withTempProject(fn) {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-cron-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousProfile = process.env.OMK_RESOURCE_PROFILE;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.OMK_RESOURCE_PROFILE = "lite";
  resetOmkResourceSettingsCache();

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "config.toml"), "approval_policy = \"yolo\"\n", "utf-8");
    return await fn(projectRoot);
  } finally {
    restoreEnv("OMK_PROJECT_ROOT", previousRoot);
    restoreEnv("OMK_RESOURCE_PROFILE", previousProfile);
    resetOmkResourceSettingsCache();
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function cronJob(overrides = {}) {
  return {
    name: "docs",
    schedule: "@manual",
    dagFile: "dag.json",
    concurrencyPolicy: "allow",
    enabled: true,
    catchup: false,
    ...overrides,
  };
}

test("cron engine executes initial jobs and persists run logs", async () => {
  await withTempProject(async (projectRoot) => {
    const seen = [];
    const engine = createCronEngine(async (job) => {
      seen.push(job.name);
    }, { jobs: [cronJob()] });

    const run = await engine.runJobNow("docs");

    assert.equal(run?.jobName, "docs");
    assert.equal(run?.success, true);
    assert.deepEqual(seen, ["docs"]);

    const files = await readdir(join(projectRoot, ".omk", "cron-runs", "docs"));
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);

    const runs = await engine.getRuns("docs");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, run?.runId);
  });
});

test("cron getRuns reads persisted JSON files and skips malformed logs", async () => {
  await withTempProject(async (projectRoot) => {
    const runsDir = join(projectRoot, ".omk", "cron-runs", "docs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "b.json"), JSON.stringify({
      jobName: "docs",
      runId: "b",
      startedAt: "2026-05-05T02:00:00.000Z",
      success: true,
      logPath: "b.json",
    }), "utf-8");
    await writeFile(join(runsDir, "a.json"), JSON.stringify({
      jobName: "docs",
      runId: "a",
      startedAt: "2026-05-05T01:00:00.000Z",
      success: false,
      logPath: "a.json",
      error: "boom",
    }), "utf-8");
    await writeFile(join(runsDir, "bad.json"), "{not-json", "utf-8");

    const engine = createCronEngine(async () => {});
    const runs = await engine.getRuns("docs");

    assert.deepEqual(runs.map((run) => run.runId), ["a", "b"]);
  });
});

test("cron refresh preserves computed nextRunAt across config reloads", () => {
  const previousNextRunAt = "2999-01-01T00:00:00.000Z";
  const previous = [cronJob({ schedule: "@every 30s", nextRunAt: previousNextRunAt })];
  const loaded = [cronJob({ schedule: "@every 30s", nextRunAt: undefined })];

  const merged = mergeCronRuntimeState(loaded, previous, Date.parse("2026-05-05T00:00:00.000Z"));

  assert.equal(merged[0].nextRunAt, previousNextRunAt);
});

test("cron DAG execution runs the DAG executor with an injected runner", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(join(projectRoot, "dag.json"), JSON.stringify({
      nodes: [
        { id: "one", name: "One", role: "coder", dependsOn: [], maxRetries: 1 },
      ],
    }), "utf-8");

    const seen = [];
    const runner = {
      async run(node, env) {
        seen.push({ id: node.id, runId: env.OMK_RUN_ID });
        return { success: true, stdout: "ok", stderr: "" };
      },
    };

    await executeCronDag(cronJob(), {
      root: projectRoot,
      runId: "cron-dag-test",
      runner,
      approvalPolicy: "yolo",
    });

    assert.deepEqual(seen, [{ id: "one", runId: "cron-dag-test" }]);
    const state = JSON.parse(await readFile(join(projectRoot, ".omk", "runs", "cron-dag-test", "state.json"), "utf-8"));
    assert.equal(state.nodes[0].status, "done");
  });
});

test("cron job names reject traversal and path separators before filesystem IO", async () => {
  await withTempProject(async () => {
    const engine = createCronEngine(async () => {}, { jobs: [cronJob({ name: "../escape" })] });

    assert.throws(() => validateCronJobName("../escape"), /Invalid cron job name/);
    await assert.rejects(() => engine.runJobNow("../escape"), /Invalid cron job name/);
    await assert.rejects(() => engine.getRuns("../escape"), /Invalid cron job name/);
  });
});

test("cron config parse errors are surfaced instead of treated as empty config", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(join(projectRoot, ".omk", "cron.yml"), "jobs:\n  - name: [unterminated\n", "utf-8");

    await assert.rejects(() => loadCronJobs(), /Failed to load cron config/);
  });
});

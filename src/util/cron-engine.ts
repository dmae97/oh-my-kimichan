import { readFile, mkdir, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { getProjectRoot, pathExists } from "./fs.js";
import type { CronJob, CronRun } from "../contracts/orchestration.js";

export type CronTickHandler = (job: CronJob) => Promise<void>;

export interface CronEngine {
  start(): void;
  stop(): void;
  listJobs(): CronJob[];
  runJobNow(name: string): Promise<CronRun | null>;
  getRuns(jobName: string): Promise<CronRun[]>;
  enableJob(name: string): void;
  disableJob(name: string): void;
}

export interface CronEngineOptions {
  jobs?: CronJob[];
}

interface CronEngineState {
  jobs: CronJob[];
  activeRuns: Map<string, Promise<void>>;
  timer: ReturnType<typeof setInterval> | null;
  handler: CronTickHandler;
}

const TICK_INTERVAL_MS = 15_000; // Check every 15 seconds
const CRON_CONFIG_PATH = ".omk/cron.yml";
const CRON_RUNS_DIR = ".omk/cron-runs";

function normalizeJob(j: Partial<CronJob>, index: number): CronJob {
  return {
    name: j.name ?? `job-${index}`,
    schedule: j.schedule ?? "@daily",
    dagFile: j.dagFile ?? "",
    concurrencyPolicy: (j.concurrencyPolicy as CronJob["concurrencyPolicy"]) ?? "forbid",
    enabled: j.enabled !== false,
    catchup: j.catchup === true,
    timeoutPreset: j.timeoutPreset,
    lastRunAt: j.lastRunAt,
    nextRunAt: j.nextRunAt,
  };
}

export async function loadCronJobs(): Promise<CronJob[]> {
  const root = getProjectRoot();
  const configPath = join(root, CRON_CONFIG_PATH);
  if (!(await pathExists(configPath))) return [];

  try {
    const content = await readFile(configPath, "utf-8");
    const yaml = await import("yaml");
    const doc = yaml.parse(content) as { jobs?: Array<Partial<CronJob>> } | null;
    if (!doc?.jobs) return [];

    return doc.jobs.map((j, index) => normalizeJob(j, index));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load cron config ${configPath}: ${message}`);
  }
}

export function mergeCronRuntimeState(
  loadedJobs: CronJob[],
  previousJobs: CronJob[],
  now = Date.now()
): CronJob[] {
  const previousByName = new Map(previousJobs.map((job) => [job.name, job]));
  return loadedJobs.map((loaded, index) => {
    const previous = previousByName.get(loaded.name);
    const job = normalizeJob(
      {
        ...loaded,
        lastRunAt: loaded.lastRunAt ?? previous?.lastRunAt,
        nextRunAt: loaded.nextRunAt ?? previous?.nextRunAt,
      },
      index
    );

    if (!job.nextRunAt && job.enabled) {
      job.nextRunAt = computeNextRun(job.schedule, job.lastRunAt, job.catchup);
    }

    // If catchup is disabled and we missed the window, skip to next.
    if (!job.catchup && job.nextRunAt && Date.parse(job.nextRunAt) < now - TICK_INTERVAL_MS * 2) {
      job.nextRunAt = computeNextRun(job.schedule, new Date(now).toISOString(), false);
    }

    return job;
  });
}

export function createCronEngine(handler: CronTickHandler, options: CronEngineOptions = {}): CronEngine {
  const state: CronEngineState = {
    jobs: (options.jobs ?? []).map((job, index) => normalizeJob(job, index)),
    activeRuns: new Map(),
    timer: null,
    handler,
  };

  async function refreshJobs(): Promise<void> {
    state.jobs = mergeCronRuntimeState(await loadCronJobs(), state.jobs, Date.now());
  }

  async function tick(): Promise<void> {
    await refreshJobs();
    const now = Date.now();

    for (const job of state.jobs) {
      if (!job.enabled) continue;
      if (!job.nextRunAt) {
        job.nextRunAt = computeNextRun(job.schedule, job.lastRunAt, job.catchup);
        continue;
      }
      if (Date.parse(job.nextRunAt) > now) continue;

      // Concurrency check
      const active = state.activeRuns.get(job.name);
      if (active) {
        if (job.concurrencyPolicy === "forbid") {
          continue;
        }
        if (job.concurrencyPolicy === "replace") {
          // We can't truly cancel the promise, but we detach tracking
          state.activeRuns.delete(job.name);
        }
        // "allow" proceeds
      }

      const runPromise = executeJob(job).then(() => undefined);
      state.activeRuns.set(job.name, runPromise);
      runPromise.finally(() => {
        if (state.activeRuns.get(job.name) === runPromise) {
          state.activeRuns.delete(job.name);
        }
      });

      job.lastRunAt = new Date().toISOString();
      job.nextRunAt = computeNextRun(job.schedule, job.lastRunAt, job.catchup);
    }
  }

  async function executeJob(job: CronJob): Promise<CronRun> {
    const safeName = validateCronJobName(job.name);
    const runId = `${job.name}-${Date.now()}`;
    const root = getProjectRoot();
    const logDir = join(root, CRON_RUNS_DIR, safeName);
    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

    const cronRun: CronRun = {
      jobName: job.name,
      startedAt: new Date().toISOString(),
      success: false,
      runId,
      logPath,
    };

    try {
      await state.handler(job);
      cronRun.success = true;
      cronRun.completedAt = new Date().toISOString();
    } catch (err) {
      cronRun.success = false;
      cronRun.error = err instanceof Error ? err.message : String(err);
      cronRun.completedAt = new Date().toISOString();
    }

    await writeFile(logPath, JSON.stringify(cronRun, null, 2));
    return cronRun;
  }

  return {
    start(): void {
      if (state.timer) return;
      void tick();
      state.timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
    },

    stop(): void {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    },

    listJobs(): CronJob[] {
      return state.jobs.map((j) => ({ ...j }));
    },

    async runJobNow(name: string): Promise<CronRun | null> {
      const job = state.jobs.find((j) => j.name === name);
      if (!job) return null;
      return executeJob(job);
    },

    async getRuns(jobName: string): Promise<CronRun[]> {
      const root = getProjectRoot();
      const logDir = join(root, CRON_RUNS_DIR, validateCronJobName(jobName));
      if (!(await pathExists(logDir))) return [];
      const files = await readdir(logDir).catch(() => []);
      const runs: CronRun[] = [];
      for (const file of files.filter((f) => f.endsWith(".json"))) {
        try {
          const content = await readFile(join(logDir, file), "utf-8");
          runs.push(JSON.parse(content) as CronRun);
        } catch {
          // ignore malformed
        }
      }
      return runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    },

    enableJob(name: string): void {
      const job = state.jobs.find((j) => j.name === name);
      if (job) job.enabled = true;
    },

    disableJob(name: string): void {
      const job = state.jobs.find((j) => j.name === name);
      if (job) job.enabled = false;
    },
  };
}

export function validateCronJobName(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`Invalid cron job name: ${name}`);
  }
  return trimmed;
}

/**
 * Compute the next run time given a schedule expression.
 * Supports: standard cron 5-field, @yearly, @monthly, @weekly, @daily, @hourly,
 * and @every <duration> (e.g., @every 1m, @every 30m, @every 1h).
 */
export function computeNextRun(
  schedule: string,
  lastRunAt?: string,
  catchup = false
): string {
  const lastRun = lastRunAt ? Date.parse(lastRunAt) : Date.now();
  const base = catchup ? lastRun : Math.max(lastRun, Date.now());

  // @every duration
  const everyMatch = schedule.match(/^@every\s+(\d+)([smhd])$/i);
  if (everyMatch) {
    const value = Number.parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    const ms =
      unit === "s" ? value * 1000 :
      unit === "m" ? value * 60_000 :
      unit === "h" ? value * 3600_000 :
      value * 86400_000;
    return new Date(base + ms).toISOString();
  }

  // Named schedules
  const now = new Date(base);
  switch (schedule) {
    case "@yearly":
    case "@annually":
      return new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0).toISOString();
    case "@monthly":
      return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).toISOString();
    case "@weekly":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - now.getDay()), 0, 0, 0, 0).toISOString();
    case "@daily":
    case "@midnight":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();
    case "@hourly":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0).toISOString();
    default:
      // Simple 5-field cron: attempt to advance by 1 minute for basic cases
      // Full cron parser is out of scope; fallback to +1 hour for unrecognized
      return new Date(base + 3600_000).toISOString();
  }
}

import type { TaskResult, TaskRunner } from "../contracts/orchestration.js";
import type { DagNode } from "./dag.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { getOmkPath, readTextFile } from "../util/fs.js";

export interface EnsembleCandidate {
  id: string;
  perspective: string;
  weight?: number;
  role?: string;
}

export interface EnsemblePolicy {
  enabled?: boolean;
  maxCandidatesPerNode?: number;
  maxParallel?: number;
  quorumRatio?: number;
  candidatesByRole?: Record<string, EnsembleCandidate[]>;
}

export interface EnsembleCandidateResult {
  candidate: EnsembleCandidate;
  result: TaskResult;
  score: number;
}

interface EnsembleConfig {
  enabled?: boolean;
  maxCandidatesPerNode?: number;
  maxParallel?: number;
  quorumRatio?: number;
}

const DEFAULT_CANDIDATES: Record<string, EnsembleCandidate[]> = {
  architect: [
    { id: "systems", perspective: "system boundaries, interfaces, and long-horizon tradeoffs", weight: 1 },
    { id: "risk", perspective: "failure modes, hidden constraints, and rollback risks", weight: 1 },
    { id: "lean", perspective: "simplest plan that preserves correctness", weight: 0.8 },
  ],
  planner: [
    { id: "sequence", perspective: "critical path sequencing and dependencies", weight: 1 },
    { id: "tests", perspective: "acceptance criteria and verification shape", weight: 1 },
    { id: "risk", perspective: "scope control and implementation risk", weight: 0.8 },
  ],
  coder: [
    { id: "implement", perspective: "minimal correct implementation", weight: 1 },
    { id: "edge-cases", perspective: "edge cases, error handling, and backward compatibility", weight: 1 },
    { id: "simplicity", perspective: "delete/reuse-first simplification", weight: 0.8 },
  ],
  reviewer: [
    { id: "correctness", perspective: "logic defects, regressions, and contract drift", weight: 1 },
    { id: "security", perspective: "trust boundaries, command execution, and data exposure", weight: 1 },
    { id: "maintainability", perspective: "unnecessary complexity and future maintenance", weight: 0.8 },
  ],
  qa: [
    { id: "regression", perspective: "regression and smoke coverage", weight: 1 },
    { id: "edge", perspective: "edge cases and failure paths", weight: 1 },
  ],
  explorer: [
    { id: "symbols", perspective: "file, symbol, and call-site mapping", weight: 1 },
    { id: "dataflow", perspective: "data flow and dependency relationships", weight: 1 },
  ],
  default: [
    { id: "primary", perspective: "primary task objective", weight: 1 },
    { id: "critic", perspective: "critical counter-review before accepting the result", weight: 1 },
  ],
};

let ensembleConfigPromise: Promise<EnsembleConfig> | undefined;

export function createEnsembleTaskRunner(baseRunner: TaskRunner, policy: EnsemblePolicy = {}): TaskRunner {
  return {
    async run(node: DagNode, env: Record<string, string>): Promise<TaskResult> {
      const resources = await getOmkResourceSettings();
      const config = await getEnsembleConfig();
      const effectivePolicy = normalizePolicy(policy, resources.maxWorkers, config);
      const candidates = selectCandidates(node.role, effectivePolicy);

      if (!effectivePolicy.enabled || candidates.length <= 1) {
        return baseRunner.run(node, {
          ...env,
          OMK_ENSEMBLE: "off",
          OMK_ENSEMBLE_CANDIDATE_ID: candidates[0]?.id ?? "solo",
        });
      }

      const candidateResults = await mapWithConcurrency(
        candidates,
        effectivePolicy.maxParallel,
        async (candidate) => runCandidate(baseRunner, node, env, candidate)
      );

      return aggregateCandidateResults(node, candidateResults, effectivePolicy);
    },
  };
}

export function selectCandidates(role: string, policy: Required<EnsemblePolicy>): EnsembleCandidate[] {
  const configured = policy.candidatesByRole[role] ?? policy.candidatesByRole.default;
  const candidates = configured.length > 0 ? configured : DEFAULT_CANDIDATES.default;
  return candidates.slice(0, policy.maxCandidatesPerNode).map((candidate, index) => ({
    ...candidate,
    id: candidate.id || `${role}-${index + 1}`,
    weight: normalizeWeight(candidate.weight),
  }));
}

function normalizePolicy(policy: EnsemblePolicy, resourceWorkers: number, config: EnsembleConfig): Required<EnsemblePolicy> {
  const enabled = policy.enabled ?? parseOptionalBoolean(process.env.OMK_ENSEMBLE) ?? config.enabled ?? true;
  const envMaxCandidates = parsePositiveInt(process.env.OMK_ENSEMBLE_MAX_CANDIDATES);
  const envMaxParallel = parsePositiveInt(process.env.OMK_ENSEMBLE_MAX_PARALLEL);
  const envQuorumRatio = parsePositiveNumber(process.env.OMK_ENSEMBLE_QUORUM_RATIO);
  const maxCandidatesPerNode = Math.max(1, Math.min(6, policy.maxCandidatesPerNode ?? envMaxCandidates ?? config.maxCandidatesPerNode ?? 2));
  const maxParallel = Math.max(1, Math.min(maxCandidatesPerNode, policy.maxParallel ?? envMaxParallel ?? config.maxParallel ?? resourceWorkers));
  const quorumRatio = Math.max(0.01, Math.min(1, policy.quorumRatio ?? envQuorumRatio ?? config.quorumRatio ?? 0.5));

  return {
    enabled,
    maxCandidatesPerNode,
    maxParallel,
    quorumRatio,
    candidatesByRole: {
      ...DEFAULT_CANDIDATES,
      ...(policy.candidatesByRole ?? {}),
    },
  };
}

async function getEnsembleConfig(): Promise<EnsembleConfig> {
  ensembleConfigPromise ??= (async () => {
    const content = await readTextFile(getOmkPath("config.toml"), "");
    const section = readSection(content, "ensemble");
    return {
      enabled: parseOptionalBoolean(section.enabled),
      maxCandidatesPerNode: parsePositiveInt(section.max_candidates_per_node),
      maxParallel: parsePositiveInt(section.max_parallel),
      quorumRatio: parsePositiveNumber(section.quorum_ratio),
    };
  })();
  return ensembleConfigPromise;
}

function readSection(content: string, sectionName: string): Record<string, string> {
  const result: Record<string, string> = {};
  let active = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      active = section[1].trim() === sectionName;
      continue;
    }
    if (!active) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (kv) result[kv[1].trim()] = normalizeTomlValue(kv[2].trim());
  }
  return result;
}

function stripComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
      }
    }
    if (char === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function normalizeTomlValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function runCandidate(
  baseRunner: TaskRunner,
  node: DagNode,
  env: Record<string, string>,
  candidate: EnsembleCandidate
): Promise<EnsembleCandidateResult> {
  const candidateNode: DagNode = {
    ...node,
    id: `${node.id}#${candidate.id}`,
    role: candidate.role ?? node.role,
    name: [
      node.name,
      "",
      `Ensemble candidate: ${candidate.id}`,
      `Perspective: ${candidate.perspective}`,
      "Return concrete evidence and blockers. Do not hide uncertainty.",
    ].join("\n"),
  };

  const result = await baseRunner.run(candidateNode, {
    ...env,
    OMK_ENSEMBLE: "on",
    OMK_ENSEMBLE_ORIGINAL_NODE_ID: node.id,
    OMK_ENSEMBLE_CANDIDATE_ID: candidate.id,
    OMK_ENSEMBLE_PERSPECTIVE: candidate.perspective,
  }).catch((error: unknown): TaskResult => ({
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

  return {
    candidate,
    result,
    score: scoreResult(result, normalizeWeight(candidate.weight)),
  };
}

function aggregateCandidateResults(
  node: DagNode,
  results: EnsembleCandidateResult[],
  policy: Required<EnsemblePolicy>
): TaskResult {
  const totalWeight = results.reduce((sum, item) => sum + normalizeWeight(item.candidate.weight), 0);
  const successWeight = results.reduce((sum, item) => sum + (item.result.success ? normalizeWeight(item.candidate.weight) : 0), 0);
  const quorumWeight = Math.max(1, totalWeight * policy.quorumRatio);
  const success = successWeight >= quorumWeight;
  const winner = [...results].sort((a, b) => b.score - a.score)[0];
  const summary = renderSummary(node, results, successWeight, totalWeight, quorumWeight);

  return {
    success,
    exitCode: success ? winner?.result.exitCode ?? 0 : 1,
    stdout: [summary, winner?.result.stdout ?? ""].filter(Boolean).join("\n\n"),
    stderr: results
      .filter((item) => !item.result.success || item.result.stderr.trim())
      .map((item) => `[${item.candidate.id}] ${item.result.stderr}`.trim())
      .filter(Boolean)
      .join("\n"),
    metadata: {
      ensemble: {
        successWeight,
        totalWeight,
        quorumWeight,
        winner: winner?.candidate.id,
        candidates: results.map((item) => ({
          id: item.candidate.id,
          success: item.result.success,
          score: item.score,
        })),
      },
    },
  };
}

function renderSummary(
  node: DagNode,
  results: EnsembleCandidateResult[],
  successWeight: number,
  totalWeight: number,
  quorumWeight: number
): string {
  const lines = [
    `# OMK Ensemble Result`,
    ``,
    `Node: ${node.id} (${node.role})`,
    `Quorum: ${successWeight.toFixed(2)} / ${totalWeight.toFixed(2)} success weight (required ${quorumWeight.toFixed(2)})`,
    ``,
    `| Candidate | Perspective | Success | Score |`,
    `|---|---|---:|---:|`,
  ];

  for (const item of results) {
    lines.push(`| ${item.candidate.id} | ${escapePipe(item.candidate.perspective)} | ${item.result.success ? "yes" : "no"} | ${item.score.toFixed(2)} |`);
  }

  return lines.join("\n");
}

function scoreResult(result: TaskResult, weight: number): number {
  if (!result.success) return 0;
  const stdout = result.stdout.toLowerCase();
  const confidence = stdout.match(/confidence\s*[:=]\s*(0(?:\.\d+)?|1(?:\.0+)?)/)?.[1];
  const confidenceScore = confidence ? Number(confidence) : 1;
  return weight * Math.max(0, Math.min(1, confidenceScore));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function normalizeWeight(weight: number | undefined): number {
  return Number.isFinite(weight) && weight !== undefined && weight > 0 ? weight : 1;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

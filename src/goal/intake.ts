import type { GoalSpec, GoalRisk, RiskLevel, SuccessCriterion } from "../contracts/goal.js";

function generateGoalId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

function deriveTitle(rawPrompt: string): string {
  const firstSentence = rawPrompt.split(/[.!?]/, 1)[0]?.trim() ?? rawPrompt.trim();
  return firstSentence.slice(0, 120);
}

function deriveObjective(rawPrompt: string): string {
  const firstPara = rawPrompt.split(/\n\n/)[0]?.trim() ?? rawPrompt.trim();
  return firstPara;
}

function inferSuccessCriteria(objective: string): SuccessCriterion[] {
  const criteria: SuccessCriterion[] = [];
  const lowered = objective.toLowerCase();

  // Heuristic patterns for common engineering tasks
  const patterns: Array<{ trigger: string[]; description: string }> = [
    {
      trigger: ["add", "implement", "introduce", "create", "build"],
      description: "The new functionality is implemented and integrated into the codebase",
    },
    {
      trigger: ["test", "verify", "validate", "check"],
      description: "Tests pass and the change is verified against acceptance criteria",
    },
    {
      trigger: ["fix", "bug", "issue", "error", "crash"],
      description: "The reported issue is reproduced, fixed, and verified with a regression test",
    },
    {
      trigger: ["refactor", "clean", "restructure"],
      description: "Code is restructured without changing external behavior and all tests pass",
    },
    {
      trigger: ["doc", "document", "readme", "guide"],
      description: "Documentation is updated and accurately reflects the current state",
    },
  ];

  for (const pattern of patterns) {
    if (pattern.trigger.some((t) => lowered.includes(t))) {
      criteria.push({
        id: `criterion-${criteria.length + 1}`,
        description: pattern.description,
        requirement: criteria.length === 0 ? "required" : "optional",
        weight: criteria.length === 0 ? 1.0 : 0.5,
        inferred: true,
      });
    }
  }

  if (criteria.length === 0) {
    criteria.push({
      id: "criterion-1",
      description: "The objective is completed and the result is demonstrable",
      requirement: "required",
      weight: 1.0,
      inferred: true,
    });
  }

  return criteria;
}

function deriveRiskLevel(objective: string): RiskLevel {
  const lowered = objective.toLowerCase();
  if (
    lowered.includes("production") ||
    lowered.includes("deploy") ||
    lowered.includes("migrate") ||
    lowered.includes("database") ||
    lowered.includes("security")
  ) {
    return "high";
  }
  if (
    lowered.includes("refactor") ||
    lowered.includes("clean") ||
    lowered.includes("style") ||
    lowered.includes("format")
  ) {
    return "low";
  }
  return "medium";
}

export interface NormalizedGoalInput {
  rawPrompt: string;
  title?: string;
  objective?: string;
  successCriteria?: SuccessCriterion[];
  constraints?: string[];
  nonGoals?: string[];
  risks?: GoalRisk[];
  expectedArtifacts?: Array<{ name: string; path?: string }>;
  riskLevel?: RiskLevel;
}

export interface ParsedGoalPrompt {
  rawPrompt: string;
  objective: string;
  successCriteria: string[];
  nonGoals: string[];
  risks: string[];
  expectedArtifacts: Array<{ name: string; path?: string }>;
  constraints: string[];
}

/**
 * Extract structured fields from a raw goal prompt using regex-based heuristics.
 * Supports Markdown-style headers and labelled sections.
 */
export function normalizeGoalPrompt(rawPrompt: string): ParsedGoalPrompt {
  const objective = deriveObjective(rawPrompt);

  // Extract sections by common headers or labels
  const successCriteria = extractListSection(rawPrompt, [
    /(?:^|\n)(?:#{1,3}\s*)?(?:success\s*criteria|acceptance\s*criteria|criteria)(?:\s*[:-])?\s*\n?/i,
    /(?:^|\n)(?:success\s*criteria|acceptance\s*criteria):\s*/i,
  ]);

  const nonGoals = extractListSection(rawPrompt, [
    /(?:^|\n)(?:#{1,3}\s*)?(?:non[-\s]?goals|out of scope|exclusions)(?:\s*[:-])?\s*\n?/i,
  ]);

  const risks = extractListSection(rawPrompt, [
    /(?:^|\n)(?:#{1,3}\s*)?(?:risks|risk factors|concerns)(?:\s*[:-])?\s*\n?/i,
  ]);

  const constraints = extractListSection(rawPrompt, [
    /(?:^|\n)(?:#{1,3}\s*)?(?:constraints|limitations|restrictions)(?:\s*[:-])?\s*\n?/i,
  ]);

  const expectedArtifacts = extractArtifactSection(rawPrompt);

  return {
    rawPrompt,
    objective,
    successCriteria,
    nonGoals,
    risks,
    expectedArtifacts,
    constraints,
  };
}

function extractListSection(text: string, headerPatterns: RegExp[]): string[] {
  for (const pattern of headerPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const start = match.index + match[0].length;
      const remainder = text.slice(start);
      // Capture until next blank line followed by a non-list line, or next header, or end
      const lines: string[] = [];
      const lineRe = /.*(?:\n|$)/g;
      lineRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = lineRe.exec(remainder)) !== null) {
        const line = m[0];
        if (/^#{1,3}\s/.test(line) || (lines.length > 0 && /^\s*$/.test(line) && !/^\s*[-*d]/.test(remainder.slice(lineRe.lastIndex)))) {
          break;
        }
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        // Stop if we hit a line that looks like a new header or non-list after we've started
        if (lines.length > 0 && /^[A-Z][a-zA-Z\s]+[:-]\s*$/.test(trimmed)) {
          break;
        }
        const listItem = trimmed.replace(/^[-*d]+[.)]?\s*/, "").trim();
        if (listItem.length > 0) {
          lines.push(listItem);
        }
        if (lineRe.lastIndex >= remainder.length) break;
      }
      if (lines.length > 0) return lines;
    }
  }
  return [];
}

function extractArtifactSection(text: string): Array<{ name: string; path?: string }> {
  const artifacts: Array<{ name: string; path?: string }> = [];
  const headerPatterns = [
    /(?:^|\n)(?:#{1,3}\s*)?(?:artifacts|expected artifacts|deliverables|outputs)(?:\s*[:-])?\s*\n?/i,
  ];
  for (const pattern of headerPatterns) {
    const match = pattern.exec(text);
    if (match) {
      const start = match.index + match[0].length;
      const remainder = text.slice(start);
      const lineRe = /.*(?:\n|$)/g;
      lineRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = lineRe.exec(remainder)) !== null) {
        const line = m[0];
        if (/^#{1,3}\s/.test(line)) break;
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        if (/^[A-Z][a-zA-Z\s]+[:-]\s*$/.test(trimmed)) break;
        const cleaned = trimmed.replace(/^[-*d]+[.)]?\s*/, "").trim();
        // Try to extract a file path like `src/foo.ts` or `path/to/file.md`
        const pathMatch = cleaned.match(/`([^`]+\.[a-zA-Z0-9]+)`/);
        const name = cleaned.split(/[:-]/)[0].trim();
        if (name.length > 0) {
          artifacts.push({
            name,
            path: pathMatch ? pathMatch[1] : undefined,
          });
        }
        if (lineRe.lastIndex >= remainder.length) break;
      }
      if (artifacts.length > 0) return artifacts;
    }
  }
  return artifacts;
}

export function normalizeGoal(input: NormalizedGoalInput): GoalSpec {
  const now = new Date().toISOString();
  const title = input.title ?? deriveTitle(input.rawPrompt);
  const objective = input.objective ?? deriveObjective(input.rawPrompt);
  const criteria = input.successCriteria ?? inferSuccessCriteria(objective);
  const riskLevel = input.riskLevel ?? deriveRiskLevel(objective);
  const goalId = `${slugifyTitle(title)}-${generateGoalId()}`;

  return {
    schemaVersion: 1,
    goalId,
    title,
    rawPrompt: input.rawPrompt,
    objective,
    successCriteria: criteria.map((c) => ({ ...c, inferred: c.inferred ?? false })),
    constraints: (input.constraints ?? []).map((c, i) => ({ id: `constraint-${i + 1}`, description: c })),
    nonGoals: input.nonGoals ?? [],
    risks: input.risks ?? [],
    expectedArtifacts: (input.expectedArtifacts ?? []).map((a) => ({ name: a.name, path: a.path })),
    status: "draft",
    riskLevel,
    planRevision: 0,
    createdAt: now,
    updatedAt: now,
    runIds: [],
  };
}

/**
 * Codex-style entrypoint: create a GoalSpec from a raw prompt with structured parsing.
 */
export function createGoalSpec(rawPrompt: string, overrides?: Partial<Omit<NormalizedGoalInput, "rawPrompt">>): GoalSpec {
  const parsed = normalizeGoalPrompt(rawPrompt);
  return normalizeGoal({
    rawPrompt,
    title: overrides?.title ?? deriveTitle(rawPrompt),
    objective: overrides?.objective ?? parsed.objective,
    successCriteria: overrides?.successCriteria ?? parsed.successCriteria.map((desc, i) => ({
      id: `criterion-${i + 1}`,
      description: desc,
      requirement: i === 0 ? "required" : "optional",
      weight: i === 0 ? 1.0 : 0.5,
      inferred: false,
    })),
    constraints: overrides?.constraints ?? parsed.constraints,
    nonGoals: overrides?.nonGoals ?? parsed.nonGoals,
    risks: overrides?.risks ?? parsed.risks.map((desc, i) => ({
      id: `risk-${i + 1}`,
      description: desc,
      level: deriveRiskLevel(desc),
    })),
    expectedArtifacts: overrides?.expectedArtifacts ?? parsed.expectedArtifacts,
    riskLevel: overrides?.riskLevel,
  });
}

export function updateGoalStatus(
  spec: GoalSpec,
  status: GoalSpec["status"],
  options?: { planRevision?: number; runId?: string }
): GoalSpec {
  const updated: GoalSpec = {
    ...spec,
    status,
    updatedAt: new Date().toISOString(),
  };
  if (options?.planRevision !== undefined) {
    updated.planRevision = options.planRevision;
  }
  if (options?.runId && !updated.runIds.includes(options.runId)) {
    updated.runIds = [...updated.runIds, options.runId];
  }
  return updated;
}

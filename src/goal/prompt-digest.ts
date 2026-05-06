import { createHash } from "crypto";

export interface PromptDigestOptions {
  maxKeywords?: number;
  maxPhrases?: number;
}

const DEFAULT_MAX_KEYWORDS = 14;
const DEFAULT_MAX_PHRASES = 2;
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "should",
  "must",
  "have",
  "been",
  "were",
  "are",
  "was",
  "not",
  "use",
  "using",
  "하다",
  "해서",
  "하면",
  "그리고",
  "으로",
  "에서",
  "에게",
  "좀",
  "현재",
  "일단",
]);

/**
 * Render a compact, non-verbatim reference for a user prompt or goal.
 *
 * Goal-followup prompts should carry enough context for Kimi to infer the next
 * action without re-sending the user's original input as the next prompt.
 */
export function renderPromptDigest(
  title: string,
  value: string | undefined,
  options: PromptDigestOptions = {}
): string {
  const normalized = normalizePromptText(value ?? "");
  if (!normalized) return "";

  const keywords = extractPromptKeywords(normalized, options.maxKeywords ?? DEFAULT_MAX_KEYWORDS);
  const intentSketch = sketchPromptIntent(normalized, options.maxPhrases ?? DEFAULT_MAX_PHRASES);

  return [
    `${title}:`,
    `- digest: ${promptDigestFingerprint(normalized)}`,
    `- keywords: ${keywords.length > 0 ? keywords.join(", ") : "none"}`,
    `- intent sketch: ${intentSketch.length > 0 ? intentSketch.join(" / ") : "context unavailable"}`,
    `- verbatim source: omitted to prevent input replay; synthesize from evidence and state.`,
  ].join("\n");
}

export function promptDigestFingerprint(value: string): string {
  return createHash("sha256")
    .update(normalizePromptText(value))
    .digest("hex")
    .slice(0, 12);
}

export function extractPromptKeywords(value: string, maxKeywords = DEFAULT_MAX_KEYWORDS): string[] {
  const seen = new Set<string>();
  const tokens = normalizePromptText(value).toLocaleLowerCase().match(TOKEN_PATTERN) ?? [];
  const result: string[] = [];

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (/^\d+$/u.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= maxKeywords) break;
  }

  return result;
}

function sketchPromptIntent(value: string, maxPhrases: number): string[] {
  const phrases: string[] = [];
  const clauses = normalizePromptText(value)
    .split(/[.!?;\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const clauseKeywords = extractPromptKeywords(clause, 7);
    if (clauseKeywords.length === 0) continue;
    phrases.push(clauseKeywords.join(" "));
    if (phrases.length >= maxPhrases) break;
  }

  return phrases;
}

function normalizePromptText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

import { runShell } from "../util/shell.js";
import { getProjectRoot, pathExists, writeFileSafe, readTextFile } from "../util/fs.js";
import { join } from "path";
import { style, header, status } from "../util/theme.js";
import { t } from "../util/i18n.js";

const GITHUB_API_URL = "https://api.github.com/repos/voltagent/awesome-design-md/contents/design-md";
const DESIGN_MD_RAW_URL = (name: string) => `https://getdesign.md/design-md/${name}/DESIGN.md`;

interface GitHubContentItem {
  name: string;
  type: string;
}

async function fetchDesignList(): Promise<string[]> {
  try {
    const result = await runShell("curl", ["-sL", "-H", "Accept: application/vnd.github.v3+json", GITHUB_API_URL], { timeout: 15000 });
    if (result.failed) return [];
    const parsed: GitHubContentItem[] = JSON.parse(result.stdout);
    return parsed.filter((item) => item.type === "dir").map((item) => item.name);
  } catch {
    return [];
  }
}

async function fetchDesignMd(name: string): Promise<string | null> {
  try {
    const result = await runShell("curl", ["-sL", DESIGN_MD_RAW_URL(name)], { timeout: 15000 });
    const out = result.stdout.trim().toLowerCase();
    if (result.failed || out.startsWith("<!doctype") || out.startsWith("<html")) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

export async function designInitCommand(): Promise<void> {
  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  if (await pathExists(designPath)) {
    console.log(status.info("DESIGN.md already exists."));
    return;
  }
  await writeFileSafe(designPath, `---
version: "alpha"
name: "my-project"
description: "Project design system"
colors:
  primary: "#111827"
  secondary: "#4B5563"
  accent: "#7C3AED"
  success: "#059669"
  warning: "#D97706"
  danger: "#DC2626"
  background: "#F9FAFB"
  surface: "#FFFFFF"
typography:
  h1:
    fontFamily: "Inter"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: "2.5rem"
  body:
    fontFamily: "Inter"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
rounded:
  sm: "0.375rem"
  md: "0.75rem"
  lg: "1rem"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
---

## Overview

Describe your project's visual identity here.
`);
  console.log(status.ok("DESIGN.md created."));
}

export async function designListCommand(): Promise<void> {
  console.log(header(t("design.listHeader")));
  const list = await fetchDesignList();
  if (list.length === 0) {
    console.error(status.error(t("design.listFetchFailed")));
    process.exit(1);
  }

  // Category classification (hardcoded metadata)
  const categories: Record<string, string[]> = {
    "AI & LLM": ["claude", "cohere", "elevenlabs", "minimax", "mistral.ai", "ollama", "opencode.ai", "replicate", "runwayml", "together.ai", "voltagent", "x.ai"],
    "Developer Tools": ["cursor", "expo", "lovable", "raycast", "superhuman", "vercel", "warp"],
    "Backend & DevOps": ["clickhouse", "composio", "hashicorp", "mongodb", "posthog", "sanity", "sentry", "supabase"],
    "Productivity & SaaS": ["cal", "intercom", "linear.app", "mintlify", "notion", "resend", "zapier"],
    "Design & Creative": ["airtable", "clay", "figma", "framer", "miro", "webflow"],
    "Fintech & Crypto": ["binance", "coinbase", "kraken", "mastercard", "revolut", "stripe", "wise"],
    "E-commerce & Retail": ["airbnb", "meta", "pinterest", "semrush", "spotify", "tesla", "uber"],
    "Automotive": ["bmw", "ferrari", "lamborghini", "renault"],
  };

  const categorized = new Set<string>();
  for (const [cat, names] of Object.entries(categories)) {
    const matched = list.filter((n) => names.includes(n));
    if (matched.length === 0) continue;
    matched.forEach((n) => categorized.add(n));
    console.log(style.pinkBold(`\n## ${cat}`));
    for (const name of matched) {
      console.log(style.gray(`  ${name}`));
    }
  }

  const others = list.filter((n) => !categorized.has(n));
  if (others.length > 0) {
    console.log(style.pinkBold("\n## " + t("design.categoryOthers")));
    for (const name of others) {
      console.log(style.gray(`  ${name}`));
    }
  }

  console.log("\n" + status.success(t("design.totalFound", list.length)));
  console.log(style.gray("\n" + t("design.usageApply")));
  console.log(style.gray(t("design.exampleApply")));
}

export async function designApplyCommand(name: string): Promise<void> {
  if (!name) {
    console.error(status.error(t("design.nameRequired")));
    process.exit(1);
  }

  console.log(style.purple(t("design.downloading", name)));
  const content = await fetchDesignMd(name);
  if (!content) {
    console.error(status.error(t("design.notFound", name)));
    console.error(style.gray(t("design.checkList")));
    process.exit(1);
  }

  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  const backupPath = join(root, "DESIGN.md.bak");

  // Backup existing file
  if (await pathExists(designPath)) {
    const existing = await readTextFile(designPath, "");
    if (existing.trim()) {
      await writeFileSafe(backupPath, existing);
      console.log(style.orange(t("design.backupExisting")));
    }
  }

  await writeFileSafe(designPath, content);
  console.log(status.success(t("design.applyComplete", name)));
  console.log(style.gray(t("design.source", name)));
}

export async function designSearchCommand(keyword: string): Promise<void> {
  if (!keyword) {
    console.error(status.error(t("design.keywordRequired")));
    process.exit(1);
  }

  console.log(style.purple(t("design.searching", keyword)));
  const list = await fetchDesignList();
  const matched = list.filter((n) => n.toLowerCase().includes(keyword.toLowerCase()));

  if (matched.length === 0) {
    console.log(status.warn(t("design.noResults")));
    console.log(style.gray(t("design.seeFullList")));
    process.exit(1);
  }

  console.log(status.success(t("design.resultsCount", matched.length)));
  for (const name of matched) {
    console.log(`  ${name}`);
  }
  console.log(style.gray("\n" + t("design.usageApply")));
}

export async function designLintCommand(file?: string): Promise<void> {
  const target = file ?? "DESIGN.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "lint", target], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}

export async function designDiffCommand(from?: string, to?: string): Promise<void> {
  const a = from ?? "DESIGN.md";
  const b = to ?? "DESIGN.next.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "diff", a, b], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}

export async function designExportCommand(format: string, file?: string): Promise<void> {
  const target = file ?? "DESIGN.md";
  const result = await runShell("npx", ["-y", "@google/design.md", "export", "--format", format, target], { timeout: 60000 });
  console.log(result.stdout || result.stderr);
  if (result.failed) process.exit(result.exitCode);
}

import { runShell } from "../util/shell.js";
import { getProjectRoot, pathExists, writeFileSafe, readTextFile } from "../util/fs.js";
import { join } from "path";
import { style, header, status } from "../util/theme.js";

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
  console.log(header("awesome-design-md 컬렉션 목록"));
  const list = await fetchDesignList();
  if (list.length === 0) {
    console.error(status.error("목록을 가져올 수 없습니다. 네트워크를 확인하세요."));
    process.exit(1);
  }

  // 카테고리 분류 (하드코딩된 메타데이터)
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
    console.log(style.pinkBold("\n## 기타"));
    for (const name of others) {
      console.log(style.gray(`  ${name}`));
    }
  }

  console.log("\n" + status.success(`총 ${list.length}개 DESIGN.md 발견`));
  console.log(style.gray("\n사용법: omk design apply <name>"));
  console.log(style.gray("예시:  omk design apply claude"));
}

export async function designApplyCommand(name: string): Promise<void> {
  if (!name) {
    console.error(status.error("디자인 이름을 입력하세요. 예: omk design apply claude"));
    process.exit(1);
  }

  console.log(style.blue(`📥 ${name} DESIGN.md 다운로드 중...`));
  const content = await fetchDesignMd(name);
  if (!content) {
    console.error(status.error(`'${name}' DESIGN.md를 찾을 수 없습니다.`));
    console.error(style.gray("   omk design list 로 사용 가능한 이름을 확인하세요."));
    process.exit(1);
  }

  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  const backupPath = join(root, "DESIGN.md.bak");

  // 기존 파일 백업
  if (await pathExists(designPath)) {
    const existing = await readTextFile(designPath, "");
    if (existing.trim()) {
      await writeFileSafe(backupPath, existing);
      console.log(style.orange("   💾 기존 DESIGN.md → DESIGN.md.bak 백업"));
    }
  }

  await writeFileSafe(designPath, content);
  console.log(status.success(`DESIGN.md 적용 완료 (${name})`));
  console.log(style.gray(`   출처: https://getdesign.md/${name}/design-md`));
}

export async function designSearchCommand(keyword: string): Promise<void> {
  if (!keyword) {
    console.error(status.error("검색어를 입력하세요. 예: omk design search dark"));
    process.exit(1);
  }

  console.log(style.blue(`🔍 '${keyword}' 검색 중...\n`));
  const list = await fetchDesignList();
  const matched = list.filter((n) => n.toLowerCase().includes(keyword.toLowerCase()));

  if (matched.length === 0) {
    console.log(status.warn("검색 결과 없음."));
    console.log(style.gray("\n전체 목록: omk design list"));
    process.exit(1);
  }

  console.log(status.success(`${matched.length}개 결과:\n`));
  for (const name of matched) {
    console.log(`  ${name}`);
  }
  console.log(style.gray("\n사용법: omk design apply <name>"));
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

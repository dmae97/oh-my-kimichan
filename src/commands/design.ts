import { runShell } from "../util/shell.js";
import { getProjectRoot, pathExists, writeFileSafe } from "../util/fs.js";
import { join } from "path";

export async function designInitCommand(): Promise<void> {
  const root = getProjectRoot();
  const designPath = join(root, "DESIGN.md");
  if (await pathExists(designPath)) {
    console.log("ℹ️ DESIGN.md already exists.");
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
  console.log("✅ DESIGN.md created.");
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

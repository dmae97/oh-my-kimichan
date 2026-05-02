import { readdir, copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { getProjectRoot, pathExists, getOmkPath } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";

interface SkillPack {
  id: string;
  name: string;
  description: string;
  skills: string[]; // directory names under templates/skills/kimi/
}

const PACKS: SkillPack[] = [
  {
    id: "omk-core",
    name: "OMK Core",
    description: "Essential OMK orchestration skills",
    skills: [
      "omk-global-rules",
      "omk-project-rules",
      "omk-kimi-runtime",
      "omk-quality-gate",
      "omk-plan-first",
      "omk-task-router",
    ],
  },
  {
    id: "omk-spec-driven",
    name: "Spec-Driven",
    description: "spec-kit / specify workflow skills",
    skills: [
      "speckit-specify",
      "speckit-plan",
      "speckit-tasks",
      "speckit-implement",
      "speckit-checklist",
      "speckit-clarify",
      "speckit-analyze",
      "speckit-constitution",
      "speckit-taskstoissues",
    ],
  },
  {
    id: "omk-typescript",
    name: "TypeScript",
    description: "TypeScript strictness and design-to-code skills",
    skills: [
      "omk-design-md",
      "omk-flow-design-to-code",
    ],
  },
  {
    id: "omk-security",
    name: "Security",
    description: "Security review and audit skills",
    skills: [
      "omk-code-review",
      "omk-flow-bugfix",
    ],
  },
  {
    id: "omk-review",
    name: "Review",
    description: "Code review and PR review skills",
    skills: [
      "omk-code-review",
      "omk-multimodal-ui-review",
      "omk-flow-pr-review",
    ],
  },
  {
    id: "omk-release",
    name: "Release",
    description: "Release flow and team-run skills",
    skills: [
      "omk-flow-release",
      "omk-flow-team-run",
      "omk-flow-refactor",
      "omk-flow-feature-dev",
    ],
  },
];

const INSTALLED_PACKS_FILE = ".omk/installed-skill-packs.json";

async function getTemplatesDir(): Promise<string | null> {
  const packageRoot = getOmkPath("..");
  const kimiSkills = join(packageRoot, "templates", "skills", "kimi");
  if (await pathExists(kimiSkills)) return kimiSkills;
  return null;
}

async function getInstalledPacks(root: string): Promise<string[]> {
  const file = join(root, INSTALLED_PACKS_FILE);
  if (!(await pathExists(file))) return [];
  try {
    const data = JSON.parse(await readFile(file, "utf-8"));
    return Array.isArray(data.packs) ? data.packs : [];
  } catch {
    return [];
  }
}

async function saveInstalledPacks(root: string, packs: string[]): Promise<void> {
  const file = join(root, INSTALLED_PACKS_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ packs, updatedAt: new Date().toISOString() }, null, 2));
}

async function copySkillDir(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copySkillDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

export async function skillPackCommand(): Promise<void> {
  const root = await getProjectRoot();
  const installed = await getInstalledPacks(root);
  const templatesDir = await getTemplatesDir();

  console.log(header("Skill Packs"));
  console.log("");

  for (const pack of PACKS) {
    const isInstalled = installed.includes(pack.id);
    const marker = isInstalled ? style.mint("✓") : style.gray("○");
    const title = isInstalled ? style.mintBold(pack.name) : style.cream(pack.name);
    console.log(`${marker} ${title} ${style.gray(`(${pack.id})`)}`);
    console.log(`  ${style.gray(pack.description)}`);
    console.log(`  ${style.gray("Skills:")} ${pack.skills.join(", ")}`);
    console.log("");
  }

  if (!templatesDir) {
    console.log(status.warn("Template directory not found. Is OMK installed globally?"));
  }
}

export async function skillInstallCommand(packId: string): Promise<void> {
  const root = await getProjectRoot();
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) {
    console.error(status.error(`Unknown pack "${packId}".`));
    console.error(style.gray(`  Run "omk skill pack" to see available packs.`));
    process.exit(1);
  }

  const templatesDir = await getTemplatesDir();
  if (!templatesDir) {
    console.error(status.error("Skill templates not found."));
    process.exit(1);
  }

  const destDir = join(root, ".kimi", "skills");
  let copied = 0;
  let skipped = 0;

  for (const skill of pack.skills) {
    const src = join(templatesDir, skill);
    const dest = join(destDir, skill);
    if (await pathExists(src)) {
      await copySkillDir(src, dest);
      copied++;
    } else {
      skipped++;
      console.log(status.warn(`Skill template not found: ${skill}`));
    }
  }

  const installed = await getInstalledPacks(root);
  if (!installed.includes(packId)) {
    installed.push(packId);
    await saveInstalledPacks(root, installed);
  }

  console.log(status.success(`Pack "${pack.name}" installed.`));
  console.log(label("Copied", String(copied)));
  if (skipped > 0) console.log(label("Skipped", String(skipped)));
}

export async function skillSyncCommand(): Promise<void> {
  const root = await getProjectRoot();
  const installed = await getInstalledPacks(root);

  if (installed.length === 0) {
    console.log(status.warn("No packs installed. Run 'omk skill install <pack>' first."));
    return;
  }

  for (const packId of installed) {
    console.log(style.gray(`Syncing ${packId}...`));
    await skillInstallCommand(packId);
  }

  console.log(status.success("All packs synced."));
}

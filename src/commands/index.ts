import { readFile, readdir, writeFile, stat } from "fs/promises";
import { join, relative } from "path";
import ts from "typescript";
import { runShell } from "../util/shell.js";
import { getProjectRoot, pathExists, ensureDir } from "../util/fs.js";
import { style, header, status, label } from "../util/theme.js";

const INDEX_DIR = ".omk/index";

interface PackageIndex {
  manager: "npm" | "yarn" | "pnpm" | "bun" | "uv" | "poetry" | "pip" | "unknown";
  scripts: Record<string, string>;
  dependencies?: string[];
  devDependencies?: string[];
}

interface GitIndex {
  branch: string | null;
  recentCommits: string[];
  changedFiles: string[];
  untrackedFiles: string[];
}

interface FilesIndex {
  hasTsconfig: boolean;
  srcDir: boolean;
  testDir: boolean;
  testFiles: string[];
  sourceFiles: number;
}

interface SymbolEntry {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "variable" | "unknown";
  file: string;
  line: number;
  exported: boolean;
}

interface SymbolIndex {
  generatedAt: string;
  symbols: SymbolEntry[];
}

interface ProjectIndex {
  generatedAt: string;
  package: PackageIndex;
  git: GitIndex;
  files: FilesIndex;
  symbols?: SymbolIndex;
}

async function detectPackageManager(root: string): Promise<PackageIndex["manager"]> {
  if (await pathExists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(join(root, "yarn.lock"))) return "yarn";
  if (await pathExists(join(root, "package-lock.json"))) return "npm";
  if (await pathExists(join(root, "bun.lockb"))) return "bun";
  if (await pathExists(join(root, "uv.lock"))) return "uv";
  if (await pathExists(join(root, "poetry.lock"))) return "poetry";
  if (await pathExists(join(root, "requirements.txt"))) return "pip";
  return "unknown";
}

async function readPackageScripts(root: string): Promise<Record<string, string>> {
  const pkgPath = join(root, "package.json");
  if (!(await pathExists(pkgPath))) return {};
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

async function readPackageDeps(root: string): Promise<{ deps?: string[]; devDeps?: string[] }> {
  const pkgPath = join(root, "package.json");
  if (!(await pathExists(pkgPath))) return {};
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return {
      deps: pkg.dependencies ? Object.keys(pkg.dependencies) : undefined,
      devDeps: pkg.devDependencies ? Object.keys(pkg.devDependencies) : undefined,
    };
  } catch {
    return {};
  }
}

async function getGitIndex(root: string, includeChanged: boolean): Promise<GitIndex> {
  const branchResult = await runShell("git", ["branch", "--show-current"], { cwd: root, timeout: 5000 });
  const branch = branchResult.failed ? null : branchResult.stdout.trim() || null;

  const logResult = await runShell("git", ["log", "--oneline", "-10"], { cwd: root, timeout: 5000 });
  const recentCommits = logResult.failed
    ? []
    : logResult.stdout.split("\n").filter((l) => l.trim().length > 0);

  const changedFiles: string[] = [];
  const untrackedFiles: string[] = [];

  if (includeChanged) {
    const statusResult = await runShell("git", ["status", "--porcelain"], { cwd: root, timeout: 5000 });
    if (!statusResult.failed) {
      const lines = statusResult.stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const code = line.slice(0, 2);
        const file = line.slice(3);
        if (code.includes("?")) {
          untrackedFiles.push(file);
        } else {
          changedFiles.push(file);
        }
      }
    }
  }

  return { branch, recentCommits, changedFiles, untrackedFiles };
}

const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".output", "coverage"]);
const TEST_RE = /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs|java)$/;
const SOURCE_RE = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/;

async function walkDir(
  dir: string,
  root: string,
  opts: { maxDepth?: number } = {},
): Promise<{ testFiles: string[]; sourceFiles: number }> {
  const testFiles: string[] = [];
  let sourceFiles = 0;
  const maxDepth = opts.maxDepth ?? 4;

  async function recurse(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      const full = join(current, entry);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await recurse(full, depth + 1);
      } else if (info.isFile()) {
        const rel = relative(root, full);
        if (TEST_RE.test(entry)) {
          testFiles.push(rel);
        } else if (SOURCE_RE.test(entry)) {
          sourceFiles++;
        }
      }
    }
  }

  await recurse(dir, 0);
  return { testFiles, sourceFiles };
}

async function getFilesIndex(root: string): Promise<FilesIndex> {
  const hasTsconfig = await pathExists(join(root, "tsconfig.json"));
  const srcDir = await pathExists(join(root, "src"));
  const testDir = await pathExists(join(root, "test"));

  let testFiles: string[] = [];
  let sourceFiles = 0;

  // Walk src/ if it exists
  if (srcDir) {
    const srcResult = await walkDir(join(root, "src"), root, { maxDepth: 5 });
    testFiles = srcResult.testFiles;
    sourceFiles = srcResult.sourceFiles;
  }

  // Walk test/ or tests/ if they exist
  for (const td of ["test", "tests"]) {
    const p = join(root, td);
    if (await pathExists(p)) {
      const r = await walkDir(p, root, { maxDepth: 4 });
      for (const f of r.testFiles) {
        if (!testFiles.includes(f)) testFiles.push(f);
      }
    }
  }

  return { hasTsconfig, srcDir, testDir, testFiles, sourceFiles };
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as ts.HasModifiers).modifiers;
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

async function collectTsFiles(dir: string, root: string): Promise<string[]> {
  const files: string[] = [];
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".next", ".output", "coverage", ".omk"].includes(entry.name)) continue;
      files.push(...(await collectTsFiles(full, root)));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

async function buildSymbolIndex(root: string): Promise<SymbolIndex> {
  const srcDir = join(root, "src");
  const tsFiles = (await pathExists(srcDir)) ? await collectTsFiles(srcDir, root) : [];
  const symbols: SymbolEntry[] = [];

  for (const filePath of tsFiles) {
    const content = await readFile(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      let name: string | undefined;
      let kind: SymbolEntry["kind"] = "unknown";

      if (ts.isFunctionDeclaration(node)) {
        kind = "function";
        name = node.name?.text;
      } else if (ts.isClassDeclaration(node)) {
        kind = "class";
        name = node.name?.text;
      } else if (ts.isInterfaceDeclaration(node)) {
        kind = "interface";
        name = node.name?.text;
      } else if (ts.isTypeAliasDeclaration(node)) {
        kind = "type";
        name = node.name?.text;
      } else if (ts.isEnumDeclaration(node)) {
        kind = "enum";
        name = node.name?.text;
      } else if (ts.isVariableStatement(node)) {
        kind = "variable";
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name)) {
          name = decl.name.text;
        }
      }

      if (name) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        symbols.push({
          name,
          kind,
          file: relative(root, filePath).replace(/\\/g, "/"),
          line: line + 1,
          exported: hasExportModifier(node),
        });
      }

      ts.forEachChild(node, visit);
    }

    ts.forEachChild(sourceFile, visit);
  }

  return { generatedAt: new Date().toISOString(), symbols };
}

async function buildIndex(options: { changed?: boolean; symbols?: boolean }): Promise<ProjectIndex> {
  const root = await getProjectRoot();
  const manager = await detectPackageManager(root);
  const scripts = await readPackageScripts(root);
  const { deps, devDeps } = await readPackageDeps(root);
  const git = await getGitIndex(root, Boolean(options.changed));
  const files = await getFilesIndex(root);

  const index: ProjectIndex = {
    generatedAt: new Date().toISOString(),
    package: { manager, scripts, dependencies: deps, devDependencies: devDeps },
    git,
    files,
  };

  if (options.symbols) {
    index.symbols = await buildSymbolIndex(root);
  }

  return index;
}

async function saveIndex(index: ProjectIndex, root: string): Promise<void> {
  const dir = join(root, INDEX_DIR);
  await ensureDir(dir);

  await writeFile(join(dir, "package.json"), JSON.stringify(index.package, null, 2));
  await writeFile(join(dir, "git.json"), JSON.stringify(index.git, null, 2));
  await writeFile(join(dir, "files.json"), JSON.stringify(index.files, null, 2));
  if (index.symbols) {
    await writeFile(join(dir, "symbols.json"), JSON.stringify(index.symbols, null, 2));
  }
  await writeFile(
    join(dir, "summary.json"),
    JSON.stringify(
      {
        generatedAt: index.generatedAt,
        packageManager: index.package.manager,
        scriptCount: Object.keys(index.package.scripts).length,
        branch: index.git.branch,
        changedFiles: index.git.changedFiles.length,
        untrackedFiles: index.git.untrackedFiles.length,
        testFiles: index.files.testFiles.length,
        sourceFiles: index.files.sourceFiles,
        hasTsconfig: index.files.hasTsconfig,
        symbolCount: index.symbols?.symbols.length ?? 0,
      },
      null,
      2,
    ),
  );
}

export async function indexCommand(options: { changed?: boolean; symbols?: boolean }): Promise<void> {
  const root = await getProjectRoot();
  console.log(header("Project Index"));
  console.log(style.gray("  Scanning..."));

  const index = await buildIndex(options);
  await saveIndex(index, root);

  console.log(status.success("Index saved to .omk/index/"));
  console.log("");
  console.log(label("Package manager", index.package.manager));
  console.log(label("Scripts", String(Object.keys(index.package.scripts).length)));
  console.log(label("Branch", index.git.branch ?? style.gray("(none)")));
  console.log(label("Recent commits", String(index.git.recentCommits.length)));
  console.log(label("Changed files", String(index.git.changedFiles.length)));
  console.log(label("Untracked files", String(index.git.untrackedFiles.length)));
  console.log(label("Test files", String(index.files.testFiles.length)));
  console.log(label("Source files", String(index.files.sourceFiles)));
  console.log(label("tsconfig", index.files.hasTsconfig ? "yes" : "no"));
  if (options.symbols) {
    console.log(label("Symbols", String(index.symbols?.symbols.length ?? 0)));
  }
}

export async function indexShowCommand(): Promise<void> {
  const root = await getProjectRoot();
  const summaryPath = join(root, INDEX_DIR, "summary.json");

  if (!(await pathExists(summaryPath))) {
    console.error(status.error("No index found. Run 'omk index' first."));
    process.exit(1);
  }

  const summary = JSON.parse(await readFile(summaryPath, "utf-8"));
  console.log(header("Project Index"));
  console.log("");
  console.log(label("Generated", summary.generatedAt ?? "unknown"));
  console.log(label("Package manager", summary.packageManager));
  console.log(label("Scripts", String(summary.scriptCount)));
  console.log(label("Branch", summary.branch ?? "(none)"));
  console.log(label("Changed files", String(summary.changedFiles)));
  console.log(label("Untracked files", String(summary.untrackedFiles)));
  console.log(label("Test files", String(summary.testFiles)));
  console.log(label("Source files", String(summary.sourceFiles)));
  console.log(label("tsconfig", summary.hasTsconfig ? "yes" : "no"));
}

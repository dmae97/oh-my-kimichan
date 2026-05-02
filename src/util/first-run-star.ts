import { execFile } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";
import { select } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { OMK_REPO_URL } from "./version.js";
import { t } from "./i18n.js";

export type StarPromptResult = "yes" | "no" | "seen" | "skipped" | "error";
const execFileAsync = promisify(execFile);

export interface StarPromptState {
  promptedAt: string;
  answer: "yes" | "no";
  version: string;
  repoUrl: string;
  action: "github-star";
  starred?: boolean;
  starError?: string;
}

export interface StarPromptOptions {
  version: string;
  repoUrl?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
  commandName?: string;
  prompt?: (repoUrl: string) => Promise<boolean>;
  starRepo?: (repoUrl: string) => Promise<void> | void;
  now?: () => Date;
}

export function getStarPromptStatePath(homeDir: string = homedir()): string {
  return join(homeDir, ".omk", "star-prompt.json");
}

export function isStarPromptEligible(options: Omit<StarPromptOptions, "version" | "prompt" | "openUrl" | "now"> = {}): boolean {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const setting = env.OMK_STAR_PROMPT?.trim().toLowerCase();

  if (["0", "false", "off", "no", "never"].includes(setting ?? "")) return false;
  if (env.CI || env.GITHUB_ACTIONS) return false;
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if (options.commandName === "chat" || options.commandName === "omk") return false;
  if (options.commandName === "lsp") return false;
  if (argv.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg))) return false;
  return true;
}

export async function readStarPromptState(homeDir?: string): Promise<StarPromptState | null> {
  try {
    const raw = await readFile(getStarPromptStatePath(homeDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StarPromptState>;
    if (parsed.answer === "yes" || parsed.answer === "no") {
      return parsed as StarPromptState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function maybeAskForGitHubStar(options: StarPromptOptions): Promise<StarPromptResult> {
  const env = options.env ?? process.env;
  const force = env.OMK_STAR_PROMPT?.trim().toLowerCase() === "force";
  const repoUrl = options.repoUrl ?? OMK_REPO_URL;

  if (!isStarPromptEligible(options)) return "skipped";
  if (!force && await readStarPromptState(options.homeDir)) return "seen";

  try {
    const accepted = options.prompt
      ? await options.prompt(repoUrl)
      : await promptForGitHubStar(repoUrl);
    const answer: StarPromptState["answer"] = accepted ? "yes" : "no";
    let starred: boolean | undefined;
    let starError: string | undefined;

    if (accepted) {
      try {
        await (options.starRepo ?? starGitHubRepo)(repoUrl);
        starred = true;
      } catch (error) {
        starred = false;
        starError = error instanceof Error ? error.message : String(error);
      }
    }

    await writeStarPromptState({
      promptedAt: (options.now ?? (() => new Date()))().toISOString(),
      answer,
      version: options.version,
      repoUrl,
      action: "github-star",
      starred,
      starError,
    }, options.homeDir);
    return answer;
  } catch (err) {
    if (err instanceof ExitPromptError) return "skipped";
    return "error";
  }
}

const POST_COMMAND_WHITELIST = new Set(["doctor", "hud", "plan", "parallel", "run"]);

export interface StarPromptAfterCommandOptions extends StarPromptOptions {
  commandName: string;
}

export async function maybeAskForGitHubStarAfterCommand(
  options: StarPromptAfterCommandOptions,
): Promise<StarPromptResult> {
  const repoUrl = options.repoUrl ?? OMK_REPO_URL;

  if (!POST_COMMAND_WHITELIST.has(options.commandName)) return "skipped";
  if (!isStarPromptEligible(options)) return "skipped";
  if (await readStarPromptState(options.homeDir)) return "seen";

  try {
    const accepted = options.prompt
      ? await options.prompt(repoUrl)
      : await promptForStarAfterCommand();
    const answer: StarPromptState["answer"] = accepted ? "yes" : "no";
    let starred: boolean | undefined;
    let starError: string | undefined;

    if (accepted) {
      try {
        await (options.starRepo ?? starGitHubRepo)(repoUrl);
        starred = true;
      } catch (error) {
        starred = false;
        starError = error instanceof Error ? error.message : String(error);
      }
    }

    await writeStarPromptState({
      promptedAt: (options.now ?? (() => new Date()))().toISOString(),
      answer,
      version: options.version,
      repoUrl,
      action: "github-star",
      starred,
      starError,
    }, options.homeDir);
    return answer;
  } catch (err) {
    if (err instanceof ExitPromptError) return "skipped";
    return "error";
  }
}

export interface StarPromptSummary {
  answered: boolean;
  starred?: boolean;
  starError?: string;
}

export async function getStarPromptSummary(homeDir?: string): Promise<StarPromptSummary | null> {
  const state = await readStarPromptState(homeDir);
  if (!state) return null;
  return {
    answered: true,
    starred: state.starred,
    starError: state.starError,
  };
}

async function promptForGitHubStar(repoUrl: string): Promise<boolean> {
  try {
    const answer = await select({
      message: t("star.prompt", repoUrl),
      choices: [
        { name: t("star.yes"), value: "yes" },
        { name: t("star.no"), value: "no" },
      ],
      default: "no",
    });
    return answer === "yes";
  } catch (err) {
    if (err instanceof ExitPromptError) return false;
    throw err;
  }
}

async function promptForStarAfterCommand(): Promise<boolean> {
  try {
    const answer = await select({
      message: t("star.promptShort"),
      choices: [
        { name: t("star.yesStarIt"), value: "yes" },
        { name: t("star.no"), value: "no" },
      ],
      default: "no",
    });
    return answer === "yes";
  } catch (err) {
    if (err instanceof ExitPromptError) return false;
    throw err;
  }
}

async function writeStarPromptState(state: StarPromptState, homeDir?: string): Promise<void> {
  const statePath = getStarPromptStatePath(homeDir);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function parseGitHubRepoSlug(repoUrl: string): string | null {
  const normalized = repoUrl.trim().replace(/\.git$/i, "");
  const match = normalized.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export async function checkGhAuth(): Promise<void> {
  try {
    await execFileAsync("gh", ["auth", "status"], {
      timeout: 10_000,
    });
  } catch {
    throw new Error("GitHub CLI not authenticated. Run `gh auth login` first.");
  }
}

export async function starGitHubRepo(repoUrl: string): Promise<void> {
  const slug = parseGitHubRepoSlug(repoUrl);
  if (!slug) {
    throw new Error(`Unsupported GitHub repo URL: ${repoUrl}`);
  }

  await checkGhAuth();

  await execFileAsync("gh", ["api", "--silent", "--method", "PUT", `/user/starred/${slug}`], {
    timeout: 10_000,
  });
}

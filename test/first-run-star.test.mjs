import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isStarPromptEligible,
  maybeAskForGitHubStar,
  parseGitHubRepoSlug,
  readStarPromptState,
} from "../dist/util/first-run-star.js";
import { formatOmkVersionFooter, getOmkVersionSync, OMK_REPO_URL } from "../dist/util/version.js";

test("first-run star prompt is skipped for non-interactive or CI runs", () => {
  assert.equal(isStarPromptEligible({
    env: {},
    stdin: { isTTY: false },
    stdout: { isTTY: true },
    argv: ["node", "omk", "doctor"],
  }), false);

  assert.equal(isStarPromptEligible({
    env: { CI: "true" },
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    argv: ["node", "omk", "doctor"],
  }), false);
});

test("first-run star prompt is skipped for interactive chat entrypoints", () => {
  for (const commandName of ["omk", "chat"]) {
    assert.equal(isStarPromptEligible({
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", commandName === "omk" ? "" : commandName].filter(Boolean),
      commandName,
    }), false);
  }
});

test("first-run star prompt records YES and stars GitHub once", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-prompt-"));
  const starred = [];
  try {
    const result = await maybeAskForGitHubStar({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async (url) => { starred.push(url); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    assert.deepEqual(starred, [OMK_REPO_URL]);
    assert.deepEqual(await readStarPromptState(homeDir), {
      promptedAt: "2026-05-01T00:00:00.000Z",
      answer: "yes",
      version: "1.2.3",
      repoUrl: OMK_REPO_URL,
      action: "github-star",
      starred: true,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("first-run star prompt records star failure without opening a browser", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-prompt-fail-"));
  try {
    const result = await maybeAskForGitHubStar({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => { throw new Error("gh auth missing"); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    assert.deepEqual(await readStarPromptState(homeDir), {
      promptedAt: "2026-05-01T00:00:00.000Z",
      answer: "yes",
      version: "1.2.3",
      repoUrl: OMK_REPO_URL,
      action: "github-star",
      starred: false,
      starError: "gh auth missing",
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("GitHub repo slug parser supports browser and git URLs", () => {
  assert.equal(parseGitHubRepoSlug("https://github.com/dmae97/oh-my-kimichan"), "dmae97/oh-my-kimichan");
  assert.equal(parseGitHubRepoSlug("git@github.com:dmae97/oh-my-kimichan.git"), "dmae97/oh-my-kimichan");
});

test("OMK version footer reads package version", () => {
  assert.match(getOmkVersionSync(), /^\d+\.\d+\.\d+/);
  assert.match(formatOmkVersionFooter(), /omk v\d+\.\d+\.\d+/);
  assert.match(formatOmkVersionFooter(), /github\.com\/dmae97\/oh-my-kimichan/);
});

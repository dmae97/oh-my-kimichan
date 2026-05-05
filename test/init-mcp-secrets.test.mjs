import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const INIT_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "init.js")).href;

function runInit(projectRoot, homeRoot) {
  const script = `import { initCommand } from ${JSON.stringify(INIT_MODULE_URL)}; await initCommand({ profile: "default" });`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeRoot,
      OMK_PROJECT_ROOT: projectRoot,
      OMK_RENDER_LOGO: "0",
      OMK_STAR_PROMPT: "0",
    },
  });
}

test("init does not copy secret-bearing global MCP entries into project config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-home-"));

  try {
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        remote: {
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer SHOULD_NOT_COPY" },
          env: { API_TOKEN: "SHOULD_NOT_COPY" },
        },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers["omk-project"]);
    assert.equal(projectMcp.mcpServers.remote, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY|Authorization|API_TOKEN|Bearer|headers/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init preserves an existing custom project MCP config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-existing-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      _comment: "custom project config",
      mcpServers: {
        local: { command: "node", args: ["local-server.js"] },
      },
    }, null, 2), "utf-8");

    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        secret: { env: { API_TOKEN: "SHOULD_NOT_COPY" } },
      },
    }), "utf-8");

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const projectMcpRaw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const projectMcp = JSON.parse(projectMcpRaw);
    assert.ok(projectMcp.mcpServers.local);
    assert.equal(projectMcp.mcpServers.secret, undefined);
    assert.doesNotMatch(projectMcpRaw, /SHOULD_NOT_COPY/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("init skips broken global skill symlinks instead of failing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-init-symlink-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-init-symlink-home-"));

  try {
    const skillsRoot = join(homeRoot, ".kimi", "skills");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(join(homeRoot, "missing-skill-target"), join(skillsRoot, "broken-skill"));

    const result = runInit(projectRoot, homeRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const generatedSkill = await readFile(
      join(projectRoot, ".kimi", "skills", "omk-kimi-runtime", "SKILL.md"),
      "utf-8"
    );
    assert.match(generatedSkill, /Kimi K2\.6 runtime/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

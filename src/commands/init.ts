import { mkdir, writeFile, readFile, copyFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "node:url";
import { getProjectRoot, pathExists } from "../util/fs.js";
import { getOmkVersionSync } from "../util/version.js";

import { style, header, status } from "../util/theme.js";
import { defaultLspConfigJson } from "../lsp/default-config.js";
import { t } from "../util/i18n.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

const OKABE_AGENT_YAML = `version: 1
agent:
  extend: default
  name: omk-okabe-base
  tools:
    - "kimi_cli.tools.agent:Agent"
    - "kimi_cli.tools.ask_user:AskUserQuestion"
    - "kimi_cli.tools.todo:SetTodoList"
    - "kimi_cli.tools.shell:Shell"
    - "kimi_cli.tools.file:ReadFile"
    - "kimi_cli.tools.file:ReadMediaFile"
    - "kimi_cli.tools.file:Glob"
    - "kimi_cli.tools.file:Grep"
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.web:SearchWeb"
    - "kimi_cli.tools.web:FetchURL"
    - "kimi_cli.tools.plan.enter:EnterPlanMode"
    - "kimi_cli.tools.plan:ExitPlanMode"
    - "kimi_cli.tools.background:TaskList"
    - "kimi_cli.tools.background:TaskOutput"
    - "kimi_cli.tools.background:TaskStop"
    # D-Mail checkpoints: real save/restore substance via MCP tools
    #   omk_save_checkpoint   -> capture git diff + todos + state
    #   omk_list_checkpoints  -> browse saved checkpoints
    #   omk_restore_checkpoint -> apply patch and restore run files
    - "kimi_cli.tools.dmail:SendDMail"
`;

const ROOT_AGENT_YAML = `version: 1
agent:
  extend: ./okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-root
  system_prompt_path: ../prompts/root.md
  system_prompt_args:
    OMK_ROLE: "root-coordinator"
  subagents:
    explorer:
      path: ./roles/explorer.yaml
      description: "Read-only repository exploration and context mapping"
    planner:
      path: ./roles/planner.yaml
      description: "Architecture, refactor, migration, and implementation planning"
    coder:
      path: ./roles/coder.yaml
      description: "Scoped implementation in the current project"
    reviewer:
      path: ./roles/reviewer.yaml
      description: "Adversarial code review and risk detection"
    qa:
      path: ./roles/qa.yaml
      description: "Run and analyze lint, typecheck, test, and build results"
`;

const ROLE_YAMLS: Record<string, string> = {
  interviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-interviewer
  system_prompt_args:
    OMK_ROLE: "interviewer"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  architect: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-architect
  system_prompt_args:
    OMK_ROLE: "architect"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  planner: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-planner
  system_prompt_args:
    OMK_ROLE: "planner"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  explorer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-explorer
  system_prompt_args:
    OMK_ROLE: "explorer"
`,
  coder: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-coder
  system_prompt_args:
    OMK_ROLE: "coder"
`,
  reviewer: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-reviewer
  system_prompt_args:
    OMK_ROLE: "reviewer"
  exclude_tools:
    - "kimi_cli.tools.file:WriteFile"
    - "kimi_cli.tools.file:StrReplaceFile"
    - "kimi_cli.tools.shell:Shell"
`,
  qa: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-qa
  system_prompt_args:
    OMK_ROLE: "qa"
`,
  integrator: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-integrator
  system_prompt_args:
    OMK_ROLE: "integrator"
`,
  researcher: `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-researcher
  system_prompt_args:
    OMK_ROLE: "researcher"
`,
  "vision-debugger": `version: 1
agent:
  extend: ../okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
  name: omk-vision-debugger
  system_prompt_args:
    OMK_ROLE: "vision-debugger"
`,
};

function getDesignMd(version: string): string {
  return `---
title: "Design System"
description: "Project visual identity and design system"
version: "${version}"
---

# DESIGN.md

## Overview

Project visual identity and design system.

## Colors

- Primary: #111827
- Accent: #7C3AED
- Success: #059669
- Warning: #D97706
- Danger: #DC2626

## Typography

- Inter, system-ui

## Rules

- Use tokens before inventing new values.
- Keep components compact and status-aware.
`;
}

const GEMINI_MD = `# GEMINI.md

@./AGENTS.md
@./DESIGN.md

Use AGENTS.md as the canonical project instruction source.
Use DESIGN.md as the canonical visual identity source.
`;

const CLAUDE_MD = `# CLAUDE.md

@./AGENTS.md
@./DESIGN.md

Use AGENTS.md as the canonical project instruction source.
Use DESIGN.md for UI/frontend work.
`;

const ROADMAP_MD = `# Roadmap

## v0.1
- init / doctor / chat / team
- P0 skills
- AGENTS.md / DESIGN.md generation
- quality gate hooks

## v0.2
- Wire controller
- HUD
- run state
- worker logs

## v0.3
- worktree team
- merge queue
- reviewer / qa / integrator agents

## v0.4
- Google DESIGN.md integration
- Stitch skills installer
- screenshot UI review

## v0.5
- MCP project server
- plugin pack
- CI agent mode
`;

const SECURITY_MD = `# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the \`security\` label.

## Built-in Protections

oh-my-kimi includes default hooks to block destructive commands and secret leakage.

## Best Practices

- Review hooks before running in production repositories.
- Use \`--print\` mode only in disposable worktrees.
- Never commit secrets into agent memory files.
`;

const ROOT_PROMPT_MD = `# oh-my-kimi Root Agent

You are the oh-my-kimi root coordinator.

You must operate as a Kimi-native coding orchestrator.

## Loaded Project Instructions

\${KIMI_AGENTS_MD}

## Loaded Skills

\${KIMI_SKILLS}

## Global Rules

- Apply AGENTS.md silently.
- Do not repeat boilerplate.
- Use SetTodoList for multi-step tasks.
- Use Agent tool for non-trivial tasks.
- Use skills when relevant.
- Use MCP tools when configured and useful.
- Treat project-local ontology graph memory as mandatory when the omk-project MCP exposes memory tools.
- Recall relevant project memory before work, write durable findings through omk_write_memory, and use omk_memory_mindmap/omk_graph_query for graph recall.
- Prefer plan-first execution.
- Prefer small, reviewable diffs.
- Verify before completion.
- Never claim tests passed unless they were run.

## Kimi-native Context Tools

- Root and generated role agents inherit an Okabe-compatible base that keeps default tools and adds SendDMail for checkpoint rollback scenarios.
- Use D-Mail before risky refactors, compaction, or long-running branch points: send a concise future-facing recovery note to the relevant checkpoint.
- Use Kimi subagents for isolated context and parallel work; keep the root context focused on decisions, integration, and verification.
- Prefer /compact or a D-Mail recovery note over dumping large history back into the prompt.

## Required Workflow

For non-trivial tasks:

1. Read project instructions.
2. Create todos.
3. Launch an appropriate subagent:
   - explore for repository discovery
   - plan for architecture/refactor/risky work
   - coder for implementation
4. Read relevant skills.
5. Use MCP if useful.
6. Implement minimal changes.
7. Run quality gates.
8. Review final diff.
9. Return factual final report.

## Final Report Format

\`\`\`txt
Changed:
Files:
Commands:
Result:
Risk:
\`\`\`
`;

async function copyTemplateDir(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyTemplateDir(srcPath, destPath);
    } else {
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
    }
  }
}

const HOOK_SCRIPTS: Record<string, string> = {
  "pre-shell-guard.sh": `#!/usr/bin/env bash
# PreShellUse Guard — blocks dangerous commands
set -e

# Close security gate if jq/python3 is missing (deny by default)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 not installed — pre-shell-guard cannot validate commands"}}'
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))')
ARGS=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("args",""))')

FULL="$COMMAND $ARGS"

# Block list
BLOCKED=(
  "rm -rf /"
  "rm -rf ~"
  "sudo"
  "git push --force"
  "git push -f"
  "git clean -fdx"
  "chmod -R 777"
  "docker system prune"
  "kubectl delete"
  "aws s3 rm --recursive"
  "curl | bash"
  "curl | sh"
  "wget | bash"
  "wget | sh"
  "mkfs"
  "dd if="
  "> /dev/"
  ":(){ :|:& };:"
)

for pattern in "\${BLOCKED[@]}"; do
  if [[ "$FULL" == *"$pattern"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Potentially destructive command blocked by pre-shell-guard"}}'
    exit 0
  fi
done

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
`,
  "protect-secrets.sh": `#!/usr/bin/env bash
# Secret/environment variable protection
set -e

# Close security gate if jq/python3 is missing (deny by default)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"python3 not installed — protect-secrets cannot validate files"}}'
  exit 0
fi

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')
CONTENT=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("content",""))')

# Block direct modification of sensitive files
SENSITIVE_PATHS=(".env" ".pem" ".key" "id_rsa" "id_ed25519" "credentials" "service-account" ".p12" ".pfx" ".keystore")
for sp in "\${SENSITIVE_PATHS[@]}"; do
  if [[ "$FILEPATH" == *"$sp"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct modification of sensitive file blocked: '"$sp"'"}}'
    exit 0
  fi
done

# Keyword detection (JWT, cloud tokens, private keys, etc.)
if echo "$CONTENT" | grep -qiE '(password|secret|api_key|auth|bearer|token|private_key|aws_access_key_id|aws_secret_access_key|akiai|asiai|ghp_|github_pat|sk-|glpat-|npm_|pypi_|docker_auth|private.?key|BEGIN .* PRIVATE KEY|ssh-rsa|ssh-ed25519)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Potential secret leak detected"}}'
  exit 0
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
`,
  "post-format.sh": `#!/usr/bin/env bash
# Auto-format after save (single file target)
set -e

if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | $PY -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))')

if [ -z "$FILEPATH" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
  exit 0
fi

# Detect project root and run formatter (target file only)
if [ -f "package.json" ] && [ -f "$FILEPATH" ]; then
  npx prettier --write "$FILEPATH" >/dev/null 2>&1 || true
fi

if [ -f "Cargo.toml" ] && [ -f "$FILEPATH" ]; then
  rustfmt "$FILEPATH" >/dev/null 2>&1 || true
fi

echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
`,
  "stop-verify.sh": `#!/usr/bin/env bash
# Final verification on Stop
set -e

echo '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"allow"}}'
`,
};

const KIMI_CONFIG_TOML = `# oh-my-kimi generated Kimi config
# Lifecycle hook settings

[[hooks]]
event = "PreToolUse"
matcher = "Shell"
command = ".omk/hooks/pre-shell-guard.sh"
timeout = 5

[[hooks]]
event = "PreToolUse"
matcher = "WriteFile|StrReplaceFile"
command = ".omk/hooks/protect-secrets.sh"
timeout = 5

[[hooks]]
event = "PostToolUse"
matcher = "WriteFile|StrReplaceFile"
command = ".omk/hooks/post-format.sh"
timeout = 20

[[hooks]]
event = "Stop"
command = ".omk/hooks/stop-verify.sh"
timeout = 30
`;

const MCP_JSON = {
  mcpServers: {
    // Safe default for open-source scaffolds: local project server only.
    // Remote MCPs that require API keys should be added explicitly by the user.
    "omk-project": {
      command: "node",
      args: [join(packageRoot, "dist/mcp/omk-project-server.js")],
    },
  },
};

const CONFIG_TOML = `# oh-my-kimi project settings
[project]
name = "my-project"
description = ""

[orchestration]
default_workers = 2
max_retries = 3
approval_policy = "auto"         # safe default: safe tools auto, destructive ask
yolo_mode = false                # safe guards still block secrets/destructive shell hooks

[runtime]
# auto chooses lite on <=18GB RAM hosts to make 16GB laptops usable.
resource_profile = "auto"        # auto | lite | standard
mcp_scope = "project"            # limit MCP discovery to project scope
skills_scope = "project"         # limit skills discovery to project scope
max_workers = 1                  # can override with OMK_MAX_WORKERS
max_output_mb = 4                # cap buffered shell/quality output
wire_output_mb = 1               # cap per-task retained wire output

[ensemble]
# Role-aware agent ensemble. Keep max_parallel=1 for 16GB/WSL safety.
enabled = true
max_candidates_per_node = 2
max_parallel = 1
quorum_ratio = 0.5

[quality]
lint = "auto"      # auto | command
test = "auto"
typecheck = "auto"
build = "auto"

[memory]
# Project-local ontology graph is the default source of truth for project/session memory.
# Optional external Neo4j credentials must stay in env vars or a secret manager.
backend = "local_graph"    # file | local_graph | neo4j | dual | kuzu
scope = "project-session"
strict = true               # fail memory writes if the selected graph backend is unavailable
mirror_files = true         # keep .omk/memory/*.md as readable mirrors
migrate_files = true        # seed the graph from existing .omk/memory files on first read

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"

[neo4j]
uri_env = "OMK_NEO4J_URI"
username_env = "OMK_NEO4J_USERNAME"
password_env = "OMK_NEO4J_PASSWORD"
database_env = "OMK_NEO4J_DATABASE"
uri = "bolt://localhost:7687"
username = "neo4j"
database = "neo4j"
auth = "basic"             # basic | none

[locale]
# UI language: en (default) | ko | ja
language = "en"

[theme]
# Custom logo image path for terminal welcome banner
# Relative paths are resolved from project root; absolute paths also work
# Example: logo_image = "kimicat.png"  or  logo_image = "M:\\oh-my-kimi\\kimicat.png"
# Supported formats: PNG, JPEG, GIF (high-res on iTerm/Konsole, else ANSI block)
logo_image = "kimicat.png"

[router]
default_model = "kimi-k2.6"
research_thinking = "disabled"
coding_thinking = "enabled"
`;

const MEMORY_FILES: Record<string, string> = {
  "project.md": "# Project Memory\n\nThe project-local ontology graph (.omk/memory/graph-state.json) is the source of truth; this file is a human-readable mirror.\n",
  "decisions.md": "# Decisions\n\nRecord important architecture/design decisions. Also decomposed into Decision nodes in the local graph memory.\n",
  "commands.md": "# Frequently Used Commands\n\nCommand mirror maintained alongside the local graph memory.\n\n```bash\n# example\n```\n",
  "risks.md": "# Known Risks\n\n- \n",
};

export async function initCommand(options: { profile: string }): Promise<void> {
  const root = getProjectRoot();
  console.log(header(`oh-my-kimi init (profile: ${options.profile})`));

  // 1. Create directories (parallel)
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/checkpoints",
    ".omk/agents/roles",
    ".omk/prompts/role-addons",
    ".omk/hooks",
    ".omk/worktrees",
    ".omk/logs",
    ".omk/snippets",
    ".kimi/skills",
    ".kimi/hooks",
    ".agents/skills",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(root, d), { recursive: true })));

  // 2. Write AGENTS.md (skip if exists)
  const agentsMdPath = join(root, "AGENTS.md");
  if (await pathExists(agentsMdPath)) {
    console.log(t("init.agentsMdExists"));
  } else {
    const agentsMdContent = await readFile(join(packageRoot, "templates", "AGENTS.md"), "utf8");
    await writeFile(agentsMdPath, agentsMdContent);
  }

  // 2.5 Write .kimi/AGENTS.md (Kimi-specific rules)
  const kimiAgentsMdPath = join(root, ".kimi", "AGENTS.md");
  if (await pathExists(kimiAgentsMdPath)) {
    console.log(t("init.kimiAgentsMdExists"));
  } else {
    const kimiAgentsMdContent = await readFile(join(packageRoot, "templates", ".kimi", "AGENTS.md"), "utf8");
    await writeFile(kimiAgentsMdPath, kimiAgentsMdContent);
  }

  // 3. Write / migrate agents (parallel)
  const okabeYamlPath = join(root, ".omk/agents/okabe.yaml");
  await writeFile(okabeYamlPath, OKABE_AGENT_YAML);

  const rootYamlPath = join(root, ".omk/agents/root.yaml");
  if (await pathExists(rootYamlPath)) {
    // Existing root.yaml migration: fix relative path bug
    const existing = await readFile(rootYamlPath, "utf8");
    if (existing.includes("system_prompt_path: ./prompts/root.md")) {
      const migrated = existing.replace(
        /system_prompt_path:\s*\.\/prompts\/root\.md/,
        "system_prompt_path: ../prompts/root.md"
      );
      await writeFile(rootYamlPath, migrated);
      console.log(status.ok(t("init.rootYamlMigrated")));
    }
  } else {
    await writeFile(rootYamlPath, ROOT_AGENT_YAML);
  }
  await Promise.all(
    Object.entries(ROLE_YAMLS).map(([name, content]) =>
      writeFile(join(root, ".omk/agents/roles", `${name}.yaml`), content)
    )
  );

  // 4. Write prompts
  await writeFile(join(root, ".omk/prompts/root.md"), ROOT_PROMPT_MD);

  // 5+6. Copy skills from package templates (parallel)
  const kimiSkillsSrc = join(packageRoot, "templates", "skills", "kimi");
  const agentsSkillsSrc = join(packageRoot, "templates", "skills", "agents");
  const skillCopies = [];
  if (await pathExists(kimiSkillsSrc)) {
    console.log(style.purple(t("init.copyKimiSkills")));
    skillCopies.push(copyTemplateDir(kimiSkillsSrc, join(root, ".kimi", "skills")));
  } else {
    console.log(status.warn(t("init.kimiSkillsMissing")));
  }
  if (await pathExists(agentsSkillsSrc)) {
    console.log(style.purple(t("init.copyPortableSkills")));
    skillCopies.push(copyTemplateDir(agentsSkillsSrc, join(root, ".agents", "skills")));
  } else {
    console.log(status.warn(t("init.portableSkillsMissing")));
  }
  if (skillCopies.length > 0) await Promise.all(skillCopies);

  // 7. Write hooks (parallel)
  await Promise.all(
    Object.entries(HOOK_SCRIPTS).map(async ([name, content]) => {
      const hookPath = join(root, ".omk/hooks", name);
      await writeFile(hookPath, content, { mode: 0o755 });
    })
  );

  // 8. Write configs
  await writeFile(join(root, ".omk/config.toml"), CONFIG_TOML);
  await writeFile(join(root, ".omk/kimi.config.toml"), KIMI_CONFIG_TOML);
  await writeFile(join(root, ".omk/mcp.json"), JSON.stringify(MCP_JSON, null, 2) + "\n");
  const kimiMcpJsonPath = join(root, ".kimi/mcp.json");
  if (!(await pathExists(kimiMcpJsonPath))) {
    await writeFile(
      kimiMcpJsonPath,
      JSON.stringify({ _comment: "SearchWeb and FetchURL are built-in Kimi tools.", mcpServers: {} }, null, 2) + "\n"
    );
  }
  await writeFile(join(root, ".omk/lsp.json"), defaultLspConfigJson());

  const bundledLogoPath = join(packageRoot, "kimicat.png");
  const projectLogoPath = join(root, "kimicat.png");
  if (await pathExists(bundledLogoPath)) {
    if (await pathExists(projectLogoPath)) {
      console.log(t("init.kimicatPngExists"));
    } else {
      await copyFile(bundledLogoPath, projectLogoPath);
    }
  } else {
    console.log(status.warn(t("init.kimicatPngMissing")));
  }

  // 9. Write memory files (parallel)
  await Promise.all(
    Object.entries(MEMORY_FILES).map(([name, content]) =>
      writeFile(join(root, ".omk/memory", name), content)
    )
  );

  // 9.5. Copy default snippet templates if they exist
  const snippetsSrc = join(packageRoot, "templates", "snippets");
  const snippetsDest = join(root, ".omk", "snippets");
  if (await pathExists(snippetsSrc)) {
    console.log(style.purple("   📦 Copying snippet templates..."));
    await copyTemplateDir(snippetsSrc, snippetsDest);
  }

  // 9.6. Copy spec-kit OMK preset template
  const presetSrc = join(packageRoot, "templates", "spec-kit-omk-preset");
  const presetDest = join(root, ".omk", "templates", "spec-kit-omk-preset");
  if (await pathExists(presetSrc)) {
    console.log(style.purple("   📦 Copying spec-kit OMK preset..."));
    await copyTemplateDir(presetSrc, presetDest);
  }

  // 10. Write project docs (skip if already exist)
  const docs: Record<string, string> = {
    "DESIGN.md": getDesignMd(getOmkVersionSync()),
    "GEMINI.md": GEMINI_MD,
    "CLAUDE.md": CLAUDE_MD,
    "ROADMAP.md": ROADMAP_MD,
    "SECURITY.md": SECURITY_MD,
  };
  for (const [name, content] of Object.entries(docs)) {
    const docPath = join(root, name);
    if (await pathExists(docPath)) {
      console.log(`   ℹ️ ${name} already exists — skipping`);
    } else {
      await writeFile(docPath, content);
    }
  }

  console.log(status.success("oh-my-kimi initialized."));
  console.log();
  console.log("Created:");
  console.log("- AGENTS.md");
  console.log("- .kimi/AGENTS.md");
  console.log("- DESIGN.md");
  console.log("- .omk/agents/root.yaml");
  console.log("- .omk/lsp.json");
  console.log("- kimicat.png");
  console.log("- .kimi/mcp.json");
  console.log("- .kimi/skills/");
  console.log("- .agents/skills/");
  console.log("- .omk/memory/");
  console.log("- .omk/templates/spec-kit-omk-preset/");
  console.log();
  console.log("Default behavior:");
  console.log("- AGENTS.md is loaded into Kimi root prompt.");
  console.log("- Todo list is required for multi-step work.");
  console.log("- Subagents are required for non-trivial work.");
  console.log("- Skills are auto-discovered.");
  console.log("- MCP tools are used when configured.");
  console.log("- Built-in tools: SearchWeb, FetchURL (no config required).");

  // Global ~/.kimi/ sync is opt-in only for open-source safety.
  // Users can run `omk sync --global` explicitly after init if they want global config.
  console.log(style.gray("  Global config sync skipped. Run `omk sync --global` to write to ~/.kimi/"));

  // ── Shell integration & PATH check ──
  const pathCheck = await checkOmkInPath();
  if (!pathCheck.inPath) {
    console.log("");
    console.log(style.orange("⚠️  omk is not in PATH."));
    console.log(style.gray("   Run one of the following:"));
    console.log(style.gray("   1) npm install -g oh-my-kimi"));
    console.log(style.gray("   2) npm link (for development)"));
    console.log(style.gray("   3) alias omk='npx oh-my-kimi'"));
  } else {
    await maybeInstallShellCompletion(root);
  }

  console.log("");
  console.log(style.purpleBold("   Next steps: ") + style.cream("omk doctor → omk chat"));
}

async function checkOmkInPath(): Promise<{ inPath: boolean }> {
  try {
    const result = await import("../util/shell.js").then((m) => m.runShell("which", ["omk"], { timeout: 3000 }));
    return { inPath: !result.failed && result.stdout.trim().length > 0 };
  } catch {
    return { inPath: false };
  }
}

async function maybeInstallShellCompletion(_root: string): Promise<void> {
  const bashrc = join(process.env.HOME || process.env.USERPROFILE || "", ".bashrc");
  const zshrc = join(process.env.HOME || process.env.USERPROFILE || "", ".zshrc");

  const omkAliasBlock = `# >>> omk shell integration
export OMK_STAR_PROMPT=1
export OMK_RENDER_LOGO=1
# <<< end omk shell integration`;

  for (const rcFile of [bashrc, zshrc]) {
    if (!(await pathExists(rcFile))) continue;
    try {
      const content = await readFile(rcFile, "utf-8");
      if (content.includes("omk shell integration")) continue;
      await writeFile(rcFile, content.trimEnd() + "\n\n" + omkAliasBlock + "\n");
      console.log(status.ok(`Shell integration added: ${rcFile}`));
    } catch {
      // ignore
    }
  }
}

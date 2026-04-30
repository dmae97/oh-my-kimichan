import { mkdir, writeFile, readFile, symlink, access, constants, copyFile, readdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "node:url";
import { getProjectRoot, pathExists, syncAllKimiGlobals } from "../util/fs.js";
import { isGitRepo } from "../util/git.js";
import { runShell } from "../util/shell.js";
import { style, header, status } from "../util/theme.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..", "..");

const ROOT_AGENT_YAML = `version: 1
agent:
  extend: default
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
  extend: default
  name: omk-interviewer
  system_prompt_args:
    OMK_ROLE: "interviewer"
  exclude_tools:
    - WriteFile
    - StrReplaceFile
    - applyDiff
    - Shell
`,
  architect: `version: 1
agent:
  extend: default
  name: omk-architect
  system_prompt_args:
    OMK_ROLE: "architect"
  exclude_tools:
    - WriteFile
    - StrReplaceFile
    - applyDiff
    - Shell
`,
  planner: `version: 1
agent:
  extend: default
  name: omk-planner
  system_prompt_args:
    OMK_ROLE: "planner"
  exclude_tools:
    - WriteFile
    - StrReplaceFile
    - applyDiff
    - Shell
`,
  explorer: `version: 1
agent:
  extend: default
  name: omk-explorer
  system_prompt_args:
    OMK_ROLE: "explorer"
`,
  coder: `version: 1
agent:
  extend: default
  name: omk-coder
  system_prompt_args:
    OMK_ROLE: "coder"
`,
  reviewer: `version: 1
agent:
  extend: default
  name: omk-reviewer
  system_prompt_args:
    OMK_ROLE: "reviewer"
  exclude_tools:
    - WriteFile
    - StrReplaceFile
    - applyDiff
    - Shell
`,
  qa: `version: 1
agent:
  extend: default
  name: omk-qa
  system_prompt_args:
    OMK_ROLE: "qa"
`,
  integrator: `version: 1
agent:
  extend: default
  name: omk-integrator
  system_prompt_args:
    OMK_ROLE: "integrator"
`,
  researcher: `version: 1
agent:
  extend: default
  name: omk-researcher
  system_prompt_args:
    OMK_ROLE: "researcher"
`,
  "vision-debugger": `version: 1
agent:
  extend: default
  name: omk-vision-debugger
  system_prompt_args:
    OMK_ROLE: "vision-debugger"
`,
};

const DESIGN_MD = `---
title: "Design System"
description: "Project visual identity and design system"
version: "1.0"
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
- Prefer plan-first execution.
- Prefer small, reviewable diffs.
- Verify before completion.
- Never claim tests passed unless they were run.

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
# PreShellUse Guard — 위험 명령 차단
set -e

# jq/python3 없으면 보안 게이트를 닫음 (deny by default)
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

# 차단 목록
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
# Secret/환경변수 보호
set -e

# jq/python3 없으면 보안 게이트를 닫음 (deny by default)
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

# 민감 파일 직접 수정 차단
SENSITIVE_PATHS=(".env" ".pem" ".key" "id_rsa" "id_ed25519" "credentials" "service-account" ".p12" ".pfx" ".keystore")
for sp in "\${SENSITIVE_PATHS[@]}"; do
  if [[ "$FILEPATH" == *"$sp"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct modification of sensitive file blocked: '"$sp"'"}}'
    exit 0
  fi
done

# 키워드 탐지 (JWT, cloud tokens, private keys 포함)
if echo "$CONTENT" | grep -qiE '(password|secret|api_key|auth|bearer|token|private_key|aws_access_key_id|aws_secret_access_key|akiai|asiai|ghp_|github_pat|sk-|glpat-|npm_|pypi_|docker_auth|private.?key|BEGIN .* PRIVATE KEY|ssh-rsa|ssh-ed25519)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Potential secret leak detected"}}'
  exit 0
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
`,
  "post-format.sh": `#!/usr/bin/env bash
# 저장 후 자동 포맷팅 (단일 파일 대상)
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

# 프로젝트 루트 감지 및 포맷터 실행 (대상 파일만)
if [ -f "package.json" ] && [ -f "$FILEPATH" ]; then
  npx prettier --write "$FILEPATH" >/dev/null 2>&1 || true
fi

if [ -f "Cargo.toml" ] && [ -f "$FILEPATH" ]; then
  rustfmt "$FILEPATH" >/dev/null 2>&1 || true
fi

echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"allow"}}'
`,
  "stop-verify.sh": `#!/usr/bin/env bash
# Stop 시 최종 검증
set -e

echo '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"allow"}}'
`,
};

const KIMI_CONFIG_TOML = `# oh-my-kimichan generated Kimi config
# 생명주기 hook 설정

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
    context7: {
      url: "https://mcp.context7.com/mcp",
      headers: {
        CONTEXT7_API_KEY: "\${CONTEXT7_API_KEY}",
      },
    },
    "lean-ctx": {
      command: "lean-ctx",
      args: [],
    },
    github: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y @modelcontextprotocol/server-github",
      ],
    },
    "gh_grep": {
      url: "https://mcp.grep.app",
      transport: "http",
    },
    fetch: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec uvx mcp-server-fetch",
      ],
    },
    playwright: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y @playwright/mcp@latest --isolated",
      ],
    },
    "chrome-devtools": {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y chrome-devtools-mcp@latest --isolated",
      ],
    },
    firecrawl: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y firecrawl-mcp",
      ],
    },
    "sequential-thinking": {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y @modelcontextprotocol/server-sequential-thinking",
      ],
    },
    memory: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y @modelcontextprotocol/server-memory",
      ],
    },
    filesystem: {
      command: "bash",
      args: [
        "-lc",
        "set -a; source ~/.config/opencode/secrets.env 2>/dev/null; set +a; exec npx -y @modelcontextprotocol/server-filesystem /home/dmae/.kimi",
      ],
    },
    "omk-project": {
      command: "node",
      args: [join(packageRoot, "dist/mcp/omk-project-server.js")],
    },
  },
};

const CONFIG_TOML = `# oh-my-kimichan 프로젝트 설정
[project]
name = "my-project"
description = ""

[orchestration]
default_workers = 2
max_retries = 3
approval_policy = "interactive"  # interactive | auto | yolo

[quality]
lint = "auto"      # auto | 명령어
test = "auto"
typecheck = "auto"
build = "auto"

[router]
default_model = "kimi-k2.6"
research_thinking = "disabled"
coding_thinking = "enabled"
`;

const MEMORY_FILES: Record<string, string> = {
  "project.md": "# 프로젝트 메모리\n\n프로젝트 전반 컨텍스트를 기록합니다.\n",
  "decisions.md": "# 결정 사항\n\n중요한 아키텍처/설계 결정을 기록합니다.\n",
  "commands.md": "# 자주 쓰는 명령어\n\n\`\`\`bash\n# 예시\n\`\`\`\n",
  "risks.md": "# 알려진 리스크\n\n- \n",
};

async function ensureExecutable(path: string): Promise<void> {
  await runShell("chmod", ["+x", path], { timeout: 5000 });
}

export async function initCommand(options: { profile: string }): Promise<void> {
  const root = getProjectRoot();
  console.log(header(`oh-my-kimichan init (profile: ${options.profile})`));

  // 1. Create directories (병렬)
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/agents/roles",
    ".omk/prompts/role-addons",
    ".omk/hooks",
    ".omk/worktrees",
    ".omk/logs",
    ".kimi/skills",
    ".kimi/hooks",
    ".agents/skills",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(root, d), { recursive: true })));

  // 2. Write AGENTS.md (skip if exists)
  const agentsMdPath = join(root, "AGENTS.md");
  if (await pathExists(agentsMdPath)) {
    console.log("   ℹ️ AGENTS.md 이미 존재 — 건너뜀");
  } else {
    const agentsMdContent = await readFile(join(packageRoot, "templates", "AGENTS.md"), "utf8");
    await writeFile(agentsMdPath, agentsMdContent);
  }

  // 2.5 Write .kimi/AGENTS.md (Kimi-specific rules)
  const kimiAgentsMdPath = join(root, ".kimi", "AGENTS.md");
  if (await pathExists(kimiAgentsMdPath)) {
    console.log("   ℹ️ .kimi/AGENTS.md 이미 존재 — 건너뜀");
  } else {
    const kimiAgentsMdContent = await readFile(join(packageRoot, "templates", ".kimi", "AGENTS.md"), "utf8");
    await writeFile(kimiAgentsMdPath, kimiAgentsMdContent);
  }

  // 3. Write / migrate agents (병렬)
  const rootYamlPath = join(root, ".omk/agents/root.yaml");
  if (await pathExists(rootYamlPath)) {
    // 기존 root.yaml 마이그레이션: 상대 경로 버그 수정
    const existing = await readFile(rootYamlPath, "utf8");
    if (existing.includes("system_prompt_path: ./prompts/root.md")) {
      const migrated = existing.replace(
        /system_prompt_path:\s*\.\/prompts\/root\.md/,
        "system_prompt_path: ../prompts/root.md"
      );
      await writeFile(rootYamlPath, migrated);
      console.log(status.ok("기존 root.yaml 마이그레이션 완료 (prompts 경로 수정)"));
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

  // 5+6. Copy skills from package templates (병렬)
  const kimiSkillsSrc = join(packageRoot, "templates", "skills", "kimi");
  const agentsSkillsSrc = join(packageRoot, "templates", "skills", "agents");
  const skillCopies = [];
  if (await pathExists(kimiSkillsSrc)) {
    console.log(style.blue("   📦 Kimi skills 복사 중..."));
    skillCopies.push(copyTemplateDir(kimiSkillsSrc, join(root, ".kimi", "skills")));
  } else {
    console.log(status.warn("Kimi skills 템플릿 없음 — templates/skills/kimi 확인"));
  }
  if (await pathExists(agentsSkillsSrc)) {
    console.log(style.blue("   📦 Portable skills 복사 중..."));
    skillCopies.push(copyTemplateDir(agentsSkillsSrc, join(root, ".agents", "skills")));
  } else {
    console.log(status.warn("Portable skills 템플릿 없음 — templates/skills/agents 확인"));
  }
  if (skillCopies.length > 0) await Promise.all(skillCopies);

  // 7. Write hooks (병렬)
  await Promise.all(
    Object.entries(HOOK_SCRIPTS).map(async ([name, content]) => {
      const hookPath = join(root, ".omk/hooks", name);
      await writeFile(hookPath, content);
      await ensureExecutable(hookPath);
    })
  );

  // 8. Write configs
  await writeFile(join(root, ".omk/config.toml"), CONFIG_TOML);
  await writeFile(join(root, ".omk/kimi.config.toml"), KIMI_CONFIG_TOML);
  await writeFile(join(root, ".omk/mcp.json"), JSON.stringify(MCP_JSON, null, 2));

  // 9. Write memory files (병렬)
  await Promise.all(
    Object.entries(MEMORY_FILES).map(([name, content]) =>
      writeFile(join(root, ".omk/memory", name), content)
    )
  );

  // 10. Write project docs (skip if already exist)
  const docs: Record<string, string> = {
    "DESIGN.md": DESIGN_MD,
    "GEMINI.md": GEMINI_MD,
    "CLAUDE.md": CLAUDE_MD,
    "ROADMAP.md": ROADMAP_MD,
    "SECURITY.md": SECURITY_MD,
  };
  for (const [name, content] of Object.entries(docs)) {
    const docPath = join(root, name);
    if (await pathExists(docPath)) {
      console.log(`   ℹ️ ${name} 이미 존재 — 건너뜀`);
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
  console.log("- .kimi/skills/");
  console.log("- .agents/skills/");
  console.log("- .omk/memory/");
  console.log();
  console.log("Default behavior:");
  console.log("- AGENTS.md is loaded into Kimi root prompt.");
  console.log("- Todo list is required for multi-step work.");
  console.log("- Subagents are required for non-trivial work.");
  console.log("- Skills are auto-discovered.");
  console.log("- MCP tools are used when configured.");

  // ~/.kimi/ 에 hooks + MCP + skills 무조건 글로벌 동기화
  try {
    await syncAllKimiGlobals();
    console.log(status.ok("~/.kimi/ 글로벌 동기화 완료 (hooks + MCP + skills)"));
  } catch (err) {
    console.warn("⚠️  글로벌 동기화 실패:", (err as Error).message);
  }

  console.log(style.purpleBold("   다음 단계: ") + style.cream("omk doctor → omk chat"));
}

import { mkdir, writeFile, symlink, access, constants, copyFile, readdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { getProjectRoot, pathExists } from "../util/fs.js";
import { isGitRepo } from "../util/git.js";
import { runShell } from "../util/shell.js";

const AGENTS_MD = `# AGENTS.md

## Project

oh-my-kimi is a Kimi Code CLI orchestration harness.

## Commands

\`\`\`bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
\`\`\`

## Agent Rules

* Read this file before implementation.
* Read \`DESIGN.md\` before UI/frontend work.
* Use \`.omk/memory/project.md\` for stable project facts.
* Do not edit secrets.
* Do not claim tests passed unless commands were run.
* Prefer small, reviewable diffs.
* Use worktrees for parallel implementation.

## Quality Gates

Before completion, run available checks:

\`\`\`bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
\`\`\`

## Protected Files

\`\`\`txt
.env
.env.*
*.pem
*.key
credentials.json
service-account*.json
\`\`\`
`;

const ROOT_AGENT_YAML = `version: 1
agent:
  extend: default
  name: omk-root
  system_prompt_path: ../prompts/root.md
  system_prompt_args:
    OMK_ROLE: "root-coordinator"
    OMK_MEMORY_PATH: ".omk/memory/project.md"
  subagents:
    architect:
      path: ./roles/architect.yaml
      description: "Read-only architecture planning"
    explorer:
      path: ./roles/explorer.yaml
      description: "Fast codebase exploration"
    reviewer:
      path: ./roles/reviewer.yaml
      description: "Adversarial code review"
    qa:
      path: ./roles/qa.yaml
      description: "Test and verification"
`;

const ROLE_YAMLS: Record<string, string> = {
  interviewer: `version: 1
agent:
  extend: default
  name: omk-interviewer
  system_prompt_args:
    OMK_ROLE: "interviewer"
  thinking: enabled
  restrictions:
    write: false
`,
  architect: `version: 1
agent:
  extend: default
  name: omk-architect
  system_prompt_args:
    OMK_ROLE: "architect"
  thinking: enabled
  restrictions:
    write: false
    shell: false
`,
  explorer: `version: 1
agent:
  extend: default
  name: omk-explorer
  system_prompt_args:
    OMK_ROLE: "explorer"
  thinking: disabled
`,
  coder: `version: 1
agent:
  extend: default
  name: omk-coder
  system_prompt_args:
    OMK_ROLE: "coder"
  thinking: enabled
`,
  reviewer: `version: 1
agent:
  extend: default
  name: omk-reviewer
  system_prompt_args:
    OMK_ROLE: "reviewer"
  thinking: enabled
  restrictions:
    write: false
`,
  qa: `version: 1
agent:
  extend: default
  name: omk-qa
  system_prompt_args:
    OMK_ROLE: "qa"
  thinking: enabled
`,
  integrator: `version: 1
agent:
  extend: default
  name: omk-integrator
  system_prompt_args:
    OMK_ROLE: "integrator"
  thinking: enabled
`,
  researcher: `version: 1
agent:
  extend: default
  name: omk-researcher
  system_prompt_args:
    OMK_ROLE: "researcher"
  thinking: disabled
`,
  "vision-debugger": `version: 1
agent:
  extend: default
  name: omk-vision-debugger
  system_prompt_args:
    OMK_ROLE: "vision-debugger"
  thinking: enabled
  capabilities:
    vision: true
`,
};

const DESIGN_MD = `# DESIGN.md

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
- init / doctor / chat
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

const ROOT_PROMPT_MD = `# OMK Root Coordinator System Prompt

당신은 oh-my-kimichan의 루트 코디네이터입니다.

## 역할
- 사용자 요구사항을 인터뷰하고 명확히 합니다.
- DAG 기반 실행 계획을 수립합니다.
- Worker를 분배하고 진행 상황을 추적합니다.
- 품질 게이트 통과 전까지 완료를 금지합니다.
- Merge Queue를 관리합니다.

## 제약
- Shell 실행은 approval gateway를 거칩니다.
- 파일 쓰기는 worktree 할당된 범위 내에서만 가능합니다.
- 256K context를 낭비하지 않도록 선택적 읽기를 수행합니다.

## 도구
- Kimi built-in Agent tool
- AskUserQuestion
- SetTodoList
- ReadFile, Glob, Grep (read-only)
- OMK external tools (Wire 등록)

## 메모리 경로
- {{OMK_MEMORY_PATH}}
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

INPUT=\$(cat)
COMMAND=\$(echo "\$INPUT" | jq -r '.tool_input.command // empty')
ARGS=\$(echo "\$INPUT" | jq -r '.tool_input.args // empty')

FULL="$COMMAND $ARGS"

# 차단 목록
BLOCKED=(
  "rm -rf /"
  "rm -rf ~"
  "sudo"
  "git push --force"
  "git clean -fdx"
  "chmod -R 777"
  "docker system prune"
  "kubectl delete"
  "aws s3 rm --recursive"
)

for pattern in "\${BLOCKED[@]}"; do
  if [[ "\$FULL" == *"\$pattern"* ]]; then
    echo '{"decision": "block", "reason": "Potentially destructive command blocked by pre-shell-guard"}'
    exit 0
  fi
done

echo '{"decision": "allow"}'
`,
  "protect-secrets.sh": `#!/usr/bin/env bash
# Secret/환경변수 보호
set -e

INPUT=\$(cat)
FILEPATH=\$(echo "\$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=\$(echo "\$INPUT" | jq -r '.tool_input.content // empty')

# .env 수정 차단
if [[ "\$FILEPATH" == *".env"* ]] || [[ "\$FILEPATH" == *".env.local"* ]]; then
  echo '{"decision": "block", "reason": "Direct .env modification blocked"}'
  exit 0
fi

# 키워드 탐지
if echo "\$CONTENT" | grep -qiE '(password|secret|api_key|token|private_key)'; then
  echo '{"decision": "block", "reason": "Potential secret leak detected"}'
  exit 0
fi

echo '{"decision": "allow"}'
`,
  "post-format.sh": `#!/usr/bin/env bash
# 저장 후 자동 포맷팅
set -e

# 프로젝트 루트 감지 및 포맷터 실행
if [ -f "package.json" ]; then
  npx prettier --write . >/dev/null 2>&1 || true
fi

if [ -f "Cargo.toml" ]; then
  cargo fmt >/dev/null 2>&1 || true
fi

echo '{"decision": "allow"}'
`,
  "stop-verify.sh": `#!/usr/bin/env bash
# Stop 시 최종 검증
set -e

INPUT=\$(cat)
# 추가 검증 로직 삽입 가능

echo '{"decision": "allow"}'
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
    "context7": {
      url: "https://mcp.context7.com/mcp",
      headers: {
        CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}",
      },
    },
    "omk-project": {
      command: "node",
      args: [".omk/mcp/omk-project-server.js"],
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
  "commands.md": "# 자주 쓰는 명령어\n\n```bash\n# 예시\n```\n",
  "risks.md": "# 알려진 리스크\n\n- \n",
};

async function ensureExecutable(path: string): Promise<void> {
  await runShell("chmod", ["+x", path], { timeout: 5000 });
}

export async function initCommand(options: { profile: string }): Promise<void> {
  const root = getProjectRoot();
  console.log(`🚀 oh-my-kimichan init (profile: ${options.profile})\n`);

  // 1. Create directories
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/agents/roles",
    ".omk/prompts/role-addons",
    ".omk/hooks",
    // skills and flows are now installed under .kimi/skills and .agents/skills
    ".omk/worktrees",
    ".omk/logs",
    ".kimi/skills",
    ".kimi/hooks",
    ".agents/skills",
  ];
  for (const d of dirs) {
    await mkdir(join(root, d), { recursive: true });
  }

  // 2. Write AGENTS.md
  await writeFile(join(root, "AGENTS.md"), AGENTS_MD);

  // 3. Write agents
  await writeFile(join(root, ".omk/agents/root.yaml"), ROOT_AGENT_YAML);
  for (const [name, content] of Object.entries(ROLE_YAMLS)) {
    await writeFile(join(root, ".omk/agents/roles", `${name}.yaml`), content);
  }

  // 4. Write prompts
  await writeFile(join(root, ".omk/prompts/root.md"), ROOT_PROMPT_MD);

  // 5. Copy Kimi-specific skills to .kimi/skills
  const kimiSkillsSrc = join(root, "templates/skills/kimi");
  const kimiSkillsDest = join(root, ".kimi/skills");
  if (await pathExists(kimiSkillsSrc)) {
    await copyTemplateDir(kimiSkillsSrc, kimiSkillsDest);
  }

  // 6. Copy portable skills to .agents/skills
  const agentsSkillsSrc = join(root, "templates/skills/agents");
  const agentsSkillsDest = join(root, ".agents/skills");
  if (await pathExists(agentsSkillsSrc)) {
    await copyTemplateDir(agentsSkillsSrc, agentsSkillsDest);
  }

  // 7. Write hooks
  for (const [name, content] of Object.entries(HOOK_SCRIPTS)) {
    const hookPath = join(root, ".omk/hooks", name);
    await writeFile(hookPath, content);
    await ensureExecutable(hookPath);
  }

  // 8. Write configs
  await writeFile(join(root, ".omk/config.toml"), CONFIG_TOML);
  await writeFile(join(root, ".omk/kimi.config.toml"), KIMI_CONFIG_TOML);
  await writeFile(join(root, ".omk/mcp.json"), JSON.stringify(MCP_JSON, null, 2));

  // 9. Write memory files
  for (const [name, content] of Object.entries(MEMORY_FILES)) {
    await writeFile(join(root, ".omk/memory", name), content);
  }

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
    if (!(await pathExists(docPath))) {
      await writeFile(docPath, content);
    }
  }

  console.log("✅ oh-my-kimichan scaffold 생성 완료!");
  console.log("   다음 단계: omk doctor → omk chat");
}

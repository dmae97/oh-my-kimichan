import { mkdir, writeFile, symlink, access, constants } from "fs/promises";
import { join, relative } from "path";
import { getProjectRoot } from "../util/fs.js";
import { isGitRepo } from "../util/git.js";
import { runShell } from "../util/shell.js";

const AGENTS_MD = `# AGENTS.md — oh-my-kimichan 프로젝트 에이전트 가이드

> 이 프로젝트는 [oh-my-kimichan](https://github.com/your-org/oh-my-kimichan)으로 관리됩니다.

## 역할 구성

- \`root\` — 전체 조정 및 DAG 관리
- \`interviewer\` — 요구사항 인터뷰
- \`architect\` — 아키텍처 설계 (read-only)
- \`explorer\` — 코드베이스 탐색
- \`coder\` — 구현 (worktree 기반)
- \`reviewer\` — 코드 리뷰
- \`qa\` — 테스트 및 검증
- \`integrator\` — 병합 및 충돌 해결
- \`researcher\` — 웹/문서 리서치 (thinking disabled)
- \`vision-debugger\` — UI/스크린샷 분석 (multimodal)

## 메모리 위치

- \`.omk/memory/project.md\` — 프로젝트 컨텍스트
- \`.omk/memory/decisions.md\` — 결정 사항
- \`.omk/memory/commands.md\` — 자주 쓰는 명령어
- \`.omk/memory/risks.md\` — 알려진 리스크

## 품질 게이트

모든 완료는 아래를 통과해야 합니다:

1. lint 통과
2. typecheck 통과
3. test 통과
4. build 통과
5. reviewer 승인

## 안전 규칙

- 원본 브랜치에서 destructive 명령 금지
- \`--print\` 모드는 worktree/sandbox에서만 사용
- secret/credential 수정 금지
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

const SKILL_TEMPLATES: Record<string, string> = {
  "code-review": `---
name: code-review
description: 코드 리뷰 수행
type: skill
---

# 코드 리뷰 스킬

## 목표
제공된 diff나 파일에 대해 체계적인 코드 리뷰를 수행합니다.

## 체크리스트
- [ ] 보안 취약점 (SQL Injection, XSS, secret 노출)
- [ ] 에러 핸들링
- [ ] 타입 안전성
- [ ] 성능 문제
- [ ] 테스트 커버리지
- [ ] 네이밍/가독성

## 출력 형식
\`\`\`json
{
  "summary": "...",
  "issues": [
    { "severity": "critical|warning|info", "line": 0, "message": "..." }
  ],
  "approved": false
}
\`\`\`
`,
  release: `---
name: release
description: 릴리스 워크플로우
type: skill
---

# 릴리스 스킬

1. 버전 범프 (package.json, Cargo.toml 등)
2. CHANGELOG.md 업데이트
3. git tag 생성
4. 빌드/테스트 통과 확인
5. 배포 명령 실행
`,
  "ui-review": `---
name: ui-review
description: UI/스크린샷 리뷰
type: skill
---

# UI 리뷰 스킬

스크린샷이나 비디오를 분석하여:
- 레이아웃 문제
- 접근성(a11y) 위반
- 반응형 깨짐
- 시각적 일관성
을 보고합니다.
`,
  "perf-audit": `---
name: perf-audit
description: 성능 감사
type: skill
---

# 성능 감사 스킬

- 번들 사이즈 분석
- 불필요한 리렌더링 탐지
- 쿼리 N+1 탐지
- 메모리 누수 의심 지점
`,
  "industrial-control-loop": `---
name: industrial-control-loop
description: 제어 루프 및 산업 자동화 코드 분석
type: skill
---

# 산업 제어 루프 스킬

- PLC/ladder logic 검토
- PID 파라미터 타당성
- 안전 인터락(interlock) 확인
- 고장 모드 분석
- 피드백 루프 안정성
`,
};

const FLOW_TEMPLATES: Record<string, string> = {
  "feature-dev": `---
name: feature-dev
description: Full feature development workflow
type: flow
---

\`\`\`mermaid
flowchart TD
  BEGIN --> interview[Clarify user goal and constraints]
  interview --> explore[Explore repository and summarize architecture]
  explore --> plan[Write implementation plan]
  plan --> gate{Is plan specific and testable?}
  gate -->|No| plan
  gate -->|Yes| implement[Implement in isolated worktree or assigned scope]
  implement --> test[Run lint/typecheck/test/build]
  test --> review{Any critical issue?}
  review -->|Yes| implement
  review -->|No| END
\`\`\`
`,
  refactor: `---
name: refactor
description: 안전한 리팩터링 워크플로우
type: flow
---

1. 현재 동작을 보존하는 테스트 작성
2. 리팩터링 수행
3. 테스트 통과 확인
4. diff 리뷰
5. 병합
`,
  bugfix: `---
name: bugfix
description: 버그 수정 워크플로우
type: flow
---

1. 버그 재현 테스트 작성
2. 루트 코즈 분석
3. 최소 수정
4. 회귀 테스트
5. 리뷰 및 병합
`,
  "pr-review": `---
name: pr-review
description: Pull Request 리뷰 워크플로우
type: flow
---

1. PR 설명 및 컨텍스트 파악
2. diff 분석
3. 코드 리뷰 스킬 실행
4. CI 결과 확인
5. 승인/변경 요청
`,
};

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
    ".omk/skills",
    ".omk/flows",
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

  // 5. Write skills
  for (const [name, content] of Object.entries(SKILL_TEMPLATES)) {
    const skillDir = join(root, ".omk/skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), content);
  }

  // 6. Write flows
  for (const [name, content] of Object.entries(FLOW_TEMPLATES)) {
    const flowDir = join(root, ".omk/flows", name);
    await mkdir(flowDir, { recursive: true });
    await writeFile(join(flowDir, "SKILL.md"), content);
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

  // 10. Symlinks .kimi/skills -> .omk/skills
  try {
    const fromKimiSkills = join(root, ".kimi/skills");
    const toOmkSkills = relative(join(root, ".kimi"), join(root, ".omk/skills"));
    await access(fromKimiSkills, constants.F_OK);
    // if exists and empty, remove it to allow symlink
    await runShell("rm", ["-rf", fromKimiSkills], { timeout: 5000 });
    await symlink(toOmkSkills, fromKimiSkills, "dir");
  } catch {
    // ignore symlink errors
  }

  console.log("✅ oh-my-kimichan scaffold 생성 완료!");
  console.log("   다음 단계: omk doctor → omk chat");
}

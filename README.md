# oh-my-kimichan 🚀

> **Kimi Code CLI용 multi-agent orchestration harness**
>
> Kimi K2.6의 long-horizon coding, 256K context, thinking/non-thinking, multimodal, agent swarm 성향을 실제 개발 워크플로로 쓰기 위한 설치형 런타임.

## 개요

`oh-my-kimichan`(이하 OMK)은 Kimi CLI 위에 올라가는 **오케스트레이션 레이어**입니다. Kimi CLI의 agent, subagent, skill, flow, hook, MCP, session, wire, print 기능을 그대로 활용하며, DAG 기반 작업 스케줄링, worktree 기반 병렬 팀, 메모리/컨텍스트 브로커, HUD, 품질 게이트를 추가합니다.

## 설치

```bash
npm install -g oh-my-kimichan
```

또는 로컬:

```bash
git clone https://github.com/your-org/oh-my-kimichan.git
cd oh-my-kimichan
npm install
npm run build
npm link
```

## 사전 요구사항

- Node.js >= 20
- [Kimi CLI](https://moonshotai.github.io/kimi-cli/) 설치 및 인증 완료
- Git
- (선택) tmux — `omk team` 사용 시 권장

## 빠른 시작

```bash
# 1. 프로젝트 초기화
omk init

# 2. 상태 검사
omk doctor

# 3. 대화형 실행
omk chat

# 4. 계획 수립
omk plan "NestJS auth module을 OAuth2 기반으로 리팩터링"

# 5. DAG 기반 장기 작업
omk run feature-dev "관리자 대시보드에 사용자 권한 관리 추가"
```

## 아키텍처

```
User / omk CLI
  └── OMK Controller
        ├── DAG Scheduler
        ├── HUD / Trace Viewer
        ├── Memory & Context Broker
        ├── Safety / Approval Gateway
        └── Kimi Native Layer
              ├── Wire Mode (JSON-RPC)
              ├── Print Mode (non-interactive)
              ├── Agents / Subagents
              ├── Skills / Flows
              ├── Hooks
              └── MCP Servers
```

## CLI 명령어

| 명령 | 설명 |
|------|------|
| `omk init` | 프로젝트에 scaffold 생성 |
| `omk doctor` | Kimi CLI 및 환경 검사 |
| `omk chat` | 대화형 root coordinator 실행 |
| `omk plan <goal>` | 계획 수립 |
| `omk run <flow> <goal>` | DAG 기반 장기 작업 |
| `omk team <goal> --workers N` | 병렬 팀 실행 |
| `omk hud` | 현재 run 상태 보기 |
| `omk merge --run latest` | 결과 병합 |
| `omk sync` | Kimi assets 재생성 |

## 프로젝트 구조

```
project/
  AGENTS.md
  .omk/
    config.toml
    agents/
      root.yaml
      roles/
        interviewer.yaml
        architect.yaml
        explorer.yaml
        coder.yaml
        reviewer.yaml
        qa.yaml
        integrator.yaml
        researcher.yaml
        vision-debugger.yaml
    skills/
      code-review/
      release/
      ui-review/
      perf-audit/
      industrial-control-loop/
    flows/
      feature-dev/
      refactor/
      bugfix/
      pr-review/
    hooks/
      pre-shell-guard.sh
      protect-secrets.sh
      post-format.sh
      stop-verify.sh
    memory/
      project.md
      decisions.md
      commands.md
      risks.md
    mcp.json
  .kimi/skills   -> .omk/skills (symlink)
  .agents/skills
```

## Safety & Hooks

OMK는 기본적으로 아래 보안 hook을 포함합니다:

- **pre-shell-guard**: 위험 명령(`rm -rf /`, `sudo`, `git push --force` 등) 차단
- **protect-secrets**: `.env` 직접 수정 및 secret 노출 차단
- **post-format**: 저장 후 자동 포맷팅
- **stop-verify**: 종료 시 최종 검증

## Thinking / Model Router

OMK는 작업 종류에 따라 Kimi K2.6의 thinking mode를 자동 전환합니다.

| 작업 종류 | thinking | 비고 |
|-----------|----------|------|
| architecture, coding, review, interview, qa | enabled | long-horizon reasoning |
| research, commit, summarize | disabled | fast path 또는 web/search 호환 |
| vision | enabled | multimodal analysis |

**주의**: K2.6은 `temperature`, `top_p` 커스텀을 허용하지 않습니다. OMK는 이를 노출하지 않습니다.

## 라이선스

MIT

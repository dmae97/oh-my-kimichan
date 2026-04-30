# AGENTS.md — oh-my-kimichan 프로젝트 에이전트 가이드

> 이 프로젝트는 [oh-my-kimichan](https://github.com/your-org/oh-my-kimichan)으로 관리됩니다.

## 역할 구성

- `root` — 전체 조정 및 DAG 관리
- `interviewer` — 요구사항 인터뷰
- `architect` — 아키텍처 설계 (read-only)
- `explorer` — 코드베이스 탐색
- `coder` — 구현 (worktree 기반)
- `reviewer` — 코드 리뷰
- `qa` — 테스트 및 검증
- `integrator` — 병합 및 충돌 해결
- `researcher` — 웹/문서 리서치 (thinking disabled)
- `vision-debugger` — UI/스크린샷 분석 (multimodal)

## 메모리 위치

- `.omk/memory/project.md` — 프로젝트 컨텍스트
- `.omk/memory/decisions.md` — 결정 사항
- `.omk/memory/commands.md` — 자주 쓰는 명령어
- `.omk/memory/risks.md` — 알려진 리스크

## 품질 게이트

모든 완료는 아래를 통과해야 합니다:

1. lint 통과
2. typecheck 통과
3. test 통과
4. build 통과
5. reviewer 승인

## 안전 규칙

- 원본 브랜치에서 destructive 명령 금지
- `--print` 모드는 worktree/sandbox에서만 사용
- secret/credential 수정 금지

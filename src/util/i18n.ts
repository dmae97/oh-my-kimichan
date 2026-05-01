/**
 * Lightweight i18n for oh-my-kimichan CLI
 * Default language: en. Supports ko via .omk/config.toml [locale] section
 * or OMK_LANGUAGE env var.
 */

import { getOmkResourceSettings } from "./resource-profile.js";

export type OmkLocale = "en" | "ko";

const en: Record<string, string> = {
  // HUD
  "hud.noActiveRun": "□ no active run state",
  "hud.runToSeeTodos": "  run omk run to display DAG TODOs",
  "hud.hint": "  💡 Hint:",
  "hud.interactive": "interactive",
  "hud.plan": "plan",
  "hud.execute": "execute",
  "hud.merge": "merge",
  "hud.liveRefresh": "Live HUD: auto-refreshes every {0}ms, Ctrl+C to exit",
  "hud.noRunHistory": "No run history yet.",

  // CLI main menu / help
  "cli.availableCommands": "✨ Available Commands",
  "cli.initDesc": "Project scaffold (AGENTS.md, DESIGN.md, .omk/)",
  "cli.doctorDesc": "Environment check — CLI, Git, Hooks, MCP, Skills status",
  "cli.chatDesc": "Kimi interactive execution",
  "cli.planDesc": "<goal>   Create a plan and generate DAG",
  "cli.runDesc": "<flow> <goal>   Execute a flow",
  "cli.teamDesc": "tmux-based multi-agent team execution",
  "cli.hudDesc": "Execution status & system usage HUD",
  "cli.mergeDesc": "Merge results",
  "cli.syncDesc": "Sync assets",
  "cli.lspDesc": "Built-in TypeScript LSP run / config output",
  "cli.designDesc": "DESIGN.md management",
  "cli.googleDesc": "Google ecosystem integration",
  "cli.quickStart": "💜 Quick Start",
  "cli.initProject": "# Initialize current project",
  "cli.viewDashboard": "# View dashboard",
  "cli.startChat": "# Start chatting with Kimi",
  "cli.fullHelp": "Full help: omk --help    |    Docs: https://github.com/dmae97/oh-my-kimichan",
  "cli.unknownCommand": "❌ Unknown command: {0}",
  "cli.alwaysHud": "Always show HUD",
  "cli.noTtyExit": "No TTY — exit without menu (type a command explicitly)",
  "cli.suggestionChat": "  💡 omk chat  — Interactive mode",
  "cli.suggestionHud": "  💡 omk hud   — View dashboard",
  "cli.suggestionHelp": "  💡 omk --help — Full commands\n",
  "cli.ttyMenuNote": "TTY menu uses @inquirer/prompts for arrow-key selection",
  "cli.mainMenu": "OMK Main Menu",
  "cli.menuChat": "chat     — Start chatting with Kimi",
  "cli.menuHud": "hud      — View dashboard",
  "cli.menuPlan": "plan     — Create a plan",
  "cli.menuParallel": "parallel — Run parallel agents",
  "cli.menuHelp": "help     — Command help",
  "cli.menuExit": "exit     — Exit",
  "cli.menuUnavailable": "\n  (Cannot display menu in this environment. Type a command below.)\n",
  "cli.unknownChoice": "Unknown choice: {0}, proceeding to chat.",
  "cli.description": "oh-my-kimichan: multi-agent orchestration harness for Kimi Code CLI",
  "cli.runIdOption": "run ID (resume / reference)",

  // Command descriptions (cli.ts)
  "cmd.initDesc": "Create oh-my-kimichan scaffold in current project",
  "cmd.initProfileOption": "Preset profile",
  "cmd.doctorDesc": "Check Kimi CLI status, auth, model, hooks, MCP, skills",
  "cmd.chatDesc": "Run Kimi root coordinator (interactive)",
  "cmd.chatAgentOption": "Root agent YAML path",
  "cmd.chatWorkersOption": "Parallel agent workers (auto = resource-profile based)",
  "cmd.chatMaxStepsOption": "Max steps per turn (tool use limit)",
  "cmd.planDesc": "Plan-only execution",
  "cmd.runDesc": "DAG-based long-running task execution",
  "cmd.runWorkersOption": "worker count (auto = resource profile based)",
  "cmd.teamDesc": "tmux-based multi-agent team execution",
  "cmd.teamWorkersOption": "worker window count (auto = resource profile based)",
  "cmd.parallelDesc": "Run Kimi CLI with parallel agents (coordinator + workers + reviewer)",
  "cmd.parallelApprovalOption": "approval policy (interactive | auto | yolo | block)",
  "cmd.parallelNoWatchOption": "Disable live UI",
  "cmd.parallelChatOption": "Switch to interactive chat after execution",
  "cmd.hudDesc": "Show current run status and HUD",
  "cmd.hudWatchOption": "Display HUD in live refresh mode",
  "cmd.hudRefreshOption": "watch refresh interval (ms)",
  "cmd.mergeDesc": "Merge results",
  "cmd.syncDesc": "Regenerate and sync Kimi assets",
  "cmd.lspDesc": "Run built-in LSP server (default: typescript)",
  "cmd.lspPrintConfigOption": "Print default .omk/lsp.json config",
  "cmd.lspCheckOption": "Only check LSP binary path",
  "cmd.designDesc": "Google DESIGN.md / awesome-design-md integration commands",
  "cmd.designInitDesc": "Generate default DESIGN.md template",
  "cmd.designListDesc": "List awesome-design-md collection",
  "cmd.designDownloadDesc": "Download and apply DESIGN.md from awesome-design-md",
  "cmd.designSearchDesc": "Search awesome-design-md collection",
  "cmd.designValidateDesc": "Validate DESIGN.md",
  "cmd.designExportDesc": "DESIGN.md export (tailwind, etc.)",
  "cmd.googleDesc": "Google ecosystem integration",
  "cmd.googleSkillsDesc": "Install Google Stitch skills",

  // Team command
  "team.tmuxNotInstalled": "tmux is not installed.",
  "team.tmuxInstallHint": "   apt install tmux  or  brew install tmux",
  "team.attachSession": "🔌 Attaching to existing tmux session '{0}'.",
  "team.detachHint": "   (To detach, press Ctrl+b, d inside the session)",
  "team.createSession": "tmux team session creation",
  "team.sessionCreateFailed": "tmux session creation failed:",
  "team.sessionReady": "Team session ready.",
  "team.coordinator": "coordinator: main planning/coordination",
  "team.hudPane": "HUD pane:    usage + TODO + changed files live right panel",
  "team.workerSingular": "worker-1:     task execution",
  "team.workerPlural": "worker-1..{0}: parallel task execution",
  "team.reviewer": "reviewer:    code review / verification",
  "team.shortcuts": "💡 tmux shortcuts:",
  "team.switchWindows": "   Ctrl+b, 0~{0}  — switch windows",
  "team.detachSession": "   Ctrl+b, d    — detach session (keep background)",
  "team.reconnect": "   omk team     — reconnect to session",
  "team.connecting": "   Connecting...",
  "team.hudPanelFailed": "HUD right panel creation failed:",

  // Doctor command
  "doctor.kimiInstalled": "Installed",
  "doctor.kimiNotFound": "kimi command not found. npm install -g kimi-cli or official install required",
  "doctor.kimiRunnable": "Executable",
  "doctor.kimiRunFailed": "kimi execution check failed",
  "doctor.gitBranchChanges": "Branch: {0}, Changes: {1}",
  "doctor.gitNotRepo": "Not a Git repository. omk team/merge features are limited.",
  "doctor.gitNotFound": "git command not found",
  "doctor.jqInstalled": "Installed (hooks guaranteed)",
  "doctor.jqMissing": "Not installed — pre-shell-guard / protect-secrets hooks will not work, security gates are open. apt/brew install jq required",
  "doctor.kimiConfigExists": "~/.kimi/config.toml exists",
  "doctor.kimiConfigMissing": "~/.kimi/config.toml missing — kimi login required",
  "doctor.hooksSynced": "hooks synced",
  "doctor.hooksRecommendSync": "run omk sync recommended",
  "doctor.omkInitialized": "Initialized",
  "doctor.omkInitNeeded": "omk init required",
  "doctor.agentsMdExists": "Exists",
  "doctor.agentsMdMissing": "AGENTS.md missing — omk init required",
  "doctor.kimiAgentsMdExists": "Exists",
  "doctor.kimiAgentsMdMissing": ".kimi/AGENTS.md missing — omk init required",
  "doctor.rootYamlExists": "Exists",
  "doctor.rootYamlMissing": ".omk/agents/root.yaml missing — omk init required",
  "doctor.okabeConfigured": "Okabe agent configured (SendDMail support)",
  "doctor.okabeMissing": ".omk/agents/okabe.yaml or SendDMail setup missing — check omk init/sync",
  "doctor.rootPromptInjected": "AGENTS_MD + SKILLS injected",
  "doctor.rootPromptPartial": "root.md missing: {0}{1}",
  "doctor.skillsExist": "{0} skills exist",
  "doctor.skillsMissing": ".kimi/skills missing or empty",
  "doctor.agentSkillsExist": "{0} skills exist",
  "doctor.agentSkillsMissing": ".agents/skills missing or empty",
  "doctor.mcpExists": ".omk/mcp.json exists",
  "doctor.mcpMissing": ".omk/mcp.json missing — MCP intentionally disabled possible",
  "doctor.lspReady": "Built-in TypeScript LSP config/binary ready",
  "doctor.lspMissing": "Built-in TypeScript LSP config/binary missing — npm install then omk init or omk lsp --check",
  "doctor.hooksExecutable": "dangerous hooks executable",
  "doctor.hooksNotExecutable": ".omk/hooks/*.sh no execute permission — chmod +x needed",
  "doctor.globalMcpSynced": "{0} MCPs synced (~/.kimi/mcp.json)",
  "doctor.globalMcpMissing": "~/.kimi/mcp.json missing — omk sync recommended",
  "doctor.globalSkillsSynced": "{0} skills synced (~/.kimi/skills/)",
  "doctor.globalSkillsMissing": "~/.kimi/skills/ missing",
  "doctor.memorySynced": "~/.kimi/omk.memory.toml synced",
  "doctor.memoryMissing": "~/.kimi/omk.memory.toml missing — omk sync recommended",
  "doctor.memoryNeo4jBackend": "backend={0}, required env missing: {1}",
  "doctor.memoryFileBackend": "file backend in use",
  "doctor.globalPollution": "Unexpected files in ~/.kimi — check omk --global opt-in",
  "doctor.globalClean": "~/.kimi clean",
  "doctor.tmuxInstalled": "Installed",
  "doctor.tmuxRecommend": "Recommended for omk team (apt/brew install tmux)",
  "doctor.failures": "❌ {0} failures, {1} warnings. Please fix and rerun.",
  "doctor.warnings": "⚠️ {0} warnings. Functional but improvements recommended.",
  "doctor.allPassed": "✅ All checks passed!",
  "doctor.nodeRecommend": "(>=20 recommended)",

  // Plan command
  "plan.architectMissing": "architect agent missing. Run omk init first.",
  "plan.prompt": "Please create an implementation plan for the following goal. Break it into concrete, verifiable steps.\n\nGoal: {0}",
  "plan.header": "Plan Creation",
  "plan.goalLabel": "Goal",

  // LSP command
  "lsp.unsupportedServer": "Unsupported LSP server: {0}",

  // Init command
  "init.agentsMdExists": "   ℹ️ AGENTS.md already exists — skipping",
  "init.kimiAgentsMdExists": "   ℹ️ .kimi/AGENTS.md already exists — skipping",
  "init.rootYamlMigrated": "Existing root.yaml migration complete (prompts path fixed)",
  "init.copyKimiSkills": "   📦 Copying Kimi skills...",
  "init.kimiSkillsMissing": "Kimi skills template not found — check templates/skills/kimi",
  "init.copyPortableSkills": "   📦 Copying Portable skills...",
  "init.portableSkillsMissing": "Portable skills template not found — check templates/skills/agents",
  "init.kimichanPngExists": "   ℹ️ kimichan.png already exists — skipping",
  "init.kimichanPngMissing": "kimichan.png bundle missing — falling back to built-in ASCII theme",
  "init.hooksSyncFailed": "⚠️  hooks sync failed: {0}",
  "init.mcpSyncFailed": "⚠️  MCP global sync failed: {0}",
  "init.skillsSyncFailed": "⚠️  skills global sync failed: {0}",
  "init.memorySyncFailed": "⚠️  local graph memory global sync failed: {0}",

  // FS utility
  "fs.hooksSyncFailed": "⚠️  hooks sync failed: {0}",
  "fs.mcpSyncFailed": "⚠️  MCP global sync failed: {0}",
  "fs.skillsSyncFailed": "⚠️  skills global sync failed: {0}",
  "fs.memorySyncFailed": "⚠️  local graph memory global sync failed: {0}",

  // First-run star
  "star.prompt": "Thank you for the first run. Would you leave a ⭐ Star on the GitHub repo?\n{0}",
  "star.yes": "YES — auto-open GitHub Star",
  "star.no": "NO — don't ask again",

  // Worktree
  "worktree.branchExists": "Branch already exists, trying existing branch",

  // Wire client (tool descriptions)
  "wire.assignTask": "Receive a DAG node task assignment",
  "wire.updateStatus": "Update task status",
  "wire.readMemory": "Read project memory",
  "wire.writeMemory": "Write project memory",
  "wire.recordMetrics": "Record metrics",
  "wire.reportBlocker": "Report blockers",

  // Chat command
  "chat.notInitialized": "omk environment is not initialized or the path is wrong. Proceeding with automatic initialization...",
  "chat.autoInitComplete": "Auto-initialization complete. Continuing chat.\n",
  "chat.scrollUpForHud": "  ── Scroll up to see the full HUD ──\n",

  // Design command
  "design.listHeader": "awesome-design-md collection list",
  "design.listFetchFailed": "Unable to fetch list. Please check your network.",
  "design.categoryOthers": "Others",
  "design.totalFound": "Total {0} DESIGN.md found",
  "design.usageApply": "Usage: omk design apply <name>",
  "design.exampleApply": "Example: omk design apply claude",
  "design.nameRequired": "Please enter a design name. Example: omk design apply claude",
  "design.downloading": "📥 Downloading {0} DESIGN.md...",
  "design.notFound": "'{0}' DESIGN.md not found.",
  "design.checkList": "   Check available names with: omk design list",
  "design.backupExisting": "   💾 Existing DESIGN.md → DESIGN.md.bak backup",
  "design.applyComplete": "DESIGN.md applied ({0})",
  "design.source": "   Source: https://getdesign.md/{0}/design-md",
  "design.keywordRequired": "Please enter a search keyword. Example: omk design search dark",
  "design.searching": "🔍 Searching '{0}'...\n",
  "design.noResults": "No search results.",
  "design.seeFullList": "\nFull list: omk design list",
  "design.resultsCount": "{0} results:\n",

  // Google command
  "google.allSkillsFailed": "All skill installations failed.",

  // Merge command
  "merge.noRuns": "No execution history.",
  "merge.noWorktrees": "No worktrees for this run. Marking as simple completion.",
  "merge.branchCheckFailed": "Unable to check Git branch.",
  "merge.noChanges": "     → No changes or error, skipping",
  "merge.conflictPossible": "     → Conflict possible, manual resolution needed",
  "merge.diffReady": "     → diff ready. Manual merge: ",
  "merge.ready": "Merge preparation complete. Follow the instructions above for manual merge.",

  // Parallel command
  "parallel.goalRequired": "goal is required. (omk parallel <goal>)",
  "parallel.agentsActivated": "   Parallel agents activated. Running node-specific Kimi agents.\n",
  "parallel.complete": "\n🌸 Execution complete. Switching to interactive chat...\n",

  // Run command
  "run.runNotFound": "run '{0}' not found.",
  "run.flowRequired": "flow must be specified or existing run must have flow info.",
  "run.flowGoalRequired": "flow and goal are required. (omk run <flow> <goal>)",
  "run.flowNotFound": "flow '{0}' not found.",
  "run.availableFlows": "   Available flows:",
  "run.useExistingGoal": "(using existing goal)",
  "run.resumeWarning": "⚠️ Resuming from existing run. Please refer to the previous state and goal to continue.",
  "run.planPrompt": "Please create an execution plan based on the flow definition below and proceed.",
  "run.dagForced": "🐾 omk run forced to DAG executor.",
  "run.mcpSkillsForced": "   Forced .kimi + ~/.kimi MCP/skills scan and node-specific Kimi agent execution.",
  "run.runInfoSaved": "   (run info is recorded in .omk/runs/{0})\n",

  // Sync command
  "sync.mcpCreated": ".kimi/mcp.json created (empty template)",
  "sync.globalComplete": "~/.kimi/ global sync complete (hooks + MCP + skills + local graph memory)",
  "sync.mcpOk": ".kimi/mcp.json OK",
  "sync.skillsOk": ".kimi/skills OK",
  "sync.agentSkillsOk": ".agents/skills OK",
  "sync.complete": "Sync complete",

  // Local graph memory store
  "lgm.goal": "Goal",
  "lgm.decision": "Decision",
  "lgm.task": "Task",
  "lgm.risk": "Risk",
  "lgm.evidence": "Evidence",
  "lgm.constraint": "Constraint",
  "lgm.question": "Question",
  "lgm.answer": "Answer",
};

const ko: Record<string, string> = {
  // HUD
  "hud.noActiveRun": "□ active run state 없음",
  "hud.runToSeeTodos": "  omk run 실행 시 DAG TODO 표시",
  "hud.hint": "  💡 힌트:",
  "hud.interactive": "대화형",
  "hud.plan": "계획",
  "hud.execute": "실행",
  "hud.merge": "병합",
  "hud.liveRefresh": "Live HUD: {0}ms마다 자동 갱신, Ctrl+C 종료",
  "hud.noRunHistory": "아직 실행 기록이 없습니다.",

  // CLI main menu / help
  "cli.availableCommands": "✨ 사용 가능한 명령어",
  "cli.initDesc": "프로젝트 scaffold 생성 (AGENTS.md, DESIGN.md, .omk/)",
  "cli.doctorDesc": "환경 검사 — CLI, Git, Hooks, MCP, Skills 상태 확인",
  "cli.chatDesc": "Kimi 대화형 실행 (interactive mode)",
  "cli.planDesc": "<goal>   계획 수립 및 DAG 생성",
  "cli.runDesc": "<flow> <goal>   flow 실행",
  "cli.teamDesc": "tmux 기반 다중 에이전트 팀 실행",
  "cli.hudDesc": "실행 상태 & 시스템 사용량 HUD",
  "cli.mergeDesc": "결과 병합",
  "cli.syncDesc": "assets 동기화",
  "cli.lspDesc": "내장 TypeScript LSP 실행/설정 출력",
  "cli.designDesc": "DESIGN.md 관리",
  "cli.googleDesc": "Google 생태계 연동",
  "cli.quickStart": "💜 빠른 시작",
  "cli.initProject": "# 현재 프로젝트 초기화",
  "cli.viewDashboard": "# 대시보드 보기",
  "cli.startChat": "# Kimi와 대화 시작",
  "cli.fullHelp": "전체 도움말: omk --help    |    문서: https://github.com/dmae97/oh-my-kimichan",
  "cli.unknownCommand": "❌ 알 수 없는 명령어: {0}",
  "cli.alwaysHud": "항상 HUD 출력",
  "cli.noTtyExit": "TTY 없으면 메뉴 없이 종료",
  "cli.suggestionChat": "  💡 omk chat  — 인터랙티브 모드",
  "cli.suggestionHud": "  💡 omk hud   — 대시보드 보기",
  "cli.suggestionHelp": "  💡 omk --help — 전체 명령어\n",
  "cli.ttyMenuNote": "TTY 메뉴 (readline 대신 @inquirer/prompts select 사용)",
  "cli.mainMenu": "OMK 메인 메뉴",
  "cli.menuChat": "chat     — Kimi와 대화 시작",
  "cli.menuHud": "hud      — 대시보드 보기",
  "cli.menuPlan": "plan     — 계획 수립",
  "cli.menuParallel": "parallel — 병렬 에이전트 실행",
  "cli.menuHelp": "help     — 명령어 도움말",
  "cli.menuExit": "exit     — 종료",
  "cli.menuUnavailable": "\n  (메뉴를 표시할 수 없는 환경입니다. 아래 명령어를 직접 입력하세요.)\n",
  "cli.unknownChoice": "알 수 없는 선택: {0}, chat으로 진행합니다.",
  "cli.description": "oh-my-kimichan: Kimi Code CLI용 multi-agent orchestration harness",
  "cli.runIdOption": "run ID 지정 (resume / 참조)",

  // Command descriptions
  "cmd.initDesc": "현재 프로젝트에 oh-my-kimichan scaffold 생성",
  "cmd.initProfileOption": "프리셋 프로파일",
  "cmd.doctorDesc": "Kimi CLI 상태, auth, model, hook, MCP, skills 검사",
  "cmd.chatDesc": "Kimi root coordinator 실행 (interactive)",
  "cmd.chatAgentOption": "루트 에이전트 YAML 경로",
  "cmd.chatWorkersOption": "병렬 에이전트 워커 수 (auto면 리소스 프로파일 기반)",
  "cmd.chatMaxStepsOption": "한 턴당 최대 스텝 수 (tool use 제한)",
  "cmd.planDesc": "계획 전용 실행",
  "cmd.runDesc": "DAG 기반 장기 작업 실행",
  "cmd.runWorkersOption": "worker 수 (auto면 resource profile 기반)",
  "cmd.teamDesc": "tmux 기반 다중 에이전트 팀 실행",
  "cmd.teamWorkersOption": "worker 창 수 (auto면 resource profile 기반)",
  "cmd.parallelDesc": "병렬 에이전트로 Kimi CLI 실행 (coordinator + workers + reviewer)",
  "cmd.parallelApprovalOption": "승인 정책 (interactive | auto | yolo | block)",
  "cmd.parallelNoWatchOption": "라이브 UI 비활성화",
  "cmd.parallelChatOption": "실행 완료 후 인터랙티브 채팅으로 전환",
  "cmd.hudDesc": "현재 run 상태 및 HUD 표시",
  "cmd.hudWatchOption": "HUD를 라이브 갱신 모드로 표시",
  "cmd.hudRefreshOption": "watch 갱신 주기(ms)",
  "cmd.mergeDesc": "결과 merge",
  "cmd.syncDesc": "Kimi assets 재생성 및 동기화",
  "cmd.lspDesc": "내장 LSP 서버 실행 (기본: typescript)",
  "cmd.lspPrintConfigOption": ".omk/lsp.json 기본 설정 출력",
  "cmd.lspCheckOption": "실행될 LSP binary 경로만 확인",
  "cmd.designDesc": "Google DESIGN.md / awesome-design-md 연동 명령",
  "cmd.designInitDesc": "기본 DESIGN.md 템플릿 생성",
  "cmd.designListDesc": "awesome-design-md 컬렉션 목록 표시",
  "cmd.designDownloadDesc": "awesome-design-md에서 DESIGN.md 다운로드 및 적용",
  "cmd.designSearchDesc": "awesome-design-md 컬렉션 검색",
  "cmd.designValidateDesc": "DESIGN.md 검증",
  "cmd.designExportDesc": "DESIGN.md export (tailwind 등)",
  "cmd.googleDesc": "Google 생태계 연동",
  "cmd.googleSkillsDesc": "Google Stitch skills 설치",

  // Team command
  "team.tmuxNotInstalled": "tmux가 설치되어 있지 않습니다.",
  "team.tmuxInstallHint": "   apt install tmux  또는  brew install tmux",
  "team.attachSession": "🔌 기존 tmux 세션 '{0}'에 연결합니다.",
  "team.detachHint": "   (종료하려면 세션 내에서 Ctrl+b, d 입력)",
  "team.createSession": "tmux 팀 세션 생성",
  "team.sessionCreateFailed": "tmux 세션 생성 실패:",
  "team.sessionReady": "팀 세션 준비 완료.",
  "team.coordinator": "coordinator: 메인 계획/조율",
  "team.hudPane": "HUD pane:    usage + TODO + 변경 파일 live right panel",
  "team.workerSingular": "worker-1:     작업 실행",
  "team.workerPlural": "worker-1..{0}: 병렬 작업 실행",
  "team.reviewer": "reviewer:    코드 리뷰/검증",
  "team.shortcuts": "💡 tmux 단축키:",
  "team.switchWindows": "   Ctrl+b, 0~{0}  — 창 전환",
  "team.detachSession": "   Ctrl+b, d    — 세션 분리 (백그라운드 유지)",
  "team.reconnect": "   omk team     — 세션 재연결",
  "team.connecting": "   연결 중...",
  "team.hudPanelFailed": "HUD 오른쪽 패널 생성 실패:",

  // Doctor command
  "doctor.kimiInstalled": "설치됨",
  "doctor.kimiNotFound": "kimi 명령을 찾을 수 없습니다. npm install -g kimi-cli 또는 공식 설치 필요",
  "doctor.kimiRunnable": "실행 가능",
  "doctor.kimiRunFailed": "kimi 실행 확인 실패",
  "doctor.gitBranchChanges": "브랜치: {0}, 변경: {1}개",
  "doctor.gitNotRepo": "Git 저장소가 아닙니다. omk team/merge 기능이 제한됩니다.",
  "doctor.gitNotFound": "git 명령을 찾을 수 없습니다",
  "doctor.jqInstalled": "설치됨 (hooks 보장)",
  "doctor.jqMissing": "미설치 — pre-shell-guard / protect-secrets hooks가 작동하지 않아 보안 게이트가 열립니다. apt/brew install jq 필수",
  "doctor.kimiConfigExists": "~/.kimi/config.toml 존재",
  "doctor.kimiConfigMissing": "~/.kimi/config.toml 없음 — kimi 로그인 필요",
  "doctor.hooksSynced": "hooks 동기화됨",
  "doctor.hooksRecommendSync": "omk sync 실행 권장",
  "doctor.omkInitialized": "초기화됨",
  "doctor.omkInitNeeded": "omk init 실행 필요",
  "doctor.agentsMdExists": "존재",
  "doctor.agentsMdMissing": "AGENTS.md 없음 — omk init 실행 필요",
  "doctor.kimiAgentsMdExists": "존재",
  "doctor.kimiAgentsMdMissing": ".kimi/AGENTS.md 없음 — omk init 실행 필요",
  "doctor.rootYamlExists": "존재",
  "doctor.rootYamlMissing": ".omk/agents/root.yaml 없음 — omk init 실행 필요",
  "doctor.okabeConfigured": "Okabe 에이전트 설정됨 (SendDMail 지원)",
  "doctor.okabeMissing": ".omk/agents/okabe.yaml 또는 SendDMail 설정 누락 — omk init/sync 확인",
  "doctor.rootPromptInjected": "AGENTS_MD + SKILLS 주입됨",
  "doctor.rootPromptPartial": "root.md 누락: {0}{1}",
  "doctor.skillsExist": "{0}개 skills 존재",
  "doctor.skillsMissing": ".kimi/skills 없음 또는 비어 있음",
  "doctor.agentSkillsExist": "{0}개 skills 존재",
  "doctor.agentSkillsMissing": ".agents/skills 없음 또는 비어 있음",
  "doctor.mcpExists": ".omk/mcp.json 존재",
  "doctor.mcpMissing": ".omk/mcp.json 없음 — MCP intentionally disabled 가능",
  "doctor.lspReady": "내장 TypeScript LSP 설정/바이너리 준비됨",
  "doctor.lspMissing": "내장 TypeScript LSP 설정/바이너리 누락 — npm install 후 omk init 또는 omk lsp --check 확인",
  "doctor.hooksExecutable": "dangerous hooks executable",
  "doctor.hooksNotExecutable": ".omk/hooks/*.sh 실행 권한 없음 — chmod +x 필요",
  "doctor.globalMcpSynced": "{0}개 MCP 동기화됨 (~/.kimi/mcp.json)",
  "doctor.globalMcpMissing": "~/.kimi/mcp.json 없음 — omk sync 실행 권장",
  "doctor.globalSkillsSynced": "{0}개 skills 동기화됨 (~/.kimi/skills/)",
  "doctor.globalSkillsMissing": "~/.kimi/skills/ 없음",
  "doctor.memorySynced": "~/.kimi/omk.memory.toml 동기화됨",
  "doctor.memoryMissing": "~/.kimi/omk.memory.toml 없음 — omk sync 실행 권장",
  "doctor.memoryNeo4jBackend": "backend={0}, 필수 env 누락: {1}",
  "doctor.memoryFileBackend": "file backend 사용 중",
  "doctor.globalPollution": "~/.kimi에 예상外 파일 존재 — omk --global opt-in 확인",
  "doctor.globalClean": "~/.kimi 정상",
  "doctor.tmuxInstalled": "설치됨",
  "doctor.tmuxRecommend": "omk team 사용 시 권장 (apt/brew install tmux)",
  "doctor.failures": "❌ {0}개 실패, {1}개 경고. 해결 후 다시 실행하세요.",
  "doctor.warnings": "⚠️ {0}개 경고. 동작에는 문제 없으나 개선 권장.",
  "doctor.allPassed": "✅ 모든 검사 통과!",
  "doctor.nodeRecommend": "(>=20 권장)",

  // Plan command
  "plan.architectMissing": "architect agent가 없습니다. omk init을 먼저 실행하세요.",
  "plan.prompt": "다음 목표에 대한 구현 계획을 수립해주세요. 구체적이고 검증 가능한 단계로 나누어 주세요.\n\n목표: {0}",
  "plan.header": "계획 수립",
  "plan.goalLabel": "목표",

  // LSP command
  "lsp.unsupportedServer": "지원하지 않는 LSP 서버입니다: {0}",

  // Init command
  "init.agentsMdExists": "   ℹ️ AGENTS.md 이미 존재 — 건너뜀",
  "init.kimiAgentsMdExists": "   ℹ️ .kimi/AGENTS.md 이미 존재 — 건너뜀",
  "init.rootYamlMigrated": "기존 root.yaml 마이그레이션 완료 (prompts 경로 수정)",
  "init.copyKimiSkills": "   📦 Kimi skills 복사 중...",
  "init.kimiSkillsMissing": "Kimi skills 템플릿 없음 — templates/skills/kimi 확인",
  "init.copyPortableSkills": "   📦 Portable skills 복사 중...",
  "init.portableSkillsMissing": "Portable skills 템플릿 없음 — templates/skills/agents 확인",
  "init.kimichanPngExists": "   ℹ️ kimichan.png 이미 존재 — 건너뜀",
  "init.kimichanPngMissing": "kimichan.png 번들 없음 — 내장 ASCII 테마로 폴백",
  "init.hooksSyncFailed": "⚠️  hooks 동기화 실패: {0}",
  "init.mcpSyncFailed": "⚠️  MCP 글로벌 동기화 실패: {0}",
  "init.skillsSyncFailed": "⚠️  skills 글로벌 동기화 실패: {0}",
  "init.memorySyncFailed": "⚠️  local graph memory 글로벌 동기화 실패: {0}",

  // FS utility
  "fs.hooksSyncFailed": "⚠️  hooks 동기화 실패: {0}",
  "fs.mcpSyncFailed": "⚠️  MCP 글로벌 동기화 실패: {0}",
  "fs.skillsSyncFailed": "⚠️  skills 글로벌 동기화 실패: {0}",
  "fs.memorySyncFailed": "⚠️  local graph memory 글로벌 동기화 실패: {0}",

  // First-run star
  "star.prompt": "처음 실행해주셔서 감사합니다. GitHub repo에 ⭐ Star를 남겨주시겠어요?\n{0}",
  "star.yes": "YES — 자동으로 GitHub Star 누르기",
  "star.no": "NO — 다음부터 묻지 않기",

  // Worktree
  "worktree.branchExists": "브랜치가 이미 존재하면 기존 브랜치로 시도",

  // Wire client
  "wire.assignTask": "DAG 노드 작업을 할당받습니다",
  "wire.updateStatus": "작업 상태를 업데이트합니다",
  "wire.readMemory": "프로젝트 메모리를 읽습니다",
  "wire.writeMemory": "프로젝트 메모리를 기록합니다",
  "wire.recordMetrics": "메트릭을 기록합니다",
  "wire.reportBlocker": "블로커를 보고합니다",

  // Chat command
  "chat.notInitialized": "omk 환경이 초기화되지 않았거나 경로가 잘못되었습니다. 자동 초기화를 진행합니다...",
  "chat.autoInitComplete": "자동 초기화 완료. chat을 계속합니다.\n",
  "chat.scrollUpForHud": "  ── 위로 스크롤하면 전체 HUD가 보입니다 ──\n",

  // Design command
  "design.listHeader": "awesome-design-md 컬렉션 목록",
  "design.listFetchFailed": "목록을 가져올 수 없습니다. 네트워크를 확인하세요.",
  "design.categoryOthers": "기타",
  "design.totalFound": "총 {0}개 DESIGN.md 발견",
  "design.usageApply": "사용법: omk design apply <name>",
  "design.exampleApply": "예시: omk design apply claude",
  "design.nameRequired": "디자인 이름을 입력하세요. 예: omk design apply claude",
  "design.downloading": "📥 {0} DESIGN.md 다운로드 중...",
  "design.notFound": "'{0}' DESIGN.md를 찾을 수 없습니다.",
  "design.checkList": "   omk design list 로 사용 가능한 이름을 확인하세요.",
  "design.backupExisting": "   💾 기존 DESIGN.md → DESIGN.md.bak 백업",
  "design.applyComplete": "DESIGN.md 적용 완료 ({0})",
  "design.source": "   출처: https://getdesign.md/{0}/design-md",
  "design.keywordRequired": "검색어를 입력하세요. 예: omk design search dark",
  "design.searching": "🔍 '{0}' 검색 중...\n",
  "design.noResults": "검색 결과 없음.",
  "design.seeFullList": "\n전체 목록: omk design list",
  "design.resultsCount": "{0}개 결과:\n",

  // Google command
  "google.allSkillsFailed": "모든 스킬 설치에 실패했습니다.",

  // Merge command
  "merge.noRuns": "실행 기록이 없습니다.",
  "merge.noWorktrees": "해당 run에 worktree가 없습니다. 단순 완료로 처리합니다.",
  "merge.branchCheckFailed": "Git 브랜치를 확인할 수 없습니다.",
  "merge.noChanges": "     → 변경사항 없음 또는 오류, 스킵",
  "merge.conflictPossible": "     → 충돌 가능성, 수동 해결 필요",
  "merge.diffReady": "     → diff ready. 수동 병합: ",
  "merge.ready": "Merge 준비 완료. 위 안내에 따라 수동 병합하세요.",

  // Parallel command
  "parallel.goalRequired": "goal은 필수입니다. (omk parallel <goal>)",
  "parallel.agentsActivated": "   병렬 에이전트가 활성화되었습니다. 노드별 Kimi agent를 실행합니다.\n",
  "parallel.complete": "\n🌸 실행이 완료되었습니다. 인터랙티브 채팅으로 전환합니다...\n",

  // Run command
  "run.runNotFound": "run '{0}'를 찾을 수 없습니다.",
  "run.flowRequired": "flow를 지정하거나, 기존 run에 flow 정보가 있어야 합니다.",
  "run.flowGoalRequired": "flow와 goal은 필수입니다. (omk run <flow> <goal>)",
  "run.flowNotFound": "flow '{0}'를 찾을 수 없습니다.",
  "run.availableFlows": "   사용 가능한 flows:",
  "run.useExistingGoal": "(기존 goal 사용)",
  "run.resumeWarning": "⚠️ 기존 run에서 resume 중입니다. 이전 상태와 goal을 참고하여 이어서 진행하세요.",
  "run.planPrompt": "아래 flow 정의를 참고하여 실행 계획을 세우고 진행하세요.",
  "run.dagForced": "🐾 omk run을 DAG executor로 강제 전환했습니다.",
  "run.mcpSkillsForced": "   .kimi + ~/.kimi MCP/skills 스캔을 강제로 켜고 노드별 Kimi agent를 실행합니다.",
  "run.runInfoSaved": "   (run 정보는 .omk/runs/{0} 에 기록됩니다)\n",

  // Sync command
  "sync.mcpCreated": ".kimi/mcp.json 생성 (빈 템플릿)",
  "sync.globalComplete": "~/.kimi/ 글로벌 동기화 완료 (hooks + MCP + skills + local graph memory)",
  "sync.mcpOk": ".kimi/mcp.json 확인",
  "sync.skillsOk": ".kimi/skills 확인",
  "sync.agentSkillsOk": ".agents/skills 확인",
  "sync.complete": "동기화 완료",

  // Local graph memory store
  "lgm.goal": "Goal",
  "lgm.decision": "Decision",
  "lgm.task": "Task",
  "lgm.risk": "Risk",
  "lgm.evidence": "Evidence",
  "lgm.constraint": "Constraint",
  "lgm.question": "Question",
  "lgm.answer": "Answer",
};

const dictionaries: Record<string, Record<string, string>> = { en, ko };

let cachedLang: string | undefined;

export function setLanguage(lang: string): void {
  cachedLang = lang;
}

export function getLanguage(): string {
  return cachedLang ?? process.env.OMK_LANGUAGE ?? "en";
}

export function t(key: string, ...args: (string | number)[]): string {
  const lang = getLanguage();
  const dict = dictionaries[lang] ?? en;
  let str = dict[key] ?? en[key] ?? key;
  for (let i = 0; i < args.length; i += 1) {
    str = str.replace(new RegExp(`\\{${i}\\}`, "g"), String(args[i]));
  }
  return str;
}

export async function initI18n(): Promise<void> {
  try {
    const settings = await getOmkResourceSettings();
    setLanguage(settings.localeLanguage);
  } catch {
    setLanguage("en");
  }
}

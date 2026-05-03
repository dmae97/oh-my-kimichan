import { resolve } from "path";
import { runShell, type ShellResult } from "./shell.js";
import { getProjectRoot } from "./fs.js";

export async function detectTmux(): Promise<boolean> {
  const result: ShellResult = await runShell("tmux", ["-V"], { timeout: 3000 });
  return result.exitCode === 0;
}

export function isCockpitChild(): boolean {
  return process.env.OMK_CHAT_COCKPIT_CHILD === "1";
}

export interface LaunchChatCockpitOptions {
  runId?: string;
  brand?: string;
  cwd?: string;
}

export async function launchChatCockpit(options: LaunchChatCockpitOptions = {}): Promise<void> {
  if (isCockpitChild()) {
    throw new Error("Recursive cockpit launch detected");
  }

  const runId = options.runId ?? `chat-${Date.now()}`;
  const sanitized = runId.replace(/[^a-zA-Z0-9]/g, "-");
  const session = `omk-chat-${sanitized}`;
  const cwd = options.cwd ?? getProjectRoot();
  const brand = options.brand ?? "kimichan";
  const omkCli = process.argv[1] ? resolve(process.argv[1]) : "omk";
  const nodeCmd = process.execPath ? shellQuote(process.execPath) : "node";
  const cliCmd = shellQuote(omkCli);

  // 1. Reuse existing session if it already exists
  const hasSessionResult = await runShell(
    "tmux",
    ["has-session", "-t", session],
    { cwd, timeout: 5000 }
  );
  if (hasSessionResult.exitCode === 0) {
    // Session exists — attach to it instead of destroying active work.
    if (process.env.TMUX) {
      await runShell("tmux", ["switch-client", "-t", session], { cwd, timeout: 0, stdio: "inherit" });
    } else {
      await runShell("tmux", ["attach", "-t", session], { cwd, timeout: 0, stdio: "inherit" });
    }
    return;
  }

  // 2. Build commands
  const leftCmd = buildLeftPaneCommand({ nodeCmd, cliCmd, runId, brand });
  const rightTopCmd = `${nodeCmd} ${cliCmd} cockpit --run-id ${shellQuote(runId)} --watch --refresh 1500`;
  const rightBottomCmd = `${nodeCmd} ${cliCmd} runs --watch --limit 15 --refresh 5000`;

  // 3. Create detached tmux session with left-pane command already running
  const createResult = await runShell(
    "tmux",
    ["new-session", "-d", "-s", session, "-n", "chat", "-e", "OMK_CHAT_COCKPIT_CHILD=1", leftCmd],
    { cwd, timeout: 10000 }
  );
  if (createResult.failed) {
    console.warn(`Failed to create tmux session: ${createResult.stderr || createResult.stdout}`);
    return;
  }

  // 4. Get the original pane ID before splitting (works with any pane-base-index)
  const originalPanesResult = await runShell(
    "tmux",
    ["list-panes", "-t", `${session}:chat`, "-F", "#{pane_id}"],
    { cwd, timeout: 5000 }
  );
  if (originalPanesResult.failed) {
    console.warn(`Failed to list panes: ${originalPanesResult.stderr || originalPanesResult.stdout}`);
    return;
  }
  const originalPaneIds = originalPanesResult.stdout
    .trim()
    .split(/\r?\n/)
    .filter((s) => s.length > 0);
  const leftPaneId = originalPaneIds[0];
  if (!leftPaneId) {
    throw new Error("No pane found in newly created tmux session");
  }

  // 5. Split window vertically for right pane (30–35%) with command already running
  // Use -P -F #{pane_id} to capture the new pane ID regardless of pane-base-index.
  let splitResult = await runShell(
    "tmux",
    ["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", `${session}:chat`, "-l", "35%", rightTopCmd],
    { cwd, timeout: 5000 }
  );
  if (splitResult.failed) {
    splitResult = await runShell(
      "tmux",
      ["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", `${session}:chat`, "-p", "35", rightTopCmd],
      { cwd, timeout: 5000 }
    );
  }
  let rightTopPaneId: string | undefined;
  if (!splitResult.failed) {
    rightTopPaneId = splitResult.stdout.trim().split(/\r?\n/).filter((s) => s.length > 0)[0];
  } else {
    const msg = `Failed to split tmux window: ${splitResult.stderr || splitResult.stdout}`;
    console.warn(msg);
  }

  // 6. Split right pane horizontally for bottom history pane (50% height)
  if (rightTopPaneId) {
    let bottomSplitResult = await runShell(
      "tmux",
      ["split-window", "-v", "-P", "-F", "#{pane_id}", "-t", rightTopPaneId, "-l", "50%", rightBottomCmd],
      { cwd, timeout: 5000 }
    );
    if (bottomSplitResult.failed) {
      bottomSplitResult = await runShell(
        "tmux",
        ["split-window", "-v", "-P", "-F", "#{pane_id}", "-t", rightTopPaneId, "-p", "50", rightBottomCmd],
        { cwd, timeout: 5000 }
      );
    }
    if (bottomSplitResult.failed) {
      console.warn(`Failed to split bottom pane: ${bottomSplitResult.stderr || bottomSplitResult.stdout}`);
    }
  }

  // 7. Enable mouse mode so scrolling shows output history, not shell input history
  const mouseResult = await runShell(
    "tmux",
    ["set-option", "-t", session, "mouse", "on"],
    { cwd, timeout: 5000 }
  );
  if (mouseResult.failed) {
    console.warn(`Failed to enable tmux mouse mode: ${mouseResult.stderr || mouseResult.stdout}`);
  }

  // Increase scrollback history so previous code edits remain accessible
  const historyResult = await runShell(
    "tmux",
    ["set-option", "-t", session, "history-limit", "10000"],
    { cwd, timeout: 5000 }
  );
  if (historyResult.failed) {
    console.warn(`Failed to set tmux history limit: ${historyResult.stderr || historyResult.stdout}`);
  }

  // 8. Set a hook so the session is destroyed when the chat pane dies
  const hookResult = await runShell(
    "tmux",
    ["set-hook", "-t", session, "pane-died", `kill-session -t ${session}`],
    { cwd, timeout: 5000 }
  );
  if (hookResult.failed) {
    const msg = `Failed to set tmux hook: ${hookResult.stderr || hookResult.stdout}`;
    console.warn(msg);
  }

  // 8. Select the left pane
  const selectResult = await runShell(
    "tmux",
    ["select-pane", "-t", leftPaneId],
    { cwd, timeout: 5000 }
  );
  if (selectResult.failed) {
    console.warn(`Failed to select left pane: ${selectResult.stderr || selectResult.stdout}`);
  }

  // 8. Attach to the session (avoid nested-session warning when already inside tmux)
  if (process.env.TMUX) {
    await runShell("tmux", ["switch-client", "-t", session], { cwd, timeout: 0, stdio: "inherit" });
  } else {
    await runShell("tmux", ["attach", "-t", session], { cwd, timeout: 0, stdio: "inherit" });
  }
}

export function buildLeftPaneCommand(options: {
  nodeCmd: string;
  cliCmd: string;
  runId: string;
  brand: string;
}): string {
  const { nodeCmd, cliCmd, runId, brand } = options;
  return `${nodeCmd} ${cliCmd} chat --layout plain --run-id ${shellQuote(runId)} --brand ${shellQuote(brand)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

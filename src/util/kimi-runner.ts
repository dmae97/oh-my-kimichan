import type { TaskRunner, TaskResult } from "../contracts/orchestration.js";
import type { DagNode } from "../orchestration/dag.js";
import { runShell } from "./shell.js";

export interface KimiTaskRunnerOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export function createKimiTaskRunner(options: KimiTaskRunnerOptions = {}): TaskRunner {
  const { cwd, timeout = 120000, env } = options;

  return {
    async run(node: DagNode, nodeEnv: Record<string, string>): Promise<TaskResult> {
      const args = ["agent", "--message", `Execute node ${node.id} (${node.name}) as role ${node.role}`];

      const mergedEnv = { ...env, ...nodeEnv };

      const result = await runShell("kimi", args, {
        cwd: node.worktree ?? cwd,
        timeout,
        env: mergedEnv,
      });

      return {
        success: !result.failed && result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}

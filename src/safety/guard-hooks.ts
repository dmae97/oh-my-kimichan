import type { ApprovalDecision } from "../contracts/safety.js";

const DESTRUCTIVE_PATTERNS = [
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/($|\s)/,
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(~|\$\w+)/,
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\.{0,2}\//,
  /\brm\b.*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s*\.{1,2}\s*$/,
  /^\s*sudo\s+/,
  /^\s*git\s+push\s+--force/,
  /^\s*git\s+push\s+-f\s/,
  /^\s*>:\s*\/dev\/\w+/,
  /^\s*dd\s+if=.*\s+of=\/dev\/\w+/,
  /^\s*mkfs\.\w+\s/,
  /^\s*chmod\s+-R\s+777\s/,
  /^\s*chown\s+-R\s+root\s/,
  /^\s*curl\s+.*\|\s*(sh|bash|zsh)/,
  /^\s*wget\s+.*\|\s*(sh|bash|zsh)/,
  /^\s*eval\s+\$\(/,
  /^\s*eval\s+`/,
  /^\s*docker\s+system\s+prune/,
  /^\s*kubectl\s+delete\s+/,
  /^\s*aws\s+s3\s+rm\s+--recursive/,
];

const SENSITIVE_FILE_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /id_ed25519$/,
  /id_ecdsa$/,
  /credentials\.json$/,
  /service-account.*\.json$/,
  /\.aws\//,
  /\.ssh\//,
  /secrets?\//,
];

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key
  /ghp_[a-zA-Z0-9]{36}/, // GitHub personal access token
  /glpat-[a-zA-Z0-9-]{20,}/, // GitLab PAT
  /sk-[a-zA-Z0-9]{20,}/, // OpenAI API key
  /sk_live_[a-zA-Z0-9]{24,}/, // Stripe live key
  /sk_test_[a-zA-Z0-9]{24,}/, // Stripe test key
];

export function preShellGuard(command: string): ApprovalDecision {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return "block";
    }
  }
  return "allow";
}

export function protectSecrets(filePath: string, content: string): ApprovalDecision {
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return "block";
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return "block";
    }
  }

  return "allow";
}

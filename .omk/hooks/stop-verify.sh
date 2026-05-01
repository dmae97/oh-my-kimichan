#!/usr/bin/env bash
# Stop hook: run quality gates (lint, typecheck, test, build) before session ends.
# Detects package manager by lockfile and skips missing scripts gracefully.
set -uo pipefail

PROJECT_ROOT="${OMK_PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT"

# Walk up from cwd to find package.json
find_package_json() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

PKG_DIR=$(find_package_json "$PROJECT_ROOT" 2>/dev/null || true)

if [ -z "$PKG_DIR" ] || [ ! -f "$PKG_DIR/package.json" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"allow","details":"no package.json found; skipping quality gates"}}'
  exit 0
fi

cd "$PKG_DIR"

# Detect package manager by lockfile
detect_pm() {
  if [ -f "pnpm-lock.yaml" ]; then echo "pnpm"; return; fi
  if [ -f "yarn.lock" ]; then echo "yarn"; return; fi
  if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then echo "bun"; return; fi
  echo "npm"
}

PM=$(detect_pm)
export PM

node <<'NODE_SCRIPT'
const fs = require('fs');
const { execFileSync } = require('child_process');

const pm = process.env.PM || 'npm';
const pkgPath = 'package.json';

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
} catch {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      permissionDecision: 'allow',
      details: 'Failed to parse package.json; skipping quality gates'
    }
  }));
  process.exit(0);
}

const scripts = pkg.scripts || {};

function hasScript(name) {
  return typeof scripts[name] === 'string';
}

function resolveGate(name, candidates) {
  for (const c of candidates) {
    if (hasScript(c)) return c;
  }
  return null;
}

const gates = [
  { name: 'lint', script: resolveGate('lint', ['lint']) },
  { name: 'typecheck', script: resolveGate('typecheck', ['typecheck', 'check']) },
  { name: 'test', script: resolveGate('test', ['test']) },
  { name: 'build', script: resolveGate('build', ['build']) },
];

const results = [];
let anyFailed = false;

for (const gate of gates) {
  if (!gate.script) {
    results.push({ name: gate.name, status: 'skipped', reason: 'script not found in package.json' });
    continue;
  }

  const command = `${pm} run ${gate.script}`;
  let exitCode = 0;
  let stdout = '';
  let stderr = '';

  try {
    stdout = execFileSync(pm, ['run', gate.script], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    exitCode = err.status || 1;
    stdout = String(err.stdout || '');
    stderr = String(err.stderr || '');
  }

  const combined = (stdout + '\n' + stderr).trim();
  const lastLines = combined.split('\n').slice(-40).join('\n');

  if (exitCode === 0) {
    results.push({ name: gate.name, status: 'passed', command, output: lastLines });
  } else {
    anyFailed = true;
    results.push({ name: gate.name, status: 'failed', command, exitCode, output: lastLines });
  }
}

const summary = results.map(r => {
  if (r.status === 'passed') return `✓ ${r.name}`;
  if (r.status === 'skipped') return `⊘ ${r.name}`;
  return `✗ ${r.name}`;
}).join(', ');

if (anyFailed) {
  const failed = results.filter(r => r.status === 'failed');
  const details = 'Quality gate failures: ' + failed.map(f => `${f.name} (exit ${f.exitCode})`).join(', ');
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      permissionDecision: 'block',
      details: details + ' | ' + summary,
      failures: failed,
    }
  }));
  process.exit(1);
} else {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      permissionDecision: 'allow',
      details: 'All quality gates passed: ' + summary,
    }
  }));
}
NODE_SCRIPT

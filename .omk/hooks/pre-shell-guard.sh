#!/usr/bin/env bash
# PreShellUse Guard — 위험 명령 차단
set -e

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
ARGS=$(echo "$INPUT" | jq -r '.tool_input.args // empty')

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

for pattern in "${BLOCKED[@]}"; do
  if [[ "$FULL" == *"$pattern"* ]]; then
    echo '{"decision": "block", "reason": "Potentially destructive command blocked by pre-shell-guard"}'
    exit 0
  fi
done

echo '{"decision": "allow"}'

#!/usr/bin/env bash
# Secret/환경변수 보호
set -e

INPUT=$(cat)
FILEPATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# .env 수정 차단
if [[ "$FILEPATH" == *".env"* ]] || [[ "$FILEPATH" == *".env.local"* ]]; then
  echo '{"decision": "block", "reason": "Direct .env modification blocked"}'
  exit 0
fi

# 키워드 탐지
if echo "$CONTENT" | grep -qiE '(password|secret|api_key|token|private_key)'; then
  echo '{"decision": "block", "reason": "Potential secret leak detected"}'
  exit 0
fi

echo '{"decision": "allow"}'

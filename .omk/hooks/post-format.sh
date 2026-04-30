#!/usr/bin/env bash
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

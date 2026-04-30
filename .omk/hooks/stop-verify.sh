#!/usr/bin/env bash
# Stop 시 최종 검증
set -e

INPUT=$(cat)
# 추가 검증 로직 삽입 가능

echo '{"decision": "allow"}'

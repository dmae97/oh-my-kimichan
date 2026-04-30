---
name: code-review
description: 코드 리뷰 수행
type: skill
---

# 코드 리뷰 스킬

## 목표
제공된 diff나 파일에 대해 체계적인 코드 리뷰를 수행합니다.

## 체크리스트
- [ ] 보안 취약점 (SQL Injection, XSS, secret 노출)
- [ ] 에러 핸들링
- [ ] 타입 안전성
- [ ] 성능 문제
- [ ] 테스트 커버리지
- [ ] 네이밍/가독성

## 출력 형식
```json
{
  "summary": "...",
  "issues": [
    { "severity": "critical|warning|info", "line": 0, "message": "..." }
  ],
  "approved": false
}
```

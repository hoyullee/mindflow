<!-- backend.md §4 — 색인: ../backend.md -->
## 4. 알려진 스코프 컷 (M4 시점)

- **비밀번호 재설정(`resetPw`)은 Supabase 모드에서도 여전히 클라이언트 시뮬레이션입니다.**
  `sendReset()`은 실제로 `auth.sendPasswordReset(email)`을 호출해 이메일을 보내지만,
  이후 "6자리 코드 확인 → 새 비밀번호 저장" 단계는 실제 Supabase 복구 세션
  (`verifyOtp('recovery')` → `updatePassword`)을 사용하지 않습니다 — 실제 프로젝트로
  라이브 검증할 수 없는 이 환경에서 정확한 흐름(매직링크 vs OTP, 리다이렉트 파라미터
  파싱 등)을 확정하는 것은 M4 스코프를 벗어난다고 판단했습니다. 다음 단계 후보:
  `/login`이 Supabase의 recovery 리다이렉트(`#access_token=...&type=recovery`)를 감지해
  `resetPw`가 `auth.updatePassword`를 실제로 호출하도록 마무리.
- **실시간 협업(Yjs/CRDT)·awareness(커서 공유)는 이후 M5/M5-awareness에서 구현되었습니다**
  (이 문서는 M4 시점 작성). **프로비저닝 관점에서 중요한 점: 실시간에는 추가 DB 스키마가
  필요 없습니다.** 웹 전송 계층(`apps/web/src/collab/`)이 **Supabase Realtime의 broadcast
  채널**(`mindflow-collab:<docId>`)로 Y.Doc 업데이트/awareness를 릴레이하며 — 이는 클라이언트
  간 릴레이라 `postgres_changes` 리플리케이션 설정도, 신규 테이블도 요구하지 않습니다.
  Supabase Realtime은 프로젝트 기본값으로 켜져 있으므로, 위 §1의 스키마/Auth 프로비저닝만
  마치면 다중 편집·커서 공유가 동작합니다. (단일 사용자/미설정 시 무회귀: `collab/factory.ts`가
  env 게이트로 Noop/BroadcastChannel 폴백.) `documents.data`(JSONB)는 영속 스냅샷 저장소로
  계속 쓰이고, 실시간 상태는 Y.Doc/awareness가 담당합니다.
- **문서 스냅샷/버전 이력 테이블**(`document_snapshots`)은 이번 마이그레이션에 포함하지
  않았습니다 — `version` 낙관적 잠금만 우선 구현. 복원 UI가 필요해지면 별도 마이그레이션으로.

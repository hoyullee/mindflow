<!-- backend.md §8 — 색인: ../backend.md -->
## 8. 사용자 피드백 (0014 `feedback`) — insert 전용 우편함

홈(프로필 메뉴)·에디터(보기/☰ 메뉴)의 "피드백 보내기" 모달이 쌓는 테이블입니다.
무료 티어로 충분합니다 — 텍스트 행이라 저장량·egress 모두 사실상 0.

- **스키마**: `feedback(id, user_id → auth.users on delete set null, email 스냅샷,
  category(bug/ux/idea/other), message(≤4000자), page, meta jsonb, created_at)`.
  탈퇴해도 내용은 남고 연결만 끊깁니다(수집 목적상 내용이 자산).
- **RLS**: INSERT만, 로그인 사용자, `user_id = auth.uid()` — 위조 불가.
  SELECT/UPDATE/DELETE 정책이 **없어** 일반 사용자는 자기 것도 다시 못 보는
  우편함입니다. **조회는 Supabase Studio**(Table Editor 또는 SQL, 서비스 롤)에서:
  `select created_at, category, page, email, message from feedback order by created_at desc;`
- **클라이언트**: `FeedbackStore` 포트(`adapters/ports.ts`) — Supabase 어댑터는
  위 테이블 insert, 로컬/데모 모드는 localStorage(`mf_feedback`)에 쌓고 모달이
  "실제 전송 안 됨"을 안내합니다. `meta`에 빌드 스탬프·userAgent가 실려 재현
  조사를 돕습니다.
- **배포**: GitHub 연동 자동 마이그레이션. 테이블이 아직 없는 서버에서는 어댑터가
  실패를 사용자 문구("전송 실패, 다시 시도")로 바꾸므로 순서에 안전합니다.

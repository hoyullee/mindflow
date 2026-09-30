<!-- backend.md §12 — 색인: ../backend.md -->
## 12. 초대 알림 (0019 `seen_at` + Edge Function `share-invite`)

맵을 공유해도 **상대는 알 길이 없었다** — 초대 행만 생기고, 상대가 우연히 홈의
"공유받음"을 펼쳐 봐야 발견한다. 알림을 두 겹으로 붙인다.

### ① 앱 안의 배지 (0019, 이미 동작)

`document_shares.seen_at`이 `null`이면 "아직 못 본 초대"다. 홈 LNB의 `공유받음`
행에 개수 배지, 새 항목에 점, 모바일은 ☰ 버튼에도 점(서랍 안 배지는 닫힌 문 뒤라
알림이 아니다). **맵을 열면** 그 초대가 `seen_at`으로 표시된다.

`seen_at`을 갱신하는 길은 `mark_shares_seen(doc_ids text[])` RPC 하나뿐이다.
UPDATE 정책을 넓히지 않은 이유: RLS는 컬럼 단위로 못 좁히므로, 초대받은 사람이
자기 행을 UPDATE할 수 있게 열면 `seen_at`만이 아니라 **`role`까지** 바꿀 수 있다
(보기 전용 사용자가 스스로 편집 권한으로 승격).

구 서버(0019 미적용)에서는 `seen_at` select가 실패하므로 어댑터가 **컬럼 없이 한 번
더 읽는다** — 목록은 그대로 뜨고 배지만 없다.

### ② 초대 메일 (Edge Function `share-invite`)

`supabase/functions/share-invite/index.ts`. **설정하기 전까지는 아무 일도 하지
않는다** — `RESEND_API_KEY`가 없으면 `{ sent: false, reason: 'not-configured' }`를
돌려주고, 클라이언트는 결과를 보지 않는다. 즉 아래 설정은 **원할 때** 하면 된다.

보내는 시점은 **처음 초대할 때 한 번**뿐이다(권한 변경·재초대는 보내지 않는다 —
같은 알림 반복은 스팸으로 읽힌다).

**클라이언트를 믿지 않는다**: 요청자가 그 문서의 소유자인지, 그리고 그 초대가 실제로
`document_shares`에 있는지를 함수가 서버에서 다시 확인한다. 이게 없으면 로그인한
아무나 이 함수를 불러 임의의 주소로 우리 이름의 메일을 보낼 수 있다(피싱).

#### 설정 (한 번)

1. **Resend 가입** — https://resend.com (무료 3,000통/월, 100통/일).
2. **도메인 인증**: Resend에서 `geurio.com`을 추가하면 DNS 레코드 3개(SPF·DKIM·
   반송)를 준다. 도메인 DNS에 그대로 넣고 인증될 때까지 기다린다. *(도메인 인증
   없이 테스트만 하려면 Resend의 `onboarding@resend.dev`를 `INVITE_FROM`으로 쓸 수
   있지만, 그 주소는 가입한 본인에게만 보낼 수 있다.)*
3. **시크릿 등록**:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx
   supabase secrets set INVITE_FROM='Geurio <noreply@geurio.com>'   # 선택(기본값 동일)
   supabase secrets set APP_URL=https://geurio.com                   # 선택(기본값 동일)
   ```
4. **함수 배포**: `supabase functions deploy share-invite`
   (마이그레이션과 달리 **함수는 GitHub 연동으로 자동 배포되지 않는다**.)

`SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 런타임이
자동으로 넣어 준다 — 따로 등록하지 않는다.

#### 확인

```bash
supabase functions logs share-invite      # 발송·실패 로그
```

메일이 안 가는데 공유는 되는 상황이면 대개 셋 중 하나다: 시크릿 미등록
(`reason: 'not-configured'`), 도메인 미인증(Resend 401/403 → `reason: 'send-failed'`),
함수 미배포(클라이언트가 조용히 무시). 어느 경우든 **초대 자체와 앱 안 배지는 정상
동작한다** — 메일은 부수 효과다.

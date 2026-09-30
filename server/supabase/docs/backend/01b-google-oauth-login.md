<!-- backend.md §1b — 색인: ../backend.md -->
## 1b. Google OAuth 로그인 — 상세 설정 절차 (검증 완료)

> 2026-07 실제 설정으로 검증된 절차. 코드는 이미 구현되어 있어(포트
> `signInWithOAuth('google')` → `SupabaseAuth` → 로그인 화면의 "Google 계정으로
> 계속하기" 버튼) **아래 콘솔 설정만 하면 동작**합니다.

### ① Google Cloud Console (console.cloud.google.com)

1. **새 프로젝트** 생성 (예: `Geurio`) — 이후 모든 설정 전에 상단 드롭다운에서
   이 프로젝트가 선택돼 있는지 확인 (다른 프로젝트에 설정하는 게 최다 실수).
2. **API 및 서비스 → OAuth 동의 화면** (최근 UI에선 "Google Auth Platform"):
   - 앱 이름 `Geurio`, 지원/연락처 이메일, 대상(Audience)은 **외부(External)**
   - 범위(Scopes)는 기본값 그대로 (email/profile은 추가 설정 불필요)
   - **테스트 사용자**에 로그인 테스트할 구글 계정 추가 — 테스트 모드에선
     등록된 계정만 로그인 가능 (미등록 계정은 "액세스 차단됨")
3. **사용자 인증 정보 → OAuth 클라이언트 ID** 생성:
   - 유형: **웹 애플리케이션** (Capacitor 앱도 Supabase 경유라 이거 하나면 됨)
   - 승인된 자바스크립트 원본: 비워도 됨
   - **승인된 리디렉션 URI** (가장 중요 — 반드시 복사-붙여넣기):
     Supabase 대시보드 `Authentication → Sign In / Providers → Google` 화면에
     표시되는 **Callback URL** 그대로:
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (한 글자만 달라도 `redirect_uri_mismatch` — 끝 슬래시 금지, https 확인)
4. 발급된 **Client ID**(`...apps.googleusercontent.com`)와 **Client Secret**
   (`GOCSPX-...`) 복사. Secret은 Supabase 대시보드에만 붙여넣고 코드/커밋 금지.

### ② Supabase 대시보드

1. `Authentication → Sign In / Providers → Google` 활성화 → Client ID/Secret
   붙여넣기 → Save
2. `Authentication → URL Configuration`:
   - **Site URL** = 배포 도메인
   - **Redirect URLs**에 `https://<배포도메인>/home` 과 로컬 개발용
     `http://localhost:5173/home` 추가 — 코드의 `redirectTo`가 `{origin}/home`
     이라 허용 목록에 있어야 통과

### ③ 동작 방식 (코드 쪽, 참고)

- **가입/로그인 구분 없음** — 최초 OAuth 로그인 시 Supabase가 계정을 자동 생성.
- **`prompt=select_account`** 를 항상 전달(`supabaseAuth.ts`) — 없으면 최초
  동의 후 구글이 계정 선택 없이 즉시 로그인해 계정 전환이 불가능해짐.
- **실명/아바타**: 세션 `user_metadata`(full_name/avatar_url)가 프로필 UI에
  반영됨. `profiles.display_name` 기본값도 구글 실명을 따르도록 마이그레이션
  0006이 트리거를 갱신 + 기존 OAuth 사용자를 백필(직접 개명한 프로필은 보존).
- **일반 사용자 오픈 시**: 동의 화면을 테스트 모드에서 **게시(Publish)** 로 전환
  (email/profile 기본 범위만 쓰므로 별도 심사 없음).

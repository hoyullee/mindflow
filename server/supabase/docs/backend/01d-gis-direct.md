<!-- backend.md §1d — 색인: ../backend.md -->
## 1d. GIS 직접 연동 — 동의 화면의 supabase.co 표시 제거

> 문제: §1b의 리다이렉트 흐름은 구글 동의 화면에 콜백 도메인
> `<project-ref>.supabase.co`를 노출한다(우리 소유가 아니라 브랜드 인증도 불가).
> 해결: 로그인 페이지가 **Google Identity Services(GIS) 공식 버튼**을 우리
> 도메인에서 직접 렌더 → 받은 ID 토큰을 `auth.signInWithIdToken()`으로 교환.
> OAuth 교환 전체가 우리 origin에서 일어나 supabase.co가 등장하지 않는다.

### 활성 조건과 폴백 (코드 쪽)

- `VITE_GOOGLE_CLIENT_ID`(①-4의 **Client ID** — Secret 아님!)가 설정되고
  Supabase 모드일 때만 GIS 버튼이 뜬다. 미설정/데모 모드/스크립트 차단(광고
  차단기·오프라인)이면 **기존 리다이렉트 버튼으로 자동 폴백** — 로그인이 깨지는
  일은 없고, 동의 화면에 supabase.co가 보이는 원래 동작으로 돌아갈 뿐이다.
  (`features/auth/GoogleSignInButton.tsx` / `googleIdentity.ts`)
- nonce 재사용 방지: GIS에는 SHA-256 해시를, Supabase에는 원본 nonce를 전달
  (Supabase가 재해시해 토큰 클레임과 대조).
- Supabase 대시보드 쪽 추가 설정은 **없음** — 토큰 audience 검증에 쓰는 Client
  ID는 §1b-②에서 이미 등록한 값 그대로다.

### 콘솔 설정 (사람이 할 일)

1. Google Cloud Console → 사용자 인증 정보 → 기존 OAuth 클라이언트 →
   **승인된 JavaScript 원본** 추가(GIS 필수 — ①-3의 "비워도 됨"은 리다이렉트
   흐름 한정):
   - `https://geurio.com` (+ `https://www.geurio.com` 사용 시 함께)
   - `http://localhost:5173` 과 `http://localhost` (로컬 개발용 — 구글 권고)
   - 기존 **승인된 리디렉션 URI는 지우지 말 것** (폴백 흐름이 계속 사용)
2. env에 Client ID 추가 — 로컬 `apps/web/.env.local`과 Vercel(Settings →
   Environment Variables) 양쪽:
   ```
   VITE_GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
   ```
   Client ID는 공개값(모든 번들에 포함)이라 커밋 외 노출은 무해. Secret은 여전히
   Supabase 대시보드 전용.

### 브랜드 인증 (동의 화면에 "Geurio" 표시)

GIS 적용 후 동의 화면은 우리 origin(geurio.com)을 표시한다. 도메인 대신 앱
이름이 표시되게 하려면 브랜드 인증까지:

1. [Search Console](https://search.google.com/search-console)에서 `geurio.com`
   소유 확인(DNS TXT — Vercel에서 도메인 구입 시 Vercel DNS에 추가).
2. Google Auth Platform → **Branding**: 앱 이름 `Geurio`, 로고
   (배포 사이트의 `/brand/geurio-logo-120.png`, 120×120), 홈페이지
   `https://geurio.com`, 개인정보처리방침 `https://geurio.com/privacy`,
   이용약관 `https://geurio.com/terms`, 승인된 도메인 `geurio.com`.
3. 게시(Publish) 후 로고 업로드가 트리거하는 **인증 제출** — email/profile
   범위만 쓰므로 브랜드 확인만 받으면 됨(며칠~수 주, 보완 요청은 이메일로 옴).

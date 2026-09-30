<!-- backend.md §21 — 색인: ../backend.md -->
## 21. 설치형 데스크톱 앱의 Google 로그인 (Supabase 리다이렉트 한 줄)

설치형 PC 앱(`apps/desktop/`, Electron)은 웹과 **같은 출처**를 띄운다
(`https://geurio.com`) — 그래서 인증 설정은 거의 그대로다. **Google 콘솔은 손대지
않는다**: 스코프·브랜딩·게시 상태 전부 불변이고(검수 통과분), 리다이렉트 대상도
여전히 Supabase의 콜백이다.

새로 필요한 것은 **Supabase 리다이렉트 허용 목록 한 줄**이다.

> Supabase 대시보드 → Authentication → URL Configuration → **Redirect URLs**
> `https://geurio.com/auth/desktop` 추가
>
> (프리뷰에서도 시험하려면 그 배포 주소의 같은 경로를 함께 넣는다.)

### 왜 그 주소가 필요한가

Google은 **임베드된 웹뷰의 OAuth를 막는다**(`disallowed_useragent`) — Electron도 그
대상이라, 앱 창 안에서 동의를 받으면 사용자는 경고 화면을 본다. 그래서 RFC 8252
(네이티브 앱의 OAuth) 관례대로 시스템 브라우저에서 받고 앱에 돌려준다:

1. 앱: `signInWithOAuth({ skipBrowserRedirect: true, redirectTo: <위 주소> })`로
   **시작 주소만** 받아 시스템 브라우저에서 연다.
2. 브라우저: 동의 → Supabase 콜백 → `/auth/desktop#access_token=…&refresh_token=…`
   (**implicit** 흐름이라 토큰이 **해시**로 온다 — 아래 함정).
3. 브라우저: 그 해시에서 갱신 토큰만 읽어 `geurio://auth?refresh_token=…`로 앱에
   넘기고 주소를 치운다. 브라우저에는 **세션이 서지 않는다** — 이 주소에서는
   클라이언트가 URL을 **아예 보지 않기** 때문이다(`detectSessionInUrl: false`,
   아래 함정 ③). 그래서 지울 사본도, 끊을 세션도 없고, 그 사람이 웹에서 따로
   로그인해 둔 세션도 건드리지 않는다.
4. 앱: `refreshSession({ refresh_token })`으로 자기 세션을 세운다. 갱신 토큰은 쓰는
   순간 회전하므로 주소에 실려 지나간 값은 그 자리에서 무효가 된다.

### 함정 — 세 번 틀렸다 (셋 다 제보로 드러났다)

**① `signOut('local')`은 저장소만 비우지 않는다.** 첫 판은 브라우저에 선 세션의 갱신
토큰을 넘기고 사본을 지우려 그것을 불렀다. GoTrue의 `local`은 "이 세션만 로그아웃"이라
auth-js가 `POST /logout?scope=local`을 보내 **그 세션을 서버에서 끊는다** — 앱이
이어받을 토큰이 그 자리에서 폐기돼 매번 `인증 코드가 올바르지 않거나 만료되었어요`로
끝났다.

**② 우리 클라이언트는 PKCE가 아니라 implicit이다.** ①의 원인을 PKCE로 잘못 짚어
`?code=`를 넘기게 바꿨더니 `로그인 정보를 받지 못했어요`가 됐다. `@supabase/auth-js`의
**기본 `flowType`은 `implicit`**이고 우리는 그 값을 지정하지 않았다 — 콜백에 `code`는
애초에 오지 않는다. 지금은 `supabaseClient.ts`에 `flowType: 'implicit'`을 **명시**해
둔다(이 경로가 그 가정에 기대므로, 라이브러리 기본값이 뒤집히면 조용히 깨진다).
바꾸려면 비밀번호 재설정 링크 흐름까지 함께 손봐야 한다.

허용 목록에 넣지 않으면 Supabase가 콜백에서 **사이트 URL로** 되돌려 보낸다 —
브라우저는 로그인이 되지만 앱은 아무것도 받지 못하고 로그인 화면에 남는다.

**③ "먼저 낚아채니 안전하다"는 순서에 기댄 안전이었다 — 계정이 뒤섞였다.**
제보: 크롬에 **A로 로그인**해 둔 채 설치형 앱에서 **B로 로그인**했더니 **크롬도 B**가
되어 있었다. 앱의 Google 로그인이 지나는 시스템 브라우저가 바로 그 사람이 A로 쓰던
브라우저이기 때문이다. 우리는 "클라이언트가 만들어지기 전에 해시를 낚아채므로
브라우저에는 세션이 서지 않는다"고 적어 두었는데, **그 순서가 성립하지 않았다**:

1. **ESM 임포트가 본문보다 먼저 평가된다.** `main.tsx`의 `captureDesktopAuthToken()`
   보다 `import { App }`이 끌어온 모듈들이 먼저 돌고, 그 안의 `BackendContext.tsx`가
   `const defaultBackend = createBackend()`로 **이미 클라이언트를 만든다**.
2. **주소를 지워도 늦다.** auth-js(`2.110.5`)의 `_initialize()`는 생성자 스택에서
   `parseParametersFromURL(window.location.href)`를 **동기로** 읽어 `params`에 담고
   implicit 판정까지 마친다. 세션은 한 마이크로태스크 뒤에 **그 사본**으로 세운다 —
   즉 그 사이에 주소를 비워도 auth-js는 손에 든 토큰으로 `_saveSession()`을 하고,
   `BroadcastChannel`로 **다른 탭에까지 `SIGNED_IN`을 알린다**.

그래서 앱은 토큰을 받아 B로 로그인하고(낚아채기는 성공한다) 브라우저는 브라우저대로
B 세션을 저장해 **A를 덮어썼다**. 둘 다 성공해서 생긴 고장이다.

**고침은 경주를 그만두는 것이다.** 순서를 맞추는 것으로는 이길 수 없다(모듈 평가
순서 하나만 바뀌어도 되돌아온다). **심부름꾼 경로**(`/auth/desktop`·`/auth/gcal`)에서는
클라이언트를 `detectSessionInUrl: false`로 만든다 — 순서와 무관한 **성질**이라 조용히
되살아나지 않는다(`isAuthCourierPath` → `supabaseClient.ts`). 낚아채기는 남지만 역할이
바뀌었다: 앱에 넘길 값을 읽고 **주소창·방문 기록에서 토큰을 치우는** 위생 작업이다.

**교훈**: "먼저 돌아서 안전하다"는 안전이 아니다. 지키려는 것이 불변식이면 **순서가
아니라 성질로** 표현한다.

### 확인
- 앱에서 `Google 계정으로 계속하기` → 시스템 브라우저가 열린다(앱 창이 아니다).
- 브라우저가 `/auth/desktop`에서 "Geurio 앱으로 돌아가세요"를 보여 준다(주소에
  **해시가 남아 있지 않다** — 엔트리가 낚아채 치운다).
- 앱이 홈으로 들어간다. 브라우저에 로그인해 두었던 세션은 **그대로 살아 있다**.
- 앱 창에서 `Ctrl+Shift+I`로 콘솔을 볼 수 있다(셸이 Electron 기본 메뉴를 그대로 둬서
  `Ctrl+R`·`Ctrl+Shift+R`도 동작한다) — 어느 번들이 떠 있는지는 `[geurio] build …` 줄.

구현: `apps/web/src/features/auth/desktopGoogle.ts`(형식·왕복),
`DesktopHandoff.tsx`(브라우저 쪽), `useLoginController.ts`(앱 쪽),
`apps/desktop/src/main.ts`(딥링크 수신). 셸 전반은 `apps/desktop/README.md`.

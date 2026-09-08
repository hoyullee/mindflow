# @mindflow/desktop — 설치형 PC 앱(Electron 셸)

Geurio를 **Windows `.exe` / macOS `.dmg`로 설치되는 앱**으로 감싼다. 앱 자체(React
SPA)는 웹과 같은 것을 띄우고, 이 패키지는 껍데기만 든다.

```
apps/desktop/
  src/main.ts        Electron 메인 — 창·외부 링크·딥링크·수명 주기
  src/preload.ts     렌더러와의 유일한 창구(contextBridge)
  src/shell.ts       셸의 **순수 규칙**(창 자리·출처 판정·딥링크 모양) + 테스트
  resources/         오프라인 폴백 화면(앱에 닿지 못했을 때만 뜬다)
  build/icon.png     앱 아이콘 1024 — electron-builder가 .ico·.icns를 만든다
  electron-builder.yml
```

## 왜 원격 출처를 띄우는가(번들이 아니라)

`main.ts`는 `https://geurio.com/home`을 그대로 로드한다. 산출물을 `app://` 같은
커스텀 스킴으로 띄우지 않는 이유가 셋이다.

1. **로그인이 성립한다.** Google·Supabase 인증은 우리 **출처**가 콘솔에 등록돼
   있어야 동작한다. 커스텀 스킴은 출처부터 다르므로 등록될 수 없다.
2. **판이 갈리지 않는다.** 웹 배포가 곧 데스크톱 앱의 판이다 — 설치본을 다시
   내려받게 하지 않는다(Slack·Notion과 같은 방식).
3. **오프라인도 그대로.** 웹 앱의 서비스 워커가 앱 셸을 캐시하므로 한 번 띄운
   뒤에는 네트워크가 없어도 열린다. 첫 실행에서 못 닿았을 때만
   `resources/offline.html`이 사유와 다시 시도를 안내한다.

## Google 로그인 — 시스템 브라우저 + 딥링크

Google은 **임베드된 웹뷰의 OAuth를 막는다**(`disallowed_useragent`) — Electron도
그 대상이다. 그래서 RFC 8252(네이티브 앱의 OAuth) 관례대로:

1. 앱에서 `Google 계정으로 계속하기` → 셸이 **시스템 브라우저**를 연다.
2. 브라우저에서 동의 → Supabase 콜백 → `https://geurio.com/auth/desktop`.
3. 그 페이지가 갱신 토큰을 `geurio://auth?refresh_token=…`로 앱에 넘기고 **자기
   사본은 지운다**.
4. 앱이 그 토큰으로 세션을 세운다. Supabase 갱신 토큰은 쓰는 순간 회전하므로
   주소에 실려 지나간 값은 그 자리에서 무효가 된다.

구현은 `apps/web/src/features/auth/desktopGoogle.ts`(웹) + `src/main.ts`의
`open-url`/`second-instance`(셸). **스코프·브랜딩·게시 상태는 하나도 바뀌지
않는다** — 새로 필요한 것은 Supabase 리다이렉트 허용 목록 한 줄뿐이다
(`server/supabase/docs/backend.md` §20).

## 개발

```bash
pnpm install                          # electron 바이너리까지 받는다
pnpm --filter @mindflow/desktop start # 컴파일 후 앱 실행(기본 주소: 프로덕션)

# 프리뷰·로컬 서버를 띄워 보려면:
GEURIO_APP_URL=http://localhost:5173/home pnpm --filter @mindflow/desktop start
```

`ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install`로 설치하면 Electron 바이너리를
받지 않는다(CI의 `verify` 잡이 그렇게 한다 — 타입체크·테스트에는 타입만 필요하다).
그 상태에서는 `start`가 동작하지 않으므로, 로컬에서 앱을 띄우려면 그 변수 없이
한 번 설치한다.

## 설치 파일 만들기

```bash
pnpm --filter @mindflow/desktop pack:win   # release/Geurio Setup <ver>.exe
pnpm --filter @mindflow/desktop pack:mac   # release/Geurio-<ver>.dmg (x64 + arm64)
```

**각 OS에서 그 OS의 산출물을 만든다** — macOS 산출물은 macOS에서만 만들 수 있다
(서명·공증 도구가 그 OS에만 있다). CI에 Windows·macOS 러너를 둔 이유가 이것이다:

> GitHub → Actions → **Desktop installers** → Run workflow

산출물은 그 실행의 아티팩트(`geurio-desktop-windows` / `-macos`)로 올라온다.
손으로 돌리는 이유는 셸이 자주 바뀌지 않고 macOS 러너가 분당 과금이 비싸서다.

## 서명 — 아직 하지 않는다

지금은 **무서명**이다(내부·테스트 배포부터). 그래서 처음 실행할 때:

- **Windows**: SmartScreen이 "Windows에서 PC를 보호했습니다"를 띄운다 →
  `추가 정보` → `실행`. 서명 인증서(OV/EV)를 CI 시크릿에 넣으면 사라진다.
- **macOS**: Gatekeeper가 막는다 → **우클릭(control+클릭) → 열기 → 열기**.
  그래도 막히면 `xattr -dr com.apple.quarantine /Applications/Geurio.app`.
  서명 + 공증(notarization)을 하면 사라진다.
  (Apple Silicon에서 앱이 아예 실행되지 않는 것을 막으려고 `scripts/adhoc-sign.cjs`가
  **애드혹 서명**을 붙인다 — 인증서 없이 붙일 수 있는 서명이다.)

인증서가 준비되면 `.github/workflows/desktop.yml`의 주석에 적힌 시크릿을 채우고
`electron-builder.yml`의 `mac.identity: null`을 지우면 된다. 그 밖의 구조는 그대로다.

## 아직 하지 않은 것

- **자동 업데이트**(`electron-updater`). 무서명 산출물을 자동으로 받아 실행하는
  것은 신뢰할 수 있는 갱신 경로가 아니고, 애초에 앱 화면은 웹 배포가 곧 최신이라
  셸을 자주 갱신할 이유가 없다. 서명 후에 붙이는 것이 순서다.
- **Linux 산출물**. 만들 수는 있지만(설정에 타깃만 더하면 된다) 요청 범위가
  Windows·macOS였다.
- **네이티브 메뉴·트레이·전역 단축키**. 웹 앱이 자기 단축키를 이미 들고 있어서
  겹치지 않게 설계해야 한다 — 별건.

## 아이콘

```bash
pnpm --filter @mindflow/desktop generate:icon
```

PWA·모바일과 **같은 벡터 정의**(코럴 둥근사각 + 흰 소용돌이)에서 만든다. 마크가
바뀌면 세 스크립트를 함께 돌린다(`apps/web/scripts/generate-icons.mjs`,
`apps/mobile/scripts/generate-native-assets.mjs`).

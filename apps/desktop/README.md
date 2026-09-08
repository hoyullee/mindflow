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
  build/appx/        MSIX 타일 4종(없으면 샘플 아트가 실린다)
  scripts/dev-cert.ps1   MSIX 로컬 설치용 개발 인증서(자가서명)
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

## Microsoft Store 채널(MSIX) — 지금은 자가서명 로컬 설치까지

Windows는 **Store에 올리면 Microsoft가 패키지에 서명해 준다** → 코드 서명
인증서를 사지 않아도 SmartScreen 경고가 없다. (macOS는 Apple Developer Program
연회비가 직접 배포·App Store 양쪽의 근거라 Store로 가서 아끼는 것이 없다 —
그래서 Windows만 Store, macOS는 `.dmg` 직접 배포다.)

지금 저장소에 있는 것은 **자가서명으로 내 PC에 설치해 보는 상태**다. Store 제출은
Partner Center에서 앱 이름을 예약해 정체성을 받은 뒤에야 가능하다(아래 "남은 것").

### 로컬 설치 (Windows에서, 관리자 PowerShell)

> `dev-cert.ps1`은 **UTF-8 BOM**으로 저장돼 있어야 한다. Windows PowerShell 5.1은
> BOM이 없으면 스크립트를 ANSI(한국어 Windows는 CP949)로 읽고, CP949는 2바이트
> 인코딩이라 한글의 선행 바이트가 **뒤따르는 ASCII 한 글자를 삼킨다** — 실제로
> 그렇게 닫는 따옴표가 사라져 `문자열에 ' 종결자가 없습니다`로 실패한 제보가
> 있었다. 출력이 `洹?蹂?섍?`처럼 깨져 보이면 BOM이 떨어진 것이다
> (`src/packaging.test.ts`가 그 존재를 고정한다).

```powershell
# 0) 의존성 — 처음이거나 pull 뒤라면 먼저(저장소 루트에서)
#    빠뜨리면 `pack:appx`가 `TS2688: Cannot find type definition file for 'node'`로
#    멈춘다(@types/node가 없다는 뜻이다 — pnpm도 "node_modules missing"이라 경고한다).
pnpm install

# 1) 개발 인증서 만들기 + 신뢰 저장소에 넣기
#    electron-builder.yml의 appx.publisher를 읽어 그 값과 똑같은 Subject로 만든다.
powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\dev-cert.ps1

# 2) 스크립트가 출력한 두 줄을 그대로 붙여 넣고(경로·암호가 채워져 있다)
$env:CSC_LINK = '...\build\dev-cert\geurio-dev.pfx'
$env:CSC_KEY_PASSWORD = '...'

# 3) 패키징
pnpm --filter @mindflow/desktop run pack:appx

# 4) 설치
Add-AppxPackage -Path (Get-ChildItem apps\desktop\release\*.appx).FullName
```

지우려면 `Get-AppxPackage *Geurio* | Remove-AppxPackage`.

`CSC_LINK`이 설정된 창에서 `pack:win`을 돌리면 **`.exe`도 이 개발 인증서로
서명된다**(신뢰되지 않는 서명이라 배포용이 아니다). 배포용 `.exe`는 그 변수가
없는 창에서 만든다.

### MSIX에서 다른 점

- **프로토콜은 매니페스트가 선언한다.** `electron-builder.yml`의 최상위
  `protocols`가 그 일을 하고, `app.setAsDefaultProtocolClient`는 MSIX 컨테이너에서
  **무효다**(`src/main.ts` 주석). 이 선언이 빠지면 Store 설치본에서 **Google
  로그인이 완주하지 못한다** — 브라우저가 돌려보내는 `geurio://`를 아무도 받지
  못한다. 그래서 `src/packaging.test.ts`가 그 선언을 고정한다.
- **컨테이너**라 파일시스템·레지스트리가 가상화된다. `window-state.json`(userData)은
  그대로 동작하고, **내보내기 저장 대화상자**는 실기기에서 한 번 확인해야 한다.
- **타일 이미지 4종**이 `build/appx/`에 있어야 한다 — 없으면 electron-builder가
  **자기 샘플 아트**를 넣는다(남의 로고가 설치본에 실린다). `generate:icon`이 만든다.
- 업데이트는 **Store가 맡는다** — 그래서 이 채널에는 자동 업데이트를 따로 붙이지
  않는다.

### Store 제출까지 남은 것

1. **Partner Center에서 앱 이름 예약** → 배정된 값으로 `electron-builder.yml`의
   `appx.identityName` · `publisher` · `publisherDisplayName` 세 줄을 바꾼다.
   (그 뒤에는 Microsoft가 서명하므로 `CSC_LINK` 없이 만든 패키지를 올린다.)
2. 스토어 등록 정보(스크린샷·연령 등급·개인정보처리방침 URL — `/privacy` 사용).
3. CI 잡 추가. 지금 워크플로에 넣지 않은 이유는 정체성 없이는 **로컬 테스트용
   자가서명 패키지밖에** 만들 수 없어서다(그 패키지는 각자 만든 인증서에 묶여
   다른 PC에서 설치되지 않는다).

## 서명 — 직접 배포(.exe/.dmg)는 아직 하지 않는다

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
- **Store 제출**. 패키지는 만들 수 있고 로컬 설치까지 되지만, 정체성(Partner
  Center 예약)이 있어야 올릴 수 있다 — 위 "Store 제출까지 남은 것".
- **네이티브 메뉴·트레이·전역 단축키**. 웹 앱이 자기 단축키를 이미 들고 있어서
  겹치지 않게 설계해야 한다 — 별건.

## 아이콘

```bash
pnpm --filter @mindflow/desktop generate:icon
```

PWA·모바일과 **같은 벡터 정의**(코럴 둥근사각 + 흰 소용돌이)에서 만든다. 마크가
바뀌면 세 스크립트를 함께 돌린다(`apps/web/scripts/generate-icons.mjs`,
`apps/mobile/scripts/generate-native-assets.mjs`).

산출물은 `build/icon.png`(1024 — electron-builder가 여기서 `.ico`·`.icns`를 만든다)와
`build/appx/` 타일 4종이다. 타일은 정사각 아이콘을 늘리지 않고 **글리프를 가운데**
둔다(넓은 타일에서 마크가 찌그러지지 않게).

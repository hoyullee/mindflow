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
2. 브라우저에서 동의 → Supabase 콜백 →
   `https://geurio.com/auth/desktop#access_token=…&refresh_token=…`
   (implicit 흐름이라 토큰이 **해시**로 온다).
3. 그 페이지가 해시를 **Supabase 클라이언트가 읽기 전에** 낚아채 주소에서 지우고,
   갱신 토큰만 `geurio://auth?refresh_token=…`로 앱에 넘긴다. 브라우저에는 세션이
   서지 않으므로 지울 사본도, 그 사람이 웹에 로그인해 둔 세션을 건드릴 일도 없다.
4. 앱이 `refreshSession`으로 자기 세션을 세운다. 갱신 토큰은 쓰는 순간 회전하므로
   주소에 실려 지나간 값은 그 자리에서 죽는다.

> **이 자리에서 두 번 틀렸다**(둘 다 제보로 드러났다): ① `signOut('local')`은 저장소만
> 비우는 것이 아니라 그 세션을 **서버에서 끊는다**(auth-js가 `POST /logout?scope=local`을
> 보낸다) — 앱이 이어받을 토큰이 그 자리에서 죽었다. ② 그 원인을 PKCE로 잘못 짚어
> `?code=`를 넘기게 바꿨는데, auth-js의 **기본 `flowType`은 `implicit`**이라 콜백에
> `code`는 애초에 오지 않는다(그 값은 이제 `supabaseClient.ts`에 명시해 뒀다).
> 자세한 사정은 `apps/web/src/features/auth/desktopGoogle.ts` 머리 주석.

구현은 `apps/web/src/features/auth/desktopGoogle.ts`(웹) + `src/main.ts`의
`open-url`/`second-instance`(셸). **스코프·브랜딩·게시 상태는 하나도 바뀌지
않는다** — 새로 필요한 것은 Supabase 리다이렉트 허용 목록 한 줄뿐이다
(`server/supabase/docs/backend.md` §20).

## 창을 닫아도 알림 — 트레이 상주(4단계)

일정 알림을 띄우는 것은 **렌더러**(웹 앱)의 주기 확인이다
(`apps/web/src/features/reminders/`). 그래서 창을 파괴하면 그 순간 알림도 함께
멎는다 — 설치형 앱에서 "닫아 둬도 알림이 온다"를 만들려면 닫기를 **숨기기**로
바꿔 창(=렌더러)을 살려 둬야 한다. 창이 살아 있으면 타이머도 조여지지 않는다
(`backgroundThrottling: false`).

- **기본은 켜짐**이다. 대신 **처음 숨길 때 한 번 알린다**("창을 닫아도 트레이에
  남아 …") — 말없이 상주하는 것이 나쁘다. 그 안내는 **실제로 띄운 뒤에만**
  "알렸다"로 기록한다(알림을 못 띄우는 환경이면 다음 기회에 다시 알린다).
- **되돌아올 길이 없으면 숨기지 않는다**(`canStayInBackground`): macOS는 독
  아이콘이 그 길이고(`activate`), Windows·Linux는 **트레이가 실제로 만들어졌을
  때만**이다. 숨겼는데 트레이도 독도 없으면 사용자는 창을 되찾을 수 없다.
- **트레이는 macOS에 두지 않는다**(`usesTray`). 그 플랫폼은 독 아이콘이 이미
  "실행 중"을 말하고, 메뉴 막대에 하나 더 두면 같은 뜻의 진입점이 둘이 된다
  (Slack·Notion·Discord도 두지 않는다).
- **트레이 아이콘은 상주 설정과 무관하게 앱이 떠 있는 동안 늘 둔다.** 설정을 끈
  상태에서 아이콘까지 없애면 상주가 "불가능한 환경"으로 읽혀 설정 화면의 그
  자리가 사라지고, 다시 켤 길이 없어진다.
- **로그인할 때 자동 실행**은 `--hidden`으로 등록해 **창 없이** 시작한다(컴퓨터를
  켤 때마다 창이 튀어나오면 상주가 아니라 방해다). 상주할 수 없는 환경이면 그
  인자가 있어도 창을 띄운다 — 닿을 길 없는 프로세스를 만들지 않는다.
  Windows·macOS만 지원한다(Electron의 `setLoginItemSettings`가 그렇다).
- 설정은 `설정 › 일정 알림` 아래 두 행이고, 상태의 정본은 **셸**이다
  (`userData/settings.json` + OS의 로그인 항목). 렌더러는 사본을 들지 않고
  **바뀐 뒤의 상태를 돌려받아** 그린다 — MSIX처럼 로그인 항목을 받아들이지 않는
  환경에서는 스위치가 제자리로 돌아가 사실을 말한다.
- **앱을 완전히 종료하면 알림도 멈춘다**(트레이 메뉴의 `종료`·⌘Q). 이 단계의
  한계이고, 사용자가 고른 것이다.

⚠️ Windows에서 알림이 뜨려면 **AUMID**(`app.setAppUserModelId`)가
`electron-builder.yml`의 `appId`와 같아야 한다 — 다르면 토스트가 아예 뜨지 않거나
남의 이름으로 뜬다. 두 값이 갈리지 않게 `packaging.test.ts`가 지킨다.

실제 Electron(xvfb)으로 확인한 것: 닫기 → 창이 **숨고 파괴되지 않는다**, 숨은
동안에도 렌더러 타이머가 초당 한 번 그대로 돈다, 숨은 렌더러가 OS 알림을 만든다,
`--hidden`으로 시작하면 창이 보이지 않는 채 렌더러가 돈다, 설정을 끄면 닫기가 곧
종료다, 그 설정이 다시 실행해도 남는다.

## 키보드 — 앱의 키만 남긴다

Electron이 기본으로 만들어 주는 메뉴에는 `보기`(새로 고침·강제 새로 고침·개발자
도구·확대/축소)가 들어 있다. 그건 브라우저의 메뉴이지 이 앱의 메뉴가 아니라
(요청: 웹이 아니라 앱으로써 느껴지게) 두 층으로 걷어냈다.

**1층은 메뉴다**(`appMenuSpec`). Windows·Linux는 **메뉴를 두지 않는다** — 그 두
곳에서는 입력창의 잘라내기·복사·붙여넣기·전체 선택을 Chromium이 스스로 처리하므로
편집 메뉴가 없어도 글자를 다루는 데 지장이 없다(실제 Electron으로 확인). macOS는
⌘C·⌘V가 메뉴 항목에서 나오므로 메뉴를 비우면 입력창에서 복사·붙여넣기가 통째로
죽는다 — 그래서 앱·편집·창 셋만 두고 **`보기` 메뉴는 두지 않는다**.

**2층은 순수 규칙이다**(`isBrowserShortcut`) — 플랫폼마다 Chromium이 스스로 처리하는
키가 다를 수 있고 이 개발 환경에서는 Windows·macOS를 확인할 수 없어 안전망을 둔다.
막는 키와 근거:

| 키 | 왜 막는가 |
| --- | --- |
| `F5` · `Ctrl/⌘+R` | 앱에서 리로드는 사용자가 다룰 개념이 아니고, 실행취소 기록·클립보드·선택·팬/줌과 **아직 저장되지 않은 편집**까지 잃는다. 앱이 새로 고침을 권하는 자리(협업 끊김 안내·새 버전 토스트)에는 **버튼이 있다** |
| `Ctrl/⌘+P` | 우리 인쇄·저장 경로는 내보내기(PDF·PNG·SVG)다 |
| `Ctrl/⌘+0` · `±` | 캔버스에 자기 줌이 있어 두 줌이 겹치면 무엇이 커진 것인지 알 수 없다. UI 전체 크기는 OS 배율이 맡는다 |
| `F12` · `Ctrl+Shift+I/J/C` · `⌘⌥I/J/C` | 배포본에서 개발자 도구는 기능이 아니다(아래 opt-in) |

`Ctrl/⌘+W`는 **막지 않는다** — macOS에서 ⌘W로 창을 닫는 것은 그 플랫폼의 관례이고
우리 macOS 메뉴가 그 항목을 갖고 있다. Windows·Linux는 메뉴가 없어 이미 아무 일도
일어나지 않는다.

앱이 쓰는 키(`Ctrl+C·V·X·Z·Shift+Z·A·S·F·D·N`, 수정 키 없는 도구 전환 `V·P·H·E·C`)는
**건드리지 않는다** — 여기서 막으면 렌더러가 그 키를 아예 보지 못한다. 실제
Electron으로 21종을 하나씩 확인했다(`src/shell.test.ts`가 목록을 지킨다).

### 개발자 도구 — 필요할 때만 연다

실기기 진단은 이 창이 유일한 길이라(타이틀 바·로그인 사고를 이걸로 잡았다) 완전히
없애지 않았다. **개발 실행(`pnpm start`)이거나 `GEURIO_DEVTOOLS=1`로 켰을 때만**
`F12`가 개발자 도구를 연다:

```powershell
# Windows에서 설치본을 진단할 때
$env:GEURIO_DEVTOOLS = "1"; & "$env:LOCALAPPDATA\Programs\Geurio\Geurio.exe"
```

콘솔 첫 줄의 `[geurio] build <시각> (<sha7>)`가 **어느 번들이 떠 있는지** 말해 준다.
앱은 원격 출처를 띄우므로 **웹 배포가 곧 앱의 판**이고(셸을 다시 설치하지 않아도
껐다 켜면 새 코드가 돈다 — 서비스 워커가 옛 셸을 들고 있으면 한 번 더) 화면이 옛
판인지 의심될 때 그 sha가 결정적이다.

> ⚠️ 프로브 함정: **CDP로 넣은 키는 2층을 지나지 않는다**(Playwright의
> `keyboard.press`). 실제 키보드와 같은 경로로 재려면 메인 프로세스의
> `webContents.sendInputEvent`를 써야 한다 — 이걸 모르고 재면 "차단이 동작하지
> 않는다"로 잘못 읽는다.

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
> → **만들 설치 파일**: `all` / `windows` / `macos` / `store`

산출물은 그 실행의 아티팩트(`geurio-desktop-windows` / `-macos` / `-store`)로
올라온다. 손으로 돌리는 이유는 셸이 자주 바뀌지 않고 macOS 러너가 분당 과금이
비싸서다 — 그래서 **하나만 고를 수 있다**: "Windows 설치본만" 같은 흔한 경우에
mac 러너를 태울 이유가 없다(고르지 않은 플랫폼은 잡이 아예 생기지 않는다).

**리눅스에서 Windows 설치본을 만들려 하지 말 것.** electron-builder는 NSIS
언인스톨러를 만들려고 **방금 만든 설치 파일을 wine에서 한 번 실행**한다(서명
여부와 무관한 단계다 — `app-builder-lib/.../NsisTarget.js`의
`computeScriptAndSignUninstaller`). 그래서 wine이 없으면 `spawn wine ENOENT`로
멈추고, 그때 남는 `release/*.exe`는 앱이 들어 있지 않은 **200KB대 껍데기**다
(앱 본체는 `*.nsis.7z`에 있고 아직 합쳐지지 않았다 — 크기만 보고 성공으로
읽지 말 것). 시스템 wine을 깔아도 NSIS 설치본은 32비트라 i386 멀티아치가
필요하고, `toolsets.wine`으로 electron-builder의 자체 wine 번들을 받는 길도
있지만(`wine-11.0-linux-x86_64`) 환경에 따라 그 번들이 자기 `ntdll`을 못 읽는다.
결론: **Windows 산출물은 Windows 러너에서** 만든다.

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

> 두 번째 실행부터는 로그에 `signing … win-unpacked\Geurio.exe` 줄이 **보이지
> 않는다** — 이상이 아니다. electron-builder가 빌드 캐시(digest에 .pfx 내용까지
> 들어간다)를 맞춰 보고 첫 실행에서 만든 **서명된 exe를 그대로 복사**하기
> 때문이다(`icons-bundle` 다운로드 줄이 함께 사라지는 것도 같은 이유). CI에서는
> 이 캐시가 비활성이라 항상 새로 서명한다.

### appx 서명이 `A required function is not present.`로 실패할 때

electron-builder의 **기본 서명 툴셋**(winCodeSign `0.0.0`)이 내려받는
`signtool.exe`는 오래된 것이라 **AppX SIP가 없다** — `.exe`는 멀쩡히 서명되는데
`.appx`만 그 문구로 실패하고, 그러면 서명이 없는 패키지가 남아 `Add-AppxPackage`가
`0x800B0100 서명을 찾을 수 없습니다`로 거절한다.

그래서 `electron-builder.yml`에 **툴셋을 못박아 뒀다** — Windows Kits 10.0.26100
번들(signtool·makeappx)을 받아 쓰므로 로컬에 Windows SDK를 설치할 필요가 없다.

```yaml
toolsets:
  winCodeSign: '1.1.0'
```

그래도 막히면 두 갈래가 있다.

**① 이미 있는 SDK의 signtool을 쓴다** — 이 환경 변수가 툴셋보다 우선한다.

```powershell
$env:SIGNTOOL_PATH = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
```

**② 서명 없이 등록한다**(개발자 모드) — 표준 개발 루프다. `설정 → 시스템 →
개발자용 → 개발자 모드`를 켜면 **서명되지 않은 패키지를 폴더째 등록**할 수 있어,
서명 문제를 통째로 비켜 간다(그 자리에서 앱·프로토콜이 실제로 등록되므로
`geurio://` 로그인까지 확인된다).

```powershell
$appx = (Get-ChildItem apps\desktop\release\*.appx).FullName
$dir  = Join-Path (Get-Location) 'apps\desktop\release\loose'
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($appx, $dir)   # .appx는 zip이다
Add-AppxPackage -Register (Join-Path $dir 'AppxManifest.xml')
```

지우려면 같은 `Get-AppxPackage *Geurio* | Remove-AppxPackage`.

> 이 두 갈래는 **Windows에서 확인하지 못했다**(이 저장소의 개발 환경은 리눅스이고
> `AppxTarget`은 win32/darwin이 아니면 아예 던진다). ①은 electron-builder 소스에서
> 우선순위를, ②는 Windows의 개발자 모드 관례를 근거로 적었다.


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

절차는 **[STORE.md](./STORE.md)**에 있다(계정 등록 → 이름 예약 → 정체성 세 값 →
패키지 → 등록 정보·연령 등급·인증 메모 → 제출). 코드 쪽에서 남은 것은 한 가지뿐이다:

- **Partner Center가 배정한 세 값**으로 `electron-builder.yml`의
  `appx.identityName` · `publisher` · `publisherDisplayName`을 바꾼다. 그 전에
  만든 패키지는 **로컬 테스트용**이다(각자 만든 인증서에 묶여 다른 PC에서
  설치되지 않고, Store에 올리면 정체성 불일치로 거절된다).

CI 잡은 이미 있다 — `Desktop installers` 워크플로의 `store` 항목이 Windows
러너에서 `pack:appx`를 돌려 **무서명** 패키지를 만든다(Store는 Microsoft가
서명한다). 그 잡은 첫 단계에서 지금 설정된 정체성 세 값을 로그에 찍고,
자가서명 값인 채면 경고를 남긴다 — 빌드는 성공하므로 그러지 않으면 올려 보고서야
안다. Windows 기기가 없어도 이 잡으로 패키지를 얻을 수 있다.

## 서명 — 직접 배포(.exe/.dmg)는 아직 하지 않는다

지금은 **무서명**이다(내부·테스트 배포부터). 그래서 처음 실행할 때:

- **Windows**: SmartScreen이 "Windows에서 PC를 보호했습니다"를 띄운다 →
  `추가 정보` → `실행`. 서명 인증서(OV/EV)를 CI 시크릿에 넣으면 사라진다.
- **macOS**: Gatekeeper가 막는다. **여는 방법이 macOS 버전마다 다르다** —
  아래 순서를 그대로 따른다.

  - **macOS 15(Sequoia) 이상** — 대화상자가 *"Apple은 … 악성 코드가 없음을 확인할
    수 없습니다"* + `휴지통으로 이동`/`완료`다. 이 버전부터 Apple이 **우클릭 → 열기
    우회를 없앴다**. `완료`로 닫고 → **시스템 설정 → 개인정보 보호 및 보안** →
    아래로 스크롤 → *"'Geurio'은(는) 확인된 개발자가 배포한 것이 아니기 때문에
    차단되었습니다"* 옆의 **`확인 없이 열기`** → 암호 → 한 번 더 `열기`.
    (이 버튼은 **한 번 열어 보고 막힌 뒤에만** 나타난다. 그래서 순서가 중요하다.)
  - **macOS 14(Sonoma) 이하** — 대화상자가 *"개발자를 확인할 수 없기 때문에 열 수
    없습니다"*다. **우클릭(control+클릭) → 열기 → 열기**로 열린다.
  - **어느 버전이든 되는 길** — 터미널에서
    `xattr -dr com.apple.quarantine /Applications/Geurio.app`.
    다운로드에 붙은 격리 표시(quarantine)를 떼는 것이라 그다음부터는 그냥 열린다.

  세 길 모두 **처음 한 번만**이다(그 앱을 다시 내려받으면 다시 물어본다).
  서명 + 공증(notarization)을 하면 이 단계 자체가 사라진다.
  (Apple Silicon에서 앱이 아예 실행되지 않는 것을 막으려고 `scripts/adhoc-sign.cjs`가
  **애드혹 서명**을 붙인다 — 인증서 없이 붙일 수 있는 서명이다. 다만 애드혹 서명은
  "실행은 되게" 할 뿐이라 위 확인 절차를 없애 주지는 않는다.)

인증서가 준비되면 `.github/workflows/desktop.yml`의 주석에 적힌 시크릿을 채우고
`electron-builder.yml`의 `mac.identity: null`을 지우면 된다. 그 밖의 구조는 그대로다.

### macOS 공증(notarization) — 준비물과 절차

Gatekeeper 확인 절차를 **없애는 유일한 길**이다(애드혹 서명으로는 안 된다 —
그것은 "실행은 되게" 할 뿐이다). 드는 것은 **Apple Developer Program 연 $99**
하나이고, 그것이 직접 배포(`.dmg`)와 App Store 양쪽의 근거다.

1. **가입** — [developer.apple.com/programs](https://developer.apple.com/programs/).
   개인사업자는 **Individual/Sole Proprietor**로 가입하는 편이 빠르다(Organization은
   D-U-N-S 번호가 필요하다). 대신 개발자 이름이 **개인 실명**으로 표시된다 —
   앱 정보에 사업자명을 띄우려면 Organization이어야 하므로, 그게 중요하면 그때
   D-U-N-S를 먼저 받는다(무료, 며칠 걸린다).
2. **인증서** — Certificates에서 **Developer ID Application**을 만든다
   (App Store용 `Mac App Distribution`이 **아니다** — 직접 배포용은 이쪽이다).
   Keychain에서 `.p12`로 내보내고 `base64 -i cert.p12 | pbcopy`.
3. **App Store Connect API 키**(권장) — Users and Access → Integrations →
   Keys에서 만들고 `.p8`·Key ID·Issuer ID를 받는다. Apple ID + 앱 암호 방식보다
   안전하다(만료·회수가 되고 계정 암호와 무관하다).
4. **저장소 시크릿 6개**
   `CSC_LINK`(.p12 base64) · `CSC_KEY_PASSWORD` ·
   `APPLE_API_KEY`(.p8 내용) · `APPLE_API_KEY_ID` · `APPLE_API_ISSUER` ·
   (API 키를 쓰지 않는다면 대신 `APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID`)
5. **설정 두 줄** — `electron-builder.yml`의 `mac`에서 `identity: null`을 지우고
   **`hardenedRuntime: true`**로 바꾼다. 공증은 hardened runtime을 **요구한다**
   (지금 `false`인 것은 무서명 빌드라 켤 이유가 없었기 때문이다). entitlements는
   electron-builder의 Electron 기본값으로 통한다.
   `mac.notarize`는 **따로 켜지 않는다** — 위 환경 변수가 있으면 저절로 돌고,
   끄고 싶을 때만 `notarize: false`다.
6. **확인** — 빌드 로그에 `notarization successful`, 그리고 받은 dmg에서
   `spctl -a -vvv -t install Geurio.app` → `source=Notarized Developer ID`.

공증은 Apple 서버 왕복이라 **빌드가 5~15분 길어진다**. 지금 mac 잡이 1분 20초인
것과 비교하면 그 차이는 전부 대기 시간이다.

## 아직 하지 않은 것

- **자동 업데이트**(`electron-updater`). 무서명 산출물을 자동으로 받아 실행하는
  것은 신뢰할 수 있는 갱신 경로가 아니고, 애초에 앱 화면은 웹 배포가 곧 최신이라
  셸을 자주 갱신할 이유가 없다. 서명 후에 붙이는 것이 순서다.
- **Linux 산출물**. 만들 수는 있지만(설정에 타깃만 더하면 된다) 요청 범위가
  Windows·macOS였다.
- **Store 제출**. 패키지는 만들 수 있고 로컬 설치까지 되지만, 정체성(Partner
  Center 예약)이 있어야 올릴 수 있다 — 위 "Store 제출까지 남은 것".
- **전역 단축키**. 웹 앱이 자기 단축키를 이미 들고 있어서 겹치지 않게 설계해야
  한다 — 별건. (앱 메뉴는 일부러 두지 않는다 — 위 "키보드".)

## 아이콘

```bash
pnpm --filter @mindflow/desktop generate:icon
```

PWA·모바일과 **같은 벡터 정의**(코럴 둥근사각 + 흰 소용돌이)에서 만든다. 마크가
바뀌면 세 스크립트를 함께 돌린다(`apps/web/scripts/generate-icons.mjs`,
`apps/mobile/scripts/generate-native-assets.mjs`).

산출물은 `build/icon.png`(1024 — electron-builder가 여기서 `.ico`·`.icns`를 만든다),
`build/appx/` 타일 4종, 그리고 `resources/tray.png`·`tray@2x.png`(트레이)다.
트레이 아이콘만 `resources/`인 이유: **`build/`는 앱에 담기지 않는다**
(`files:`가 담는 것은 `dist`·`resources`뿐) — 거기 두면 개발 실행에서는 보이고
설치본에서만 사라져 상주 기능이 통째로 없어진다. 타일은 정사각 아이콘을 늘리지 않고 **글리프를 가운데**
둔다(넓은 타일에서 마크가 찌그러지지 않게).

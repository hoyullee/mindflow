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

## 문서 지도 — 자주 쓰는 명령은 이 파일, 경위·근거는 `docs/`

| 문서 | 담긴 것 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | **왜 원격 출처를 띄우는가** · Google 로그인(시스템 브라우저 + `geurio://` 딥링크 — 임베드 OAuth 차단) · **트레이 상주**(닫기=숨기기, 로그인 시 실행 `--hidden`, AUMID = `appId`) · 창 밖 알림(배너 유지·작업 표시줄·배지) · **키보드**(메뉴를 두지 않고 브라우저 키 차단, 개발자 도구는 `GEURIO_DEVTOOLS=1`일 때만) |
| [`docs/msix.md`](docs/msix.md) | MSIX **로컬 설치 명령**(관리자 PowerShell·`dev-cert.ps1`) · `A required function is not present.` 해결(`toolsets.winCodeSign`) · MSIX에서 달라지는 것 · Store 제출까지 남은 것 |
| [`docs/signing.md`](docs/signing.md) | 무서명 설치본 여는 법(SmartScreen · **macOS 15+ Gatekeeper는 우클릭→열기가 없다**) · macOS 공증 준비물과 절차(hardened runtime 함께 켜기) |
| [`docs/release.md`](docs/release.md) | 설정 › 버전 확인의 업데이트 행 · 홈 LNB 알림 · **새 판 내보내는 절차**(`package.json` version 올림 → 라이브 → `desktop-vX.Y.Z` 태그 — 태그와 버전 불일치는 `plan` 잡이 막는다) |
| [`STORE.md`](STORE.md) | Store 등록 정보·심사자용 메모 초안 |

**함정 셋(자주 밟는다)**: 리눅스에서 Windows 설치본을 만들지 않는다(wine — 아래 「설치 파일 만들기」) ·
트레이 아이콘은 `build/`가 아니라 `resources/`(아래 「아이콘」) · CDP로 넣은 키는 셸의 키 차단을
지나지 않는다(재려면 `webContents.sendInputEvent` — `docs/architecture.md` 「키보드」).

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

## 아직 하지 않은 것

- **자동 설치**(`electron-updater`). **확인·안내까지는 되어 있다**([`docs/release.md`](docs/release.md)) — 남은 것은 받아서 스스로 설치하는 부분이고, 그건 **서명이
  전제다**: macOS의 Squirrel.Mac은 Developer ID 서명이 없으면 갱신을 거절하고
  (애드혹은 "실행은 되게" 할 뿐이다), Windows는 기술적으로 되지만 그건 검증되지
  않은 설치 파일을 자동으로 받아 실행하는 것이라 버전 파일 호스트가 뚫리면
  사용자 기기에서 코드가 돈다. 인증서가 준비되면 그 행만 승격하면 된다.
- **Linux 산출물**. 만들 수는 있지만(설정에 타깃만 더하면 된다) 요청 범위가
  Windows·macOS였다.
- **Store 제출**. 패키지는 만들 수 있고 로컬 설치까지 되지만, 정체성(Partner
  Center 예약)이 있어야 올릴 수 있다 — [`docs/msix.md`](docs/msix.md) 「Store 제출까지 남은 것」.
- **전역 단축키**. 웹 앱이 자기 단축키를 이미 들고 있어서 겹치지 않게 설계해야
  한다 — 별건. (앱 메뉴는 일부러 두지 않는다 — [`docs/architecture.md`](docs/architecture.md) 「키보드」.)

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

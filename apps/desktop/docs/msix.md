# Microsoft Store 채널(MSIX) — 로컬 설치·문제 해결

[`../README.md`](../README.md)(색인·자주 쓰는 명령)에서 옮긴 원문입니다.

## Microsoft Store 채널(MSIX) — 지금은 자가서명 로컬 설치까지

Windows는 **Store에 올리면 Microsoft가 패키지에 서명해 준다** → 코드 서명
인증서를 사지 않아도 SmartScreen 경고가 없다. (macOS는 Apple Developer Program
연회비가 직접 배포·App Store 양쪽의 근거라 Store로 가서 아끼는 것이 없다 —
그래서 Windows만 Store, macOS는 `.dmg` 직접 배포다.)

지금 저장소에 있는 것은 **자가서명으로 내 PC에 설치해 보는 상태**다. Store 제출은
Partner Center에서 앱 이름을 예약해 정체성을 받은 뒤에야 가능하다(아래 「Store 제출까지 남은 것」).

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
- 업데이트는 **Store가 맡는다** — 그래서 이 채널에는 갱신 장치를 따로 붙이지
  않는다(설정의 "새 설치 버전" 행은 MSIX에서도 뜨지만, 그쪽 사용자는 Store가
  이미 갱신해 주므로 대개 `최신`이다).

### Store 제출까지 남은 것

절차는 **[STORE.md](../STORE.md)**에 있다(계정 등록 → 이름 예약 → 정체성 세 값 →
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

다만 **태그를 밀 때는 이 잡이 돌지 않는다**(릴리스에 설치할 수 없는 파일이 붙지
않게 — 위 「새 판을 내보내는 절차」). `Run workflow`에서 `store`를 **직접 골라야**
만들어지고, 산출물은 그 실행의 아티팩트로만 올라온다.

# 서명·공증

[`../README.md`](../README.md)(색인·자주 쓰는 명령)에서 옮긴 원문입니다.

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

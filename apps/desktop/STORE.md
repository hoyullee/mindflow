# Microsoft Store 제출 안내

Windows 채널을 Store로 내는 이유는 **비용**이다. 직접 배포(`.exe`)는 무서명이라
SmartScreen이 "알 수 없는 발행자"를 띄우고, 그걸 없애려면 코드 서명 인증서를
사야 한다(OV는 2023-06부터 하드웨어 토큰 보관이 의무라 매년 비용이 붙는다).
**Store에 올리면 Microsoft가 패키지에 서명한다** → 인증서 없이 경고가 사라진다.
등록비도 개인·회사 모두 **무료**다(회사 계정은 2026-05-07부터).

macOS는 이 절감이 없다 — Apple Developer Program 연회비가 직접 배포 서명·공증과
App Store 양쪽의 근거라, Store로 가서 아끼는 것이 없다. 그래서 **Windows만 Store,
macOS는 `.dmg` 직접 배포**다.

이 문서는 **사람이 하는 절차**를 적는다(코드 쪽 사정은 `README.md`의
"Microsoft Store 채널(MSIX)" 참고). 결정된 것: **회사 계정** · 예약할 이름
**"그리오 (Geurio)"** · 등록 정보 **한국어 + 영어**.

> **회사 계정은 그리오를 위한 본인 개인사업자 명의다** — 현 직장(고용주) 계정이
> 아니다. 아래 ⚠️ 블록을 반드시 읽는다.
>
> 근거 둘. ① Microsoft의 정의: **개인**은 "Store를 통한 앱 배포가 자신의
> 사업·직업·업무와 **관련되지 않은**" 경우(취미·학습·비상업), **회사**는
> "**관련된**" 독립 개발자·프리랜서와 법인·단체다. 창업 도구는 회사 쪽이다.
> ② **전환이 없다** — 문서가 못박는다: *"개인에서 회사로 개발자 계정을 바꾸는
> 것은 Partner Center에서 지원되지 않습니다. 회사로 게시하려면 새 회사 개발자
> 계정을 만들어야 합니다."* 정체성(패키지 이름)은 계정에 묶여 있으므로 나중에
> 옮기려면 **새 정체성 · 새 리스팅**이 되고 그때까지의 설치·리뷰는 따라오지
> 않는다. 그래서 처음에 맞게 고른다.

---

## 0. 시작 전에 필요한 것 세 가지

| 준비물 | 누가 | 왜 |
| --- | --- | --- |
| Partner Center 개인 개발자 계정 | 소유자 | 정체성(아래 세 값)이 여기서 나온다 |
| **심사자용 테스트 계정** | 소유자 | **없으면 자동 반려된다**(아래 6단계) |
| 스크린샷 1~10장 | 소유자 | 최소 1장 필수, 4장 권장 |

세 번째는 Windows 실기기에서 찍는 편이 낫다 — 타이틀 바까지 실제 창 그대로
담긴다. 어렵다면 요청하면 브라우저에서 같은 화면을 규격에 맞춰 만들어 준다
(내용은 같다. 셸이 웹 앱을 그대로 띄우기 때문이다).

---

## 1. 개발자 계정 등록 (무료)

### 입구는 하나다

**<https://storedeveloper.microsoft.com>** → `Get started for free`

문서가 **"이곳이 유일하게 지원되는 진입점"**이라고 못박는다. 다른 곳에서
시작하면 엉뚱한 프로그램으로 흘러간다 — 실제로 겪은 함정이 아래 것이다.

> ⚠️ **`Microsoft Cloud Partner Program`(MCPP) 화면이 나오면 잘못 온 것이다.**
> `파트너 센터 시작` / `Microsoft Cloud Partner Program 등록 단계`라는 제목과
> 함께 "Office 365·Azure·Dynamics CRM에 로그인하는 업무용 메일"을 요구하는
> 화면이면 **닫고 위 주소로 다시 시작한다.** MCPP는 파트너사로서 역량 인증을
> 받는 프로그램이고 앱 배포와 무관하다. 그 화면도 업무 계정을 요구하지만
> **우리가 회사 계정을 고른 이유와는 상관이 없다** — 그건 그 프로그램의 요건이고,
> 우리 근거는 위에 인용한 "사업·직업과 관련된 배포" 정의다. 같은 업무 계정을
> 쓰더라도 **등록하는 프로그램이 다르다.**
>
> `어떤 방법으로 Microsoft의 파트너가 되시겠습니까?`라는 다중 선택 화면을
> 만나면 **`Xbox Games와 Windows 앱 같은 소비자 애플리케이션을 개발합니다
> (소비자 개발자)` 하나만** 고른다. 특히 `독립 소프트웨어 공급업체(ISV)`는
> 우리 얘기처럼 읽히지만 **Azure Marketplace·AppSource**(기업 고객용) 쪽이다.

### ⚠️ 고용주 계정으로 등록하지 않는다

그리오는 **본인이 따로 만드는 제품**이고 현 직장과 무관하다. 그런데 회사 계정
등록은 사업체 확인·재직 확인이 **등록에 쓴 그 조직**을 향하므로, 직장 업무
계정(`@고용주도메인`)으로 등록하면:

- **Store 발행자가 고용주 회사명으로 표시된다** — 본인 제품을 남의 이름으로 내는 셈이다
- 사업체·재직 확인이 그 회사를 대상으로 돌고, 그 회사를 대표해 약관에 동의하는 꼴이 된다
- 제품 소유권·IP 관계가 흐려진다

그래서 **등록 계정도, 연락처 이메일도 고용주 도메인을 쓰지 않는다.**

### 준비물 (본인 개인사업자 명의)

| 항목 | 내용 |
| --- | --- |
| 사업자 등록 | **개인사업자등록증** — Microsoft가 인정하는 "정부 발급 사업자등록증 또는 인허가"에 해당한다(DUNS 번호가 없어도 된다) |
| 로그인 계정 | 개인 Microsoft 계정 또는 업무 계정(Entra ID) 중 하나. **고용주 계정은 쓰지 않는다** |
| 연락처 | 조직 도메인의 이메일 — **`@geurio.com`**(도메인을 이미 갖고 있다) |

DUNS 번호 대신 쓸 수 있는 서류는 문서가 열거한다: 설립 증서·정관 / **정부 발급
사업자등록증 또는 인허가** / 정부 사이트의 공식 법인 등록 기록 / 세무·거래소 신고서.

확인은 세 갈래로 돈다 — **실사(due diligence, 이게 통과해야 다음이 진행된다)** ·
**사업체 확인** · **재직 확인**. 수동 검토는 **영업일 2~5일**이 걸린다. 등록에 적은
도메인과 이메일 도메인이 어긋나면 **도메인 확인** 서류를 더 요구할 수 있으므로,
사업자 등록과 연락처 이메일을 `geurio.com`으로 맞추는 편이 매끄럽다.

> 개인사업자 등록은 국세청 홈택스에서 온라인으로 할 수 있다. 업종 선택·세무
> 신고 의무 같은 것은 이 문서의 범위가 아니니 필요하면 세무 쪽에 확인한다.

발행자 표시 이름은 **Store에 그대로 노출**되고 나중에 바꾸려면 지원 요청이
필요하므로 등록 단계에서 확인한다.

## 2. 앱 이름 예약 → 정체성 세 값

`앱 및 게임` → `새 제품` → `앱` → 이름 예약. 예약한 이름이 **그대로 Store
제목**이 된다. `그리오 (Geurio)`로 예약하고, 영문명도 함께 확보하고 싶으면
같은 제품에 이름을 하나 더 예약할 수 있다.

예약 뒤 `제품 관리` → `제품 ID`(또는 `앱 ID`) 화면에 세 값이 있다. 이 값들을
`apps/desktop/electron-builder.yml`의 `appx` 블록에 **글자 하나까지 그대로** 옮긴다:

```yaml
appx:
  identityName: <Package/Identity/Name>          # 예: 12345Geurio.1234ABCD
  publisher: <Package/Identity/Publisher>        # 예: CN=1A2B3C4D-....
  publisherDisplayName: <Publisher display name> # Store에 보이는 이름
```

- 지금 값(`Geurio.Desktop` / `CN=Geurio Dev` / `Geurio`)은 **자가서명 로컬
  설치용**이다. 그대로 올리면 정체성 불일치로 거절된다.
- `publisher`는 **인증서 Subject와 같아야** 하는 값이라, 개발용 인증서를 만드는
  `scripts/dev-cert.ps1`이 이 파일에서 그 값을 직접 읽는다. 세 값을 바꾸면
  그 스크립트가 만드는 인증서도 따라 바뀌므로 로컬 설치 테스트는 그대로 된다.
- 이 세 줄을 바꾸는 커밋은 저장소에 남는다 — **비밀이 아니다**(패키지 안에
  그대로 들어가는 공개 정보다).

## 3. 패키지 만들기 — 서명하지 않는다

**Store 패키지는 Microsoft가 서명한다.** 그래서 인증서를 넣지 않고 만든다.
넣으면 우리 서명이 남아 정체성이 어긋난다.

```powershell
# Windows에서
pnpm install
pnpm --filter @mindflow/desktop run pack:appx   # CSC_LINK 없이!
# → apps/desktop/release/Geurio <버전>.appx
```

또는 **CI에서**(Windows 기기가 없어도 된다):
`Actions` → `Desktop installers` → `Run workflow` → 아티팩트
`geurio-desktop-store`. 그 잡의 로그 첫 단계가 지금 설정된 정체성 세 값을
찍으므로, **자가서명 정체성인 채로 만든 패키지를 실수로 올리는 일**을 막을 수 있다.

버전은 `apps/desktop/package.json`의 `version` 하나가 정본이다.
electron-builder가 `0.2.0` → `0.2.0.0`으로 만들어 Store의 "revision은 0" 규칙을
자동으로 맞춘다. **제출마다 이 값을 올린다**(같은 버전은 다시 올릴 수 없다).

## 4. 등록 정보(Store listing)

`제출` → `Store 등록 정보`. 언어를 **한국어**와 **영어(미국)** 둘 다 추가한다.

### 한국어

**설명**

```
그리오는 생각을 정리하는 방식을 하나로 강요하지 않습니다.

가지를 뻗는 마인드맵, 자유롭게 붙이는 화이트보드, 단계로 나누는 칸반 보드를
한 곳에서 쓰고, 마감이 있는 일은 일정에 모아 봅니다.

• 마인드맵 — 주제를 이어 붙이며 생각을 펼칩니다. 굵게·기울임·취소선·링크,
  글머리 기호와 번호 목록, 이미지 첨부를 그대로 쓸 수 있고, 만든 맵은
  PNG·SVG·PDF·Markdown·JSON으로 내보냅니다.
• 화이트보드 — 메모와 이미지를 원하는 자리에 놓고, 펜과 형광펜으로 그 위에
  직접 그립니다. 프레임으로 구획을 묶고 연결선으로 잇고, 스티커에 점 투표와
  이모지 반응을 달아 회고나 아이디어 정리를 마무리합니다.
• 칸반 보드 — 할 일을 단계로 나눠 카드를 옮깁니다. 분류·담당·기한·시작일을
  달고, 보드·리스트·타임라인 세 가지로 같은 일을 다르게 봅니다.
• 일정 — 칸반 카드의 마감과 직접 만든 일정을 한 달력에서 봅니다.
  Google 캘린더를 연동하면 그 일정까지 같은 화면에 겹쳐 보고 고칠 수 있습니다.
• 대시보드 — 자주 보는 보드와 달력을 위젯으로 올려 첫 화면으로 씁니다.

함께 쓰는 것도 같은 자리에서 됩니다. 같은 문서를 열면 서로의 커서와 편집이
실시간으로 보이고, 캔버스 어디에나 스레드를 꽂아 논의하고 멘션으로 부릅니다.
이메일로 초대하거나, 링크를 아는 사람만 열람하게 할 수도 있습니다.

시작이 막막하지 않도록 마인드맵·화이트보드·칸반 템플릿을 갖춰 뒀고,
일곱 가지 색상 테마와 다크 모드로 눈에 맞춰 쓸 수 있습니다.

그리오 계정(이메일 또는 Google)이 필요하며, 문서 동기화를 위해 인터넷 연결이
필요합니다.
```

**기능 목록**(각 한 줄)

```
마인드맵 · 화이트보드 · 칸반 보드를 한 곳에서
실시간 공동 편집 — 서로의 커서와 편집이 바로 보입니다
캔버스에 꽂는 스레드 댓글과 멘션
칸반 마감과 일정을 한 달력에서, Google 캘린더 연동
자주 보는 것을 올려 두는 대시보드
PNG · SVG · PDF · Markdown · JSON 내보내기
펜과 형광펜으로 화이트보드에 직접 그리기
템플릿으로 바로 시작하기
일곱 가지 색상 테마와 다크 모드
```

**검색어**(최대 7개)

```
마인드맵, 화이트보드, 칸반, 생각정리, 협업, 브레인스토밍, 회고
```

**짧은 설명**

```
마인드맵 · 화이트보드 · 칸반 보드. 지금 하는 일에 맞는 방식으로 생각을 정리하고 함께 완성하세요.
```

### 영어(미국)

**Description**

```
Geurio doesn't force one way to organize your thinking.

Branch out in a mind map, stick things wherever they belong on a whiteboard, or
move work through stages on a kanban board — all in one place, with everything
that has a deadline gathered into one calendar.

• Mind maps — grow ideas topic by topic. Bold, italic, strikethrough and links,
  bulleted and numbered lists, image attachments. Export to PNG, SVG, PDF,
  Markdown or JSON.
• Whiteboards — place notes and images freely, then draw on top with a pen or
  highlighter. Group things in frames, connect them with arrows, and close a
  retrospective with dot votes and emoji reactions on the stickies.
• Kanban boards — split work into stages and move cards through them. Add
  labels, owners, due dates and start dates, and see the same work as a board,
  a list, or a timeline.
• Calendar — kanban due dates and your own events in one month view. Connect
  Google Calendar to see and edit those events in the same place.
• Dashboards — pin the boards and calendars you check often as widgets and use
  them as your landing screen.

Working together happens in the same place. Open the same document and you see
each other's cursors and edits live; drop a comment thread anywhere on the
canvas and mention someone to pull them in. Invite by email, or let anyone with
the link view it.

Templates for mind maps, whiteboards and kanban boards get you started, and
seven color themes plus a dark mode let you set it up the way you like.

Requires a Geurio account (email or Google) and an internet connection to sync
your documents.
```

**Features**

```
Mind maps, whiteboards and kanban boards in one place
Real-time collaboration — see each other's cursors and edits
Comment threads pinned anywhere on the canvas, with mentions
Kanban due dates and events in one calendar, with Google Calendar
Dashboards for the boards you check often
Export to PNG, SVG, PDF, Markdown and JSON
Draw on whiteboards with a pen and highlighter
Start from a template
Seven color themes and a dark mode
```

**Search terms**

```
mind map, whiteboard, kanban, brainstorming, collaboration, retrospective, diagram
```

**Short description**

```
Mind maps, whiteboards and kanban boards. Organize your thinking the way the work needs, and finish it together.
```

### 스크린샷

`.png`, **1366×768 이상**(4K 3840×2160까지), 50MB 이하, 최소 1장·최대 10장.
권장 4장은 이 순서로 — 앱이 무엇인지 한 장에 드러나는 것부터:

1. 마인드맵 편집기(내용이 있는 맵 + 속성 패널)
2. 화이트보드(메모·그리기·프레임)
3. 칸반 보드(열과 카드, 분류·담당·기한이 보이게)
4. 일정 또는 대시보드

각 장에 캡션을 달 수 있다(위 기능 목록 문장을 그대로 써도 된다).

### 그 밖의 등록 항목

| 항목 | 값 |
| --- | --- |
| 범주 | 생산성(Productivity) |
| 가격 | 무료 |
| 개인정보처리방침 URL | `https://geurio.com/privacy` |
| 웹사이트 | `https://geurio.com` |
| 지원 문의 | 소유자 이메일(앱 안 피드백 창구도 있다) |

개인정보처리방침 URL은 **필수**다 — 계정·문서를 다루므로 개인 데이터에 접근하는
앱이다.

## 5. 연령 등급

`연령 등급`에서 IARC 설문에 답한다. 우리 앱에 해당하는 사실만 적으면 된다:

- 폭력·성적 내용·사행성·욕설·약물 — **없음**
- 앱 내 구매·광고 — **없음**
- **사용자가 만든 내용을 다른 사용자와 공유한다 — 예**(공유·초대·링크 공유)
- **사용자끼리 소통한다 — 예**(스레드 댓글·멘션)
- 위치·연락처 수집 — 없음

마지막 두 항목 때문에 등급이 전체 이용가보다 올라갈 수 있다. **있는 대로
답한다** — 설문에 사실과 다르게 답하는 것이 반려 사유다.

## 6. 심사자용 메모 — 여기서 반려가 갈린다

`제출 옵션` → `인증 메모(Notes for certification)`. Microsoft 문서가 못박은
규칙: **로그인이 필요한 앱은 동작하는 데모 계정을 이 칸에 적어야 하고, 명확한
지침이 없는 앱은 제출 단계에서 자동 실패한다.** 심사자는 우리에게 로그인
정보를 물어볼 수 없다.

우리 앱은 열면 로그인 화면이고, 이메일 가입은 **메일로 오는 인증번호**가
필요해서 심사자가 스스로 계정을 만들 수 없다. 그러니 **비밀번호로 로그인되는
계정을 미리 만들어** 적는다.

준비 방법:

1. `https://geurio.com`에서 이메일로 계정을 만든다(인증번호 확인까지 완료).
   예: `store-review@…` — 소유자가 받을 수 있는 주소면 된다.
2. 그 계정으로 로그인해 **맵 1개 · 화이트보드 1개 · 칸반 1개**를 만들어 둔다.
   빈 화면이면 심사자가 "기능이 없다"로 읽는다.
3. 아래 메모를 채워 넣는다.

```
[테스트 계정]
이메일: <위에서 만든 주소>
비밀번호: <비밀번호>

[로그인 절차]
1. 앱을 실행하면 로그인 화면이 뜹니다.
2. "로그인" 탭에서 위 이메일과 비밀번호를 입력하고 "로그인"을 누릅니다.
   (Google 로그인 버튼은 기본 브라우저를 열어 인증한 뒤 앱으로 돌아옵니다.
    테스트에는 위 이메일·비밀번호를 쓰시는 것이 간단합니다.)
3. 로그인하면 대시보드가 열립니다. 왼쪽 사이드바에서 스페이스를 열면
   미리 만들어 둔 마인드맵·화이트보드·칸반 보드가 있습니다.
4. 카드를 두 번 클릭하면 편집기가 열립니다.

[참고]
- 이 앱은 문서 동기화를 위해 인터넷 연결이 필요합니다.
- 웹 서비스(https://geurio.com)와 같은 계정·같은 문서를 사용합니다.
- 계정 없이 볼 수 있는 화면은 없습니다(개인 문서를 다루는 앱입니다).
```

메모는 심사자만 보고 Store에는 공개되지 않는다. 다만 **계정 정보를 적는
칸이므로 그 계정에는 개인 문서를 두지 않는다.**

## 7. 제출과 그 뒤

패키지 업로드 → 등록 정보 → 연령 등급 → 인증 메모까지 채우면 제출한다.
심사 결과는 메일로 오고, **반려되면 어떤 시험·정책 항목인지 알려 준다.
재제출은 무료·무제한**이므로 잃는 것은 시간뿐이다.

반려가 나면 그 문구를 그대로 알려 주면 함께 고친다. 예상되는 지점은 둘이다:

- **심사자가 로그인하지 못했다** → 6단계의 계정·절차를 손본다.
- **정체성 불일치** → 2단계 세 값을 다시 대조한다(글자 하나까지 같아야 한다).

Store에 올라간 뒤에는 **업데이트도 Store가 맡는다** — 그래서 이 채널에는
자동 업데이트를 붙이지 않았다. 새 판을 내려면 `package.json`의 `version`을
올려 패키지를 다시 만들어 올린다. 앱 화면 자체는 웹 배포가 곧 최신이므로
셸을 자주 갱신할 이유는 없다.

## 확인하지 못한 것

- **정책 전문**(`Microsoft Store Policies`)은 `learn.microsoft.com`이 이
  개발 환경에서 차단돼 조항을 직접 읽지 못했다. 위 내용은 검색 요약과
  Microsoft 문서 인용으로 확인한 범위다 — 제출 화면의 안내가 이 문서와
  다르면 **화면을 따른다**.
- 회사 계정의 **발행자 표시 이름이 무엇에서 정해지는지**는 문서에 없었다
  (등록 화면에서 확인해야 한다).
- **개인 계정이 유료 앱 판매·수익 정산을 할 수 있는지**는 문서에 없었다. 지금
  그리오는 무료라 당장 걸리는 것은 없고, 회사 계정으로 가므로 이 물음은
  비켜 간다.
- 온보딩 절차는 2025~2026에 개편이 잦았다. 화면 안내가 이 문서와 다르면
  **화면을 따른다**.
- MSIX 패키지 생성은 Windows에서만 된다(이 저장소의 CI 잡 또는 Windows 기기).
  Linux에서는 electron-builder의 `AppxTarget`이 실행 즉시 실패한다.

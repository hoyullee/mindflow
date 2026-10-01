# 프로브 함정 — 검증이 거짓말을 하는 자리들

실브라우저 프로브(Playwright·CDP)·테스트 하네스·로컬 검증에서 **앱이 아니라 프로브가 틀렸던**
사건들을 모았습니다. 전부 이 저장소에서 실제로 겪은 것이고, 값은 실측입니다.

**이 문서는 색인입니다** — 증상 표·체크리스트·태도만 담고, 각 항목의 사건 경위·실측·처방은
[`probe-pitfalls-detail.md`](probe-pitfalls-detail.md)에 있습니다(표의 링크가 그 자리로 갑니다). 검증 전에는 이 문서를 훑고,
걸리는 항목만 상세를 읽습니다. 새 함정은 상세에 항목을 더하고 **여기 표에 한 줄**을 더합니다.

## 첫 번째 규칙

> **검증이 실패하면, 앱을 의심하기 전에 프로브를 의심한다.**

이 목록의 절반은 앱이 결백했던 사건입니다. 그리고 오진의 비용은 작지 않았습니다 —
`addInitScript` 재실행 하나에 **2시간**, 페이드 중 스크린샷에 **1시간**, CDP 키 이벤트에
**30분**을 잃었고, 같은 함정을 **다섯 번** 다시 밟은 것도 있습니다(A1). **한 라운드에서
둘을 함께 밟으면 없는 버그가 아주 그럴듯해집니다** — 2026-09-28에 F16(`textContent`)으로
"코드 블록의 Enter가 깨졌다"를 만들고, 이어 A1으로 "저장은 되는데 새로고침하면
사라진다"까지 만들어 **사용자에게 두 번 보고**했다. 앱은 처음부터 무결했다.

수리에 들어가기 전에 스스로 묻습니다: **이 실패가 앱 버그라면, 사용자가 손으로 했을 때도
같은 일이 일어나는가?** 아니라면 프로브를 고칠 차례입니다.

---

## 빠른 표 — 증상에서 찾기

| 증상 | 진짜 원인 | 항목 |
|---|---|---|
| "리로드하면 값이 되돌아간다" | `addInitScript`가 리로드에도 재실행돼 시드가 덮었다 | [A1](probe-pitfalls-detail.md#a1) |
| 주입한 상태가 화면에 없다 | init script가 페이지 생성 **뒤에** 붙었다 | [A2](probe-pitfalls-detail.md#a2) |
| 앱이 통째로 죽는다(실앱은 멀쩡) | 손으로 지은 시드에 필수 필드가 없다 | [A3](probe-pitfalls-detail.md#a3) |
| 단축키 차단이 안 먹는다 | CDP 키는 `before-input-event`를 지나지 않는다 | [B1](probe-pitfalls-detail.md#b1) |
| 드래그가 재배치되지 않는다 | 합성 이벤트를 동기로 쏴 React 커밋 전에 drop이 왔다 | [B2](probe-pitfalls-detail.md#b2) |
| Shift+클릭이 다중 선택이 아니다 | `keyboard.down`으로는 `shiftKey`가 실리지 않는다 | [B3](probe-pitfalls-detail.md#b3) |
| 좌표·색이 몇 px/톤 어긋난다 | 전이·애니메이션 **도중**에 쟀다 | [C1](probe-pitfalls-detail.md#c1) |
| 프레임 샘플이 1개뿐 | `t0`를 init script 시점에 잡았다 | [C2](probe-pitfalls-detail.md#c2) |
| "그런 노드는 없었다" | 같은 태스크 커밋이라 재조회로는 안 보인다 | [C3](probe-pitfalls-detail.md#c3) |
| 드래그가 허공을 잡는다 | 대상이 뷰포트 밖 1px에 걸려 `elementFromPoint`가 NONE | [D1](probe-pitfalls-detail.md#d1) |
| 캔버스 좌표가 안 맞는다 | 뷰포트 요소가 (0,0)이 아니다(jsdom은 0) | [D2](probe-pitfalls-detail.md#d2) |
| `vi.spyOn(document,'elementFromPoint')`가 터진다 | jsdom에 그 메서드가 없다 | [F17](probe-pitfalls-detail.md#f17) |
| 줄바꿈이 **안 들어갔다**(화면에는 두 행) | `textContent`가 `<br>`을 안 읽는다 — `innerHTML`·사각형으로 센다 | [F16](probe-pitfalls-detail.md#f16) |
| "보일 때만 읽기"가 영영 안 읽는다 | 나중에 서는 노드를 `ref.current`로 관측했다 | [F18](probe-pitfalls-detail.md#f18) |
| 「모두 펼치기」로 찍었는데 **전부 접혀** 있다 | 그 버튼은 토글이고 기본값이 이미 펴져 있었다 | [F19](probe-pitfalls-detail.md#f19) |
| 터치를 길게 눌러도 우클릭 메뉴가 안 뜬다 | 헤드리스는 그 제스처로 `contextmenu`를 만들지 않는다 | [F20](probe-pitfalls-detail.md#f20) |
| 직접 쏜 `contextmenu`가 **어떤 탭 뒤로는** 안 연다 | 마지막 누름이 손가락이면 `noteTouchMenu`가 길게 누르기로 온 것만 통과시킨다 | [F42](probe-pitfalls-detail.md#f42) |
| 끌기 뒤의 단정이 늘 실패한다(앱은 멀쩡) | `pointermove`의 상태 갱신은 모아서 흘린다 | [F21](probe-pitfalls-detail.md#f21) |
| 테스트 네 개가 한꺼번에 타임아웃 | 가짜 시계 안에서 `waitFor`를 기다렸다 | [F22](probe-pitfalls-detail.md#f22) |
| 줄 끝 공백이 줄바꿈되는지 캐럿 y로는 안 보인다 | `Range` 사각형이 앞 행으로 접힌다 — 행 수를 센다 | [F23](probe-pitfalls-detail.md#f23) |
| 클릭이 엉뚱한 요소에 맞는다(앱은 멀쩡) | 앞 단계에서 연 팝오버·모달이 **아직 떠서** 덮고 있다 | [F25](probe-pitfalls-detail.md#f25) |
| `setLinearSelection`으로 놓은 캐럿이 늘 0이다 | jsdom의 `focus()`가 선택을 맨 앞으로 되돌린다 | [F26](probe-pitfalls-detail.md#f26) |
| 새 기능이 0건을 돌려준다(코드는 맞아 보인다) | 심은 시드가 **앱의 규칙에 걸려** 걸러졌다 | [F27](probe-pitfalls-detail.md#f27) |
| 가드를 깨뜨렸는데 테스트가 통과한다 | 함수만 재고 **부르는 자리**를 안 지킨다 | [F28](probe-pitfalls-detail.md#f28) |
| 브라우저 API로 쓴 가드가 jsdom에서 안 걸린다 | `isContentEditable`·`execCommand`는 jsdom에 없다 | [F29](probe-pitfalls-detail.md#f29) |
| OS 선택 손잡이를 끄는 것이 관측되지 않는다 | 그 손잡이는 브라우저 UI라 페이지에 이벤트가 없다 | [F34](probe-pitfalls-detail.md#f34) |
| "글자는 들어갔는데 고른 것이 안 지워진다" | 리액트 18이 `keydown` 갱신을 기본 동작보다 먼저 흘린다 | [F35](probe-pitfalls-detail.md#f35) |
| 끌기의 칠이 프레임마다 앞뒤로 튄다 | 손가락 아래에 **내가 그린 손잡이**가 있어 좌표 조회가 그것을 짚는다 | [F36](probe-pitfalls-detail.md#f36) |
| jsdom에서 행 높이가 **1.85px**이 된다 | 계산값 `line-height`를 jsdom은 맨 숫자로 돌려준다 | [F37](probe-pitfalls-detail.md#f37) |
| `::selection` 규칙을 적었는데 크로뮴에서 **걸리지 않는다** | 선택자 목록에 `::-moz-selection`이 섞이면 크로뮴은 규칙 전체를 버린다 · jsdom은 `::selection`을 계산하지 않는다 | [F38](probe-pitfalls-detail.md#f38) |
| 넘치면 흐르게 했는데 **실브라우저에서 한 번도 안 흐른다**(jsdom 테스트는 통과) | 인라인 요소의 `scrollWidth`는 늘 0 · 테스트가 그 값을 **심어서** 가렸다 | [F39](probe-pitfalls-detail.md#f39) |
| 글꼴 기능을 껐더니 헤드리스에선 풀렸는데 **실기기에선 그대로다** | 한 엔진·한 판의 모양내기로 결론을 냈다 — 폰트를 HarfBuzz로 직접 모양내 규칙을 확인한다 | [F40](probe-pitfalls-detail.md#f40) |
| 외부 API 변환 버그가 테스트로 **안 잡힌다**(제보는 온다) | 시드를 API의 실제 값이 아니라 **화면에 나올 값**으로 지었다 — 구글은 클래식 색을 준다 | [F41](probe-pitfalls-detail.md#f41) |
| 폭 비교가 3px 어긋난다 | 기울어진 요소는 bounding box가 부푼다 | [D3](probe-pitfalls-detail.md#d3) |
| 서식을 걸었더니 글이 밀렸다고 나온다 | `Range` 사각형은 인라인 스팬의 **padding까지** 센다 | [D5](probe-pitfalls-detail.md#d5) |
| 클릭이 엉뚱한 것을 잡는다 | 그 자리에 칩·시트가 먼저 있다 | [D4](probe-pitfalls-detail.md#d4) |
| 스크롤바가 안 보인다 | 헤드리스는 커스텀 스크롤바를 안 그린다 | [E1](probe-pitfalls-detail.md#e1) |
| 캐럿이 "앞 행 끝에 있다"고 나오는데 화면은 다르다 | `Range` 사각형은 랩 경계를 **늘 앞 행으로** 접는다 | [E12](probe-pitfalls-detail.md#e12) |
| 제보를 리눅스 프로브로 **재현할 수 없다**(키 관련) | 그 키의 기본 동작이 **OS마다 다르다**(Home·End) | [E13](probe-pitfalls-detail.md#e13) |
| OS 알림이 안 뜬다 | 헤드리스는 `Notification.permission`이 늘 denied | [E2](probe-pitfalls-detail.md#e2) |
| 웹 푸시 구독이 `AbortError` | 같은 이유 — 배달은 실기기에서만 확인된다 | [E2](probe-pitfalls-detail.md#e2) |
| "오늘 칸인데 오늘이 아니다" | 컨테이너 TZ ≠ 페이지 TZ(Asia/Seoul) | [E3](probe-pitfalls-detail.md#e3) |
| 타이틀 바·트레이가 없다 | 이 컨테이너는 리눅스다 | [E4](probe-pitfalls-detail.md#e4) |
| 우클릭 메뉴가 영영 안 뜬다 | 그 카드는 **일부러** 메뉴가 없다 | [E5](probe-pitfalls-detail.md#e5) |
| 저장이 실패한다(데모 모드) | 그 키가 곧 저장소 자신이다 | [E6](probe-pitfalls-detail.md#e6) |
| 하위 메뉴가 열리자마자 닫힌다 | jsdom엔 레이아웃이 없어 사각형이 전부 0 | [F1](probe-pitfalls-detail.md#f1) |
| `new Response`가 throw | 204는 본문을 가질 수 없다 | [F2](probe-pitfalls-detail.md#f2) |
| 스텁의 메서드가 없다 | 클래스 인스턴스 스프레드는 프로토타입을 잃는다 | [F3](probe-pitfalls-detail.md#f3) |
| fake timer가 안 먹는다 | 라이브러리가 로드 시점에 진짜 `Date.now`를 잡았다 | [F4](probe-pitfalls-detail.md#f4) |
| 밤에만 깨지는 테스트 | 오프셋으로 "오늘"을 만들었다 | [F5](probe-pitfalls-detail.md#f5) |
| 단위 테스트는 전부 초록인데 실브라우저가 React #185로 죽는다 | jsdom은 `naturalWidth`가 0이라 그 갈래를 건너뛴다 | [F7](probe-pitfalls-detail.md#f7) |
| 달 후반에만 깨지는 테스트 | "이 달 안"으로 클램프한 날이 **과거**가 됐다 | [F5](probe-pitfalls-detail.md#f5) |
| 화면은 맞는데 저장본이 한 커밋 뒤처져 있다 | ⌘S가 마지막 `setDoc` 전에 찍혔다 | [F8](probe-pitfalls-detail.md#f8) |
| 표의 크기 그립을 테스트에서 못 찾는다 | 재어서 그리는 부품은 jsdom에 없다 | [F9](probe-pitfalls-detail.md#f9) |
| ⌘S를 눌러도 저장본이 그대로다 | 폴링이 200ms 타이머를 매번 껐다 | [F10](probe-pitfalls-detail.md#f10) |
| jsdom은 통과인데 크롬에서 글자가 서식 **밖**에 떨어진다 | 폭 0인 인라인 요소 안의 캐럿은 브라우저가 앞으로 접는다 | [F11](probe-pitfalls-detail.md#f11) |
| 캐럿 자리를 재는 코드의 테스트가 **늘 `null`**이다 | jsdom의 `Range`에는 `getBoundingClientRect`가 아예 없다 | [F30](probe-pitfalls-detail.md#f30) |
| `fireEvent.pointerDown(el, { shiftKey: true })`가 안 먹는다 | jsdom에는 `PointerEvent`가 없어 init이 통째로 버려진다 | [F12](probe-pitfalls-detail.md#f12) |
| 방향키 한 번에 두 칸을 간다(새로 붙인 손이 같은 키를 또 받는다) | 이벤트 중에 `document`에 붙인 리스너가 **그 이벤트**를 받는다 | [F13](probe-pitfalls-detail.md#f13) |
| 바로 누르면 되는데 **잠시 쉬었다** 누르면 안 된다 | 되살리는 쪽에 "몇 초 안"이라는 신선도 조건이 있다 | [F14](probe-pitfalls-detail.md#f14) |
| 앞 단계의 선택이 다음 단계까지 따라온다 | `body.click()`은 우리 칠을 걷지 못한다(Esc가 걷는다) | [F15](probe-pitfalls-detail.md#f15) |
| 결과를 저장본으로 판정했더니 실패한다 | 자동저장은 늦다 — DOM에서 재거나 바뀔 때까지 폴링 | [A4](probe-pitfalls-detail.md#a4) |
| 스크린샷에 캐럿이 안 보인다 | 헤드리스는 글자 커서를 그리지 않는다 | [E7](probe-pitfalls-detail.md#e7) |
| 세로 스크롤만 줬는데 가로 스크롤이 생긴다 | `overflow-y: auto`는 가로도 `auto`로 만든다 | [E8](probe-pitfalls-detail.md#e8) |
| 스크롤바 관련 제보를 헤드리스로 못 본다 | xvfb headed로 내려간다(이 컨테이너에 있다) | [E9](probe-pitfalls-detail.md#e9) |
| "깜빡인다"가 스크린샷으로 안 잡힌다 | 프레임마다 있나/없나를 센다 | [E10](probe-pitfalls-detail.md#e10) |
| 손으로 넣은 인라인 스타일이 사라진다 | 리액트가 다시 그리며 덮는다 | [E11](probe-pitfalls-detail.md#e11) |
| jsdom 테스트는 통과인데 실기기에선 안 난다 | jsdom은 실기기가 만들 수 없는 상태도 답한다 | [F6](probe-pitfalls-detail.md#f6) |
| IME 제보를 CDP로 재현/반증했다 | CDP IME는 이 크로뮴의 순서일 뿐 — OS별 판정 불가 | [F24](probe-pitfalls-detail.md#f24) |
| 작은 시드 그림이 조작되지 않는다 | 제 손잡이에 통째로 덮였다 | [F31](probe-pitfalls-detail.md#f31) |
| 다시 그린 뒤 `Range`가 조용히 접힌다 | `Range`는 노드를 붙잡는다 | [F32](probe-pitfalls-detail.md#f32) |
| 테스트용 스텁이 실브라우저와 어긋난다 | 저장소에 없는 이름(`CSS.highlights`)을 테스트 쪽에서 세웠다 | [F33](probe-pitfalls-detail.md#f33) |
| 미커밋 구현이 사라졌다 | `git checkout <file>`로 "복구"했다 | [G1](probe-pitfalls-detail.md#g1) |
| 셸이 죽었다(exit 144) | `pkill -f`가 자기 자신을 물었다 | [G2](probe-pitfalls-detail.md#g2) |
| Electron이 창도 없이 바로 죽었다 | root라 `--no-sandbox`가 필요하다 | [G4](probe-pitfalls-detail.md#g4) |
| 로컬은 통과인데 CI가 깨진다 | 하위 패키지에서만 lint를 돌렸다 | [G3](probe-pitfalls-detail.md#g3) |

---

## 프로브를 쓰기 전 체크리스트

1. 시드를 심는가 → **가드**했는가([A1](probe-pitfalls-detail.md#a1)), **실물 모양**인가([A3](probe-pitfalls-detail.md#a3)), 리로드가 아니라 **새 페이지**인가
1b. 결과를 **저장본**에서 읽는가 → 자동저장은 늦는다([A4](probe-pitfalls-detail.md#a4)) — DOM에서 재거나 값이 바뀔 때까지 폴링
2. 좌표를 쓰는가 → 화면 **안쪽**인가([D1](probe-pitfalls-detail.md#d1)), 그 자리에 **다른 것**이 없는가([D4](probe-pitfalls-detail.md#d4)), 뷰포트 rect를 더했는가([D2](probe-pitfalls-detail.md#d2))
3. 잴 것이 좌표·스크린샷인가 → **전이가 끝난 뒤**인가([C1](probe-pitfalls-detail.md#c1))
4. 이벤트를 합성하는가 → 사이를 **띄웠는가**([B2](probe-pitfalls-detail.md#b2)), 수정 키는 `modifiers`인가([B3](probe-pitfalls-detail.md#b3))
5. 스크롤바·OS 알림·네이티브인가 → **xvfb headed**가 필요한가([E1](probe-pitfalls-detail.md#e1), [E2](probe-pitfalls-detail.md#e2), [E4](probe-pitfalls-detail.md#e4))
6. 날짜를 쓰는가 → **DOM에서** 읽었는가([E3](probe-pitfalls-detail.md#e3))
7. 플랫폼 상태(`visibilityState` 등)를 심는가 → 그 상태가 **대상 플랫폼에서 실제로 나는가**([F6](probe-pitfalls-detail.md#f6))
8. 실패했는가 → **사용자가 손으로 해도 같은 일이 나는가**(첫 번째 규칙)

새 함정을 만나면 이 문서에 한 줄 더하세요. 같은 함정을 두 번 밟는 것이 가장 비쌉니다 —
여기 실린 것 중 셋은 **네 번, 세 번, 두 번** 재발했습니다.

---

## H. 진단하는 태도

- **시안 대조는 확대해서.** 원본 해상도로 눈대중하면 2px 차이를 "고쳤다"고 착각합니다
  (`border-radius: 999px`와 `15px`이 34px 상자에서 2px 차이였고, 그것을 고쳤다고 보고했다가
  "프리뷰가 이전과 동일하다"는 제보를 받았습니다). 5배로 확대해 **비율**을 재고, 색은 픽셀로 뽑으세요.
- **증상이 바뀌면 어느 번들이 떠 있는지 먼저 확인.** 설정 › 버전 확인의 빌드 시각·커밋 7자가
  그 답입니다. 이 확인 한 줄이 30분을 아낀 적이 있습니다.
- **관측 가능한 것과 불가능한 것을 갈라 보고한다.** "확인할 수 없다"와 "되지 않았다"는 다른
  말입니다. 간접 신호(배포 상태 API 등)의 침묵을 결론으로 쓰지 마세요.
- **xvfb headed의 스크린샷은 합성 레이어를 믿을 수 없다.** `transition: opacity`가 걸린
  떠 있는 판(임베드 머리)을 찍었더니 **반투명하게** 나와 "배경이 비친다"로 읽혔습니다 —
  같은 순간에 잰 값은 `opacity: 1`, `backgroundColor: rgb(255,253,251)`(불투명),
  `elementFromPoint`도 그 판을 돌려줬습니다(즉 제대로 덮고 있었다). 소프트웨어 래스터가
  합성 레이어를 스크린샷에 다른 상태로 찍는 것입니다. **그림이 아니라 값으로 판단하세요**
  (`getComputedStyle` · `getBoundingClientRect` · `elementFromPoint`).
- **그리고 `:hover`는 페이지를 연 직후에도 켜져 있을 수 있다.** Playwright의 가상 포인터는
  이전 자리에 남아 있어, 아무것도 하지 않았는데 카드가 이미 hover 상태였습니다(그래서
  "hover일 때만 보이는 판"이 처음부터 보였다). **`page.mouse.move(2, 2)`로 치워 놓고**
  기준 상태를 재세요.
- **저장소에 없는 도구를 `npx`로 불러 소스에 대지 않는다.** `npx prettier --write`를 세 파일에
  걸었다가 **12,458줄이 바뀐 diff**를 만들었습니다 — 이 저장소에는 prettier 설정도 의존성도
  없어(`package.json`의 `lint`는 eslint 하나입니다) npx가 받아 온 판이 **제 기본값**(작은따옴표
  → 큰따옴표, 폭 80)으로 파일을 통째로 다시 썼습니다. 되돌리는 길은 `git checkout --` 뒤
  **편집을 처음부터 다시 거는 것**뿐이었습니다(그래서 그 편집들을 파이썬 스크립트로 남겨 두면
  값이 쌉니다). 손댄 뒤에는 `git diff --stat`으로 **줄 수가 뜻밖으로 크지 않은지** 보세요.
- **남의 라이브러리·API의 기본값은 소스에서 확인한다.** 기억으로 답하다 같은 자리를 두 번
  틀렸습니다(`@supabase/auth-js`의 기본 `flowType`은 `implicit`인데 PKCE로 가정했습니다).
  확인한 사실은 **코드에 못박아** 다음 사람이 다시 틀리지 않게 하세요.

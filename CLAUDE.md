# MindFlow — 프로젝트 컨텍스트 (팀 공용)

이 문서는 사람과 Claude 에이전트가 **공유하는 단일 컨텍스트**입니다. 새 세션·새 에이전트는
작업 전 이 파일을 먼저 읽습니다.

**이 파일은 세션마다 통째로 실립니다 — 그래서 짧게 유지합니다.** 라운드별 기록은
`docs/changelog.md`, 프로브 함정은 `docs/probe-pitfalls.md`, 배포·CI·운영 백로그 원문은
`docs/operations.md`, 백엔드 운영은 `server/supabase/docs/backend.md`(색인 — 섹션마다 `backend/NN-*.md`)에 있고 **넷 다 자동으로 읽히지 않습니다**(필요할 때
`grep`으로 찾아 읽습니다). 여기에 남기는 것은 **다음 세션이 모르면 안 되는 것**뿐입니다 —
규칙 · 아키텍처 · 현재 상태 · 배포 절차.

## 제품 개요
MindFlow는 중심 주제에서 가지를 뻗어 생각을 정리하는 **마인드맵 웹 앱**입니다.
목표: **웹 서비스 → 모바일 웹(PWA) → Android/iOS 앱** 순으로 확장.

## 현재 코드베이스 (디자인 원본)
`claude/mindflow-design-impl-iyxiol` 브랜치는 Claude Design에서 가져온 **디자인 프로토타입**입니다.
프로덕션 기반이 아니라 **픽셀·인터랙션 레퍼런스**로 취급합니다.

| 파일 | 역할 |
| --- | --- |
| `MindFlow.dc.html` | 마인드맵 편집기 (약 3,200줄) — 대상 |
| `Home.dc.html` / `Login.dc.html` | 대시보드 · 로그인(데모) |
| `support.js` | dc-runtime. **수정 금지** (Anthropic 생성물, 프로토타입 엔진) |
| `vendor/` | React 18.3.1 UMD |
| `index.html` | 진입점 |

### dc 포맷 구조
각 `*.dc.html` = `<x-dc>` 템플릿(HTML + `{{ }}`·`<sc-if>`·`<sc-for>`) + `<script type="text/x-dc">`
안의 `class Component extends DCLogic` 컨트롤러. 런타임(`support.js`)이 템플릿을 React로 렌더링.
빌드 단계 없음. 상태는 `localStorage`(`mindflow_doc_<id>`), 페이지 간 `window.location` 이동.

### 마인드맵 엔진의 위치 (핵심 자산)
`MindFlow.dc.html`의 컨트롤러 안에 렌더링과 뒤섞여 있음:
- 데이터 모델(`nodes`, `floats`, `lines`, `zones`)
- 레이아웃 알고리즘 `_layout(nodes, layoutMode)`
- 직렬화 `serializeDoc()` / `loadDoc()` / `cloneNodes()`
- undo/redo, export(PNG·Markdown·JSON)

## 목표 아키텍처
```
packages/
  mindmap-core/   # 순수 TS. DOM/React 없음. 모델·레이아웃·직렬화·undo·export
  web/            # React + Vite + TS. core 사용, SVG/Canvas 렌더 (디자인 재현). PWA
  mobile/         # (2단계) Capacitor 또는 React Native, core 재사용
  desktop/        # 설치형 PC 앱(Electron 셸) — 원격 출처를 띄우고 설치 파일만 만든다
server/           # 인증(OAuth/이메일) + DB(Postgres) + 문서 동기화 API (+ 협업시 Yjs/CRDT)
```

## 로드맵 / 단계
1. **웹 프로덕션화**: dc → React+TS+Vite 이식, `mindmap-core` 분리, 실제 인증·DB·동기화. PWA화.
2. **앱 스토어**: 빠르게=Capacitor로 PWA 래핑 / 네이티브감=React Native(UI 재작성 + core 재사용).

## 진행 현황 (ADR-0001 기준)
**상세 기록은 `docs/changelog.md`에 있습니다** — 라운드별 원인·결정·검증이 그대로
들어 있습니다. 세션마다 자동으로 읽히는 것은 **이 파일 하나**이고 그쪽은 읽히지
않습니다(한 파일이던 시절 956KB가 매번 실렸습니다 — 그래서 갈랐습니다).

필요할 때 찾아 읽습니다 — `grep -n "키워드" docs/changelog.md`. **같은 자리를 두 번
고치기 전에 한 번 찾아보세요**: "왜 이렇게 돼 있나"의 답이 대개 거기 있습니다.

### 지나온 단계
- **ADR-0001 · M0** 모노레포(pnpm+Turbo·strict TS·CI·코어 순수성 lint) + **골든 안전망**(dc 원본을 헤드리스로 캡처)
- **M1a~c 코어**: 모델·`serializeDoc`/`parseDoc`·`HistoryStack` / `layout`(radial·right·down) / 라인 큐빅 기하 — 전부 dc 원본과 좌표 parity
- **M3** React 이식: 로그인·홈·에디터(a 렌더 → f 부분 리치텍스트)
- **M4** 백엔드 포트(`AuthProvider`/`DocStore`/`SpaceStore` + Local/Supabase 어댑터·RLS·낙관적 잠금)
- **M5** 실시간 협업(Yjs/CRDT + awareness) · **M6** PWA·모바일 반응형 · **M7** Capacitor 앱셸

### 지금 있는 것
- **문서 셋**: 마인드맵 / 화이트보드(자유 배치·그리기·프레임·반응) / 칸반(보드·리스트·타임라인) / **공책**(페이지 여러 장의 글 — 블록 16종·인라인 서식·표·콜아웃·토글·이미지·문서 링크·**일정 블록**·`/` 커맨드) — 종류마다 템플릿 갤러리
- **에디터 공통**: 리치텍스트·리스트(단계별 마커)·링크·멘션(공책은 `@` 허브로 사람·날짜·페이지를 한 메뉴에서 — 날짜·페이지는 인라인 칩)·이미지(Storage — 공책은 크기 조절·원본 보기)·댓글 핀(스레드)·**본문 인라인 댓글**(공책 — 고른 글에 형광 + 우측 열의 「본문 댓글 → 페이지 댓글」)·보드 임베드(공책 본문에 칸반·맵·화이트보드의 지금 상태 — 편집은 칸반 열 이동만, 제목·경로·시각·단추는 **마우스를 얹으면** 미리보기 우측 상단에)·공책의 우측 열(**일정** — 미니 달력·시간표 / 댓글)·**인라인 칩은 한 덩어리**(캐럿이 안으로 못 들어가고 Backspace 한 번에 통째로 — 날짜·사람·페이지 셋 다. 날짜 칩은 호버·방향키로 그날 일정을 띄우고 거기서 일정 상세·새 일정을 **공책 안에서** 연다)·**손가락의 글자 선택**(두 번 눌러 고른 뒤 **우리 손잡이**로 줄을 넘는다 — OS 물방울은 편집 박스를 못 넘는다)·**표의 클립보드**(칸·행·열·구역을 TSV와 표 두 벌로 — ⌘C·⌘V, 복사한 자리에 점선 · Shift+클릭으로 넓히기 · Delete는 글만 지운다)·버전 기록·내보내기(PNG·SVG·PDF·MD·JSON)
- **홈**: 최상위 화면 둘 — 스페이스(폴더·**전역 검색** — 제목과 내용을 훑고 `어디서 걸렸는지`를 종류 칩으로 보여 준다, 공책은 그 페이지로 바로 연다 · 휴지통) · 일정(달력 — 칸반 마감은 보드마다 반영 여부를 카드 메뉴에서) · 알림 센터 · 설정(헤어라인 목록 — 프로필·계정·알림·시작 화면·버전·원형 견본 테마 6벌). **LNB는 두 칸**: 굴러가는 위 칸(오늘 묶음 알림·일정 → 스페이스 → 모아보기 아코디언) + **바닥 고정 프로필 카드**(메뉴는 위로 열린다). 피드백은 화면 우하단 **떠 있는 단추**(모달이 뜨면 비켜 선다 — `useAnyModalOpen`)
- **협업·공유**: 실시간 공동 편집, 이메일 초대 / 링크 공유(보기 전용), 댓글·멘션 알림 — 멘션은 **메일**(30분 다이제스트)과 **웹 푸시**로도 나간다(읽었으면 안 온다)
- **도구(외부 서비스 연결)**: 홈 LNB 모아보기 아래의 **도구** 구획 — Jira · Google 캘린더를 연결·해제·표시·이름 변경(LNB 도구 관리 팝오버 = 설정 › 계정 설정 › 도구, 같은 데이터). Jira를 연결하면 **작업 현황**(에픽·하위 티켓을 달력·타임라인·집계로 · 일정 맞춰보기 · 영업일 진행 일수 · 개인 휴일 설정 · 공휴일은 앱이 든 표). Jira 호출은 전부 Edge Function `jira`가 대신한다(CORS 불가 · 토큰은 서버에만 · refresh token 회전은 `version` 낙관적 잠금) — `backend/26-jira.md`
- **구글 캘린더 연동**: 읽기·쓰기·참석자·회의실·근무 위치 — 민감 스코프 **검수 통과**, refresh token은 Edge Function이 서버에 보관. 캘린더 색은 **우리 쪽에서 덮어쓴다**(구글엔 쓰기 스코프가 없다 — 보이는 색만 바뀐다) · 구글 API의 색은 **클래식 팔레트**라 들어오는 자리에서 구글 웹의 모던 색으로 바꾼다
- **일정 알림**: 앱이 떠 있을 때(웹 스케줄러) · 모바일은 OS 예약(Capacitor) · 데스크톱은 트레이 상주
- **멘션이 앱 밖으로 나가는 길 셋**: 웹 푸시(1분) · 설치형 앱 배너(창을 닫아 둬도) · 메일(30분 다이제스트) — 셋 다 **읽었으면 오지 않는다**
- **배포 채널**: 웹(PWA) · 설치형 데스크톱(Electron — Win/mac 무서명 + MSIX 자가서명) · 모바일(Capacitor 스캐폴딩)

### 최근 라운드(제목만 — 자세한 것은 changelog)
- 세션 레인 — 여러 세션의 일감을 가르는 축(질문·실측: 공책은 에디터 **안**이라 못 가른다)
- 일정 1건 — 구글 일정 색이 캘린더 색으로 떨어진다: `/colors` 팔레트를 **먼저 뜬 화면만** 받고 뒤에 켜진 화면은 `{}`로 남았다(고전 11색 밖 번호만 틀리는 이유) · 구독자에게 밀어 준다
- 공책 1건 — 손가락 선택을 **OS에게 돌려준다**: 고르는 동안만 본문 단을 편집 호스트로 승격(줄은 그대로) — 알약 툴바·줄을 넘는 선택이 살고, 편집이 오면 그 자리에서 걷어 우리 모델로 · 승격된 선택은 **브라우저가 줄 높이로** 칠한다(번호·글머리표만 끈다 — 우리 `::highlight()`는 글자 높이라 손잡이와 틈이 났다) · 선택색은 파랑 `--mf-note-sel` · PC의 우리 칠도 **줄 높이 덮개**(`drawSelLayer` — `::highlight()`는 높이를 못 바꾼다)
- 공책·홈 4건 — **내 사진은 한 원천**(`adapters/myAvatar` — 세션 사진은 구글 재로그인 때마다 구글 사진으로 덮인다 · 서버→캐시→세션 순) · 일정 블록 머리 띠 제거 · `/`의 날짜 제거 · 본문 `clig` 끔(한글 앞 `:`가 튄다)
- 홈 LNB·프로필 메뉴·설정 팝업 스펙 — 오늘 묶음(44px·마키·날짜 글리프·캐럿)·프로필 바닥 고정·피드백 떠 있는 단추·설정 헤어라인 목록(스펙 반영 + 기능 판단 9건)
- 공책 4건 — 일정 블록의 일정을 **공책 안에서** · 안내 문구는 글이 한 자도 없을 때만(`:only-child`는 글자를 안 센다) · 접기 제목에 빠진 `selecting` · `:`는 `calt`까지 꺼야 했다
- 에디터 2건 — 맵·화이트보드 캔버스 `#FCFCFB`(단색 — 첫 판의 `#F7FBF1`은 정정 · 앱 껍데기의 가라앉은 행은 옛 색) · 칸반 보드별 **일정 반영**(홈 카드 메뉴 · 내 워크스페이스의 `calendarHidden` · `calendarEntries` 한 곳에서 거른다)
- 일정 페이지 스펙 — 헤더(점 띠·월 제목이 타이틀·요약 줄)·카드 없는 전체 폭 격자(칸 면 6종·19px 날짜)·오른쪽 300px 패널(880px 미만 오버레이) · 마감 목록·통계 칩·G 단추 제거 · 칩은 종류 색 상자(스펙 반영 + 기능 판단 목록)
- 일정 1건 — 구글 캘린더 색이 구글과 다르다: API는 **언제나 클래식 팔레트**를 주고 구글 웹은 같은 번호를 모던 팔레트로 그린다 · 두 입구(`/colors`·캘린더 목록)에서 모던으로(`modernGoogleHex` · 팔레트 색은 `colorId`가 정한다)
- 공책 3건 — 접기 내용에 번호·기호(표의 칸과 같은 **글자 마커** `listBox` · 툴바 단추도 그 줄 안에 · `commitLine`이 `body`를 못 풀던 구멍) · 일정 팝업을 받아 오는 동안 스피너 · 목록 붙여넣기의 깊이는 **붙이는 자리 기준**
- 도구 · Jira 작업 현황 — LNB **도구** 구획·도구 관리 팝오버·설정 카드 · Jira OAuth(Edge Function `jira`, 0044) · 연결 시 프로젝트 선택 · 달력·타임라인·집계·일정 맞춰보기 · 개인 휴일 · 공휴일 표(한국은 음력+대체 규칙으로 직접 계산) · 필터 칩은 검색창 폭을 넘을 때만 접는다
- 공책 1건 — 접기 내용의 번호·기호까지 선택 띠가 칠해졌다: 덮개가 구간의 `getClientRects()`(마커 스팬·행 상자 포함)를 그대로 받았다 · 마커를 글자로 드는 줄(`data-list-box`)은 **글자 노드만** 훑어 사각형을 받는다(`rangeRects` — 표의 칸도 같이)

### 운영 요약 — 원문은 `docs/operations.md`(자동으로 읽히지 않는다 · 해당 일을 할 때 읽는다)
- 📌 **라이브 배포 = 머지가 아니다.** 작업 브랜치 → PR(CI `verify`) → 스쿼시 머지 → base `claude/mindflow-design-impl-iyxiol` CI → `main` fast-forward(`git push origin <base의 원격 sha>:refs/heads/main` — 로컬 동명 브랜치는 뒤처져 있을 수 있다) → **Production 승격 확인**(`GET /repos/hoyullee/mindflow/deployments?environment=Production&per_page=1`의 sha가 방금 커밋인가. 아니면 Vercel이 같은 sha의 Preview를 중복으로 봐 승격하지 않은 것 — Promote 또는 새 커밋 한 바퀴). **main 푸시는 사용자 확인 없이 한다**(2026-09-11 상시 승인 — 거둬 달라는 요청이 오면 이 줄을 고친다). 완료 지점은 라이브다. 문서만 고친 PR은 main 푸시가 필요 없다.
- 📌 **같은 브랜치에서 PR을 이어 낼 때**: base를 merge하지 말고 `git checkout -B <branch> origin/<base>` 뒤 미랜딩 커밋만 cherry-pick(스쿼시 머지라 merge는 없던 충돌을 만든다). PR이 `mergeable: false`면 CI가 아예 안 돈다. base가 같은 기능의 다른 세션 판을 담고 있으면 더 나아간 판을 고르고, 자동 병합이 두 판을 동시에 import하지 않았는지 눈으로 본다.
- 📌 **무엇을 배포하나**: `apps/desktop/`(preload·main·shell·electron-builder.yml·version)을 고쳤으면 **새 설치본**, 그 밖은 **웹 배포**(셸은 원격 출처를 띄울 뿐 — 화면·알림 규칙·타이틀 바 생김새는 웹). 새 preload 창구는 새 설치본이고 웹은 그 창구가 없는 옛 셸을 견뎌야 한다(`DesktopBridge` 신규 멤버는 선택 필드, 폴백은 "안 한다" 쪽 — 예: `titleBarHeight` 폴백 0). `supabase/` 마이그레이션은 main 머지에 자동 적용, **Edge Function은 손으로** `supabase functions deploy`.
- 📌 **배포 확인 함정**: 이 원격 세션은 `vercel.com`·`*.vercel.app`·`geurio.com`에 닿지 못한다 — 라이브는 사용자에게 확인을 부탁하고(설정 › 버전 확인의 sha), 간접 신호(Vercel 상태·체크런)는 수십 분 늦을 수 있으니 **침묵을 "안 됐다"로 쓰지 않는다**. `combined: pending`은 상태 0건의 기본값. CI 확인은 PR = `/commits/<sha>/check-runs`(잡 `verify`), base push = `/actions/runs?branch=<base>`에서 `head_sha` 대조(`head_sha=` 필터는 갓 만든 커밋에 안 맞고, 목록의 `name`은 워크플로 이름 `CI`다).
- 📌 **CI가 도는 곳은 둘뿐**: `pull_request` + base push(작업 브랜치 push·main은 돌지 않는다 — PR을 열면 돈다, 수동은 `workflow_dispatch`). `concurrency` 취소, 잡은 하나. **시계 의존 테스트 주의**: "같은 날인가"는 오늘 09:00 앵커로, 구간은 `spanInMonth(len)`/`nextDay()`로(달 길이·달의 며칠째에 따라 갈린다).
- 📌 **세션을 여럿 돌릴 때 레인**: ① 에디터+공책(`features/editor/` — 공책은 같은 폴더라 **못 가른다**) ② 일정(`features/home/calendar/`·`features/reminders/` — 공책이 38군데 빌려 쓰므로 공개 시그니처 변경은 한 세션이 양쪽을) ③ 홈·설정·auth ④ 셸·인프라·docs. 레인과 무관하게 **직렬**: main fast-forward · `supabase/` 마이그레이션 · `CLAUDE.md`/`docs/changelog.md` 머지 순서.
- 🧰 **운영 백로그(순서대로)**: ① 저장소 비공개 전환(사용자 직접 — Actions 월 2,000분·secret scanning 상실) ② gitleaks ③ pg_dump 주기 백업 + Storage(무료 플랜은 백업·PITR 없음 · 시작하면 개인정보처리방침 §3 한 줄) ④ LICENSE 결정 ⑤ Vercel Hobby 비상업 조항 ⑥ 한도 감시(Realtime 메시지·egress) ⑦ Jira 개인정보 보고(`jira-privacy` 주 2회 cron — Sharing + 개인정보 Yes의 의무 · 실패 로그만 가끔 본다). 백업은 반드시 비공개 전환 **뒤**(공개 저장소 아티팩트 = 유출).
- 📦 **Microsoft Store 제출**: 코드는 준비 끝(MSIX 로컬 설치 확인). 남은 것은 Partner Center 계정·이름 예약 → `electron-builder.yml` `appx` 세 값 교체 → `CSC_LINK` 없이 `pnpm pack:appx` → 등록 정보 + **심사자용 메모(테스트 계정)**. 등록·재제출 무료.
- 📌 **공책에 남겨 둔 것(의도적)**: **실시간 공동 편집을 붙이지 않았다**(사용자 결정) — 그래서 코어가 페이지·블록 순서를 **배열**로 든다(칸반의 `pos` 분수 인덱스는 끊긴 두 사람의 병합을 위한 것이다). 붙이려면 **순서 모델부터 다시 정해야** 한다. 그 밖: 토글 안에 여러 블록 중첩(지금은 머리 + 본문 한 줄), 페이지 단위 댓글(지금은 공책 한 권 단위).
- ⏭️ **다음 후보**: (낮음) 홈 카드 목록 전면 가상화 — content-visibility로 부족해질 때(스페이스당 수백 맵 규모), 메인 그리드+검색 결과 한 세트 / 실기기 빌드·서명·스토어 제출은 로컬 툴체인 필요 / 확인 대기: 모바일 로컬 알림 실기기 5단계(`apps/mobile/README.md`) · 데스크톱 트레이 상주 실기기(Windows·macOS — `apps/desktop/README.md`) · 안드로이드 "안전하지 않은 앱 차단됨"(Play Protect — `chrome://webapks`)


## 규칙 (에이전트·사람 공통)
- `support.js`와 `*.dc.html`(디자인 원본)은 **변경하지 않는다.** 이식은 새 `packages/`에서 진행.
- 새 코드는 **TypeScript** 우선. 코어는 프레임워크·DOM 의존 없이 순수 로직으로.
- 비자명한 변경은 **테스트로 동작을 검증**한 뒤 커밋. 로컬은 정적 서버(`python3 -m http.server`)로 확인.
- **실브라우저·하네스로 검증하기 전에 `docs/probe-pitfalls.md`를 훑는다** — 검증이 실패하면
  앱을 의심하기 전에 프로브를 의심한다(그 목록의 절반은 앱이 결백했던 사건이고, 셋은
  재발했다). 그 문서는 **색인**(증상 표·체크리스트)이고 사건 원문은 `docs/probe-pitfalls-detail.md` —
  걸리는 항목만 읽는다. 새 함정은 상세에 항목을 더하고 색인 표에 한 줄을 더한다.
- **로컬 검증은 손댄 영역만**(요청) — 전체 스위트는 2,100건이 넘어 한 번 돌리는 데 2분이 넘는다.
  손댄 파일과 그 소비처의 테스트 파일만 지정해 돌리고(`npx vitest run <파일|디렉터리>`), 여기에
  루트 `pnpm lint`·`pnpm typecheck`(둘은 전체를 보지만 빠르다)와 프로브용 `vite build`를 더한다.
  **전 영역 회귀는 CI(`verify`)가 본다** — PR을 열면 그것이 전체를 돌리는 자리이므로, 로컬에서
  같은 일을 되풀이하지 않는다. 다만 코어(`packages/mindmap-core`)나 여러 화면이 함께 쓰는 부품
  (`components/`·`theme.ts`·`chrome.ts` 등)을 건드렸으면 그 파급 범위까지 지정해 돌린다.
- **작업을 마치면 `docs/changelog.md` 끝에 한 항목을 더한다**(원인·결정·검증·트레이드오프).
  그 파일은 1.5MB가 넘는다 — **통째로 Read하지 말고** `grep`으로 찾고 `cat >>`로 덧붙인다.
  `CLAUDE.md`는 **규칙·아키텍처·「지금 있는 것」이 바뀔 때만** 고친다 — 라운드 기록을 여기에
  쌓으면 그만큼 매 세션의 컨텍스트를 먹는다(956KB까지 자랐다가 가른 이력이 있다).
  「최근 라운드」 목록은 제목만 **12줄 안쪽**으로 유지한다(넘치면 오래된 것부터 지운다 — changelog에 있다).
  배포·CI·운영 절차가 바뀌면 `docs/operations.md`(원문)와 여기 「운영 요약」을 함께 고친다.
- 브랜치 접두사 `claude/`. 코드는 PR로만 들어간다 — `main`에는 새 커밋을 쓰지 않고 「운영 요약」의 fast-forward만 한다.
- `mindmap-core`는 순수 TS(DOM/React/canvas 금지, lint 강제). 노드 크기는 `sizeOf` 주입.
- 커밋/PR에 모델 식별자·비밀정보를 넣지 않는다.

## 로컬 실행
```bash
python3 -m http.server 8000   # http://localhost:8000/
```
`file://` 직접 열기는 동작하지 않음(형제 파일 fetch 필요).

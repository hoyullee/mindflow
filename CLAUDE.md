# MindFlow — 프로젝트 컨텍스트 (팀 공용)

이 문서는 사람과 Claude 에이전트가 **공유하는 단일 컨텍스트**입니다. 새 세션·새 에이전트는
작업 전 이 파일을 먼저 읽습니다.

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
server/           # 인증(OAuth/이메일) + DB(Postgres) + 문서 동기화 API (+ 협업시 Yjs/CRDT)
```

## 로드맵 / 단계
1. **웹 프로덕션화**: dc → React+TS+Vite 이식, `mindmap-core` 분리, 실제 인증·DB·동기화. PWA화.
2. **앱 스토어**: 빠르게=Capacitor로 PWA 래핑 / 네이티브감=React Native(UI 재작성 + core 재사용).

## 진행 현황 (ADR-0001 기준)
- ✅ **ADR-0001** 아키텍처 결정 (`docs/architecture/0001-architecture.md`)
- ✅ **M0** 모노레포 스캐폴딩 (pnpm+Turbo, strict TS, CI, 코어 순수성 lint)
- ✅ **골든 안전망** (`packages/mindmap-core/test/fixtures/`) — dc 원본을 헤드리스로 캡처. serialize/outline/layout 좌표/node-sizes
- ✅ **M1a** 코어: 모델·`serializeDoc`/`parseDoc`/`cloneNodes`·`toMarkdown`·`HistoryStack` (골든 parity, QA 감사 반영)
- ✅ **M1b** 코어: `layout(doc, mode, sizeOf, opts?)` — `_layout` radial/right/down 이식, 좌표 parity. `_rootAnchor`→opts 승격
- ✅ **M1c** 코어: `resolveLineGeometry`/`cubicAt`/`portPoint` (라인 큐빅 기하, 원본 `lineCPs` parity)
- ✅ **M3-Login/Home** React 이식 (`apps/web`, react-router). localStorage 키는 원본과 호환
- ✅ **M3-Editor-a** 렌더 기반: 코어(`layout`/`serialize`/`geometry`) 소비, 캔버스·노드·커넥터·테마 렌더. 원본과 렌더 parity 확인
- ✅ **M3-Editor-b** 인터랙션: 선택·편집·추가/삭제·드래그·속성패널·저장(자동)·undo/redo(코어 `HistoryStack`)·내보내기(코어 `toMarkdown`)
- ✅ **M3-Editor-c** 완성도: marquee 다중선택(일괄 스타일)·미니맵·아웃라인 편집·드래그 재부모화
- ✅ **M4** 백엔드: `AuthProvider`/`DocStore`/`SpaceStore` 포트 + Local/Supabase 어댑터 + 팩토리(env-게이트). Supabase 마이그레이션·RLS(`supabase/migrations/` + 루트 `supabase/config.toml`, GitHub 연동 자동배포), 문서 `server/supabase/docs/backend.md`, 낙관적 잠금. 스페이스/폴더는 사용자별 `workspaces` 테이블(다기기 동기화). **env 없으면 로컬/데모 폴백**(앱 안 깨짐)
- ✅ **M6** PWA + 모바일 반응형: `vite-plugin-pwa`(Workbox, 오프라인 앱셸), manifest·아이콘·Pretendard self-host. 768px 브레이크포인트 — Home 드로어, Editor 속성패널 바텀시트, 44px 터치타겟
- ✅ **M5** 실시간 협업(Yjs/CRDT): 코어 `crdt/` Doc↔Y.Doc 바인딩(순수, 충돌 없는 수렴) + 웹 전송 포트(BroadcastChannel 로컬 다중탭 / Supabase Realtime / Noop) + `useYjsDocSync` 에디터 통합. env-게이트, 단일 사용자 무회귀
- ✅ **M7** Capacitor 앱셸(`apps/mobile`): android/·ios/ 스캐폴딩, `capacitor.config`(webDir=web dist), `build:mobile`(web build→cap sync), 네이티브 브리지(Share/Filesystem·StatusBar·Keyboard, 웹 폴백). **실기기 빌드·서명·스토어 제출은 로컬 Android Studio/Xcode 필요**(`apps/mobile/README.md`)
- ✅ **M5-awareness** 협업 커서/선택 공유(`y-protocols` Awareness, 웹 전용): `CollabProvider.getAwareness()` + BroadcastChannel/Supabase Realtime 릴레이(에코 방지 origin 필터, 기존 M5 채널 재사용·신규 스키마 불필요) + `usePresence` 훅(정체성=인증 이메일 또는 clientID, 색·이름 시드 결정적, 커서 50ms 스로틀). 에디터 UI: 팬/줌 변환 안의 원격 커서·이름표(`PresenceLayer`), 노드/플로트/라인/존 원격 선택 하이라이트(피어 색), 우상단 접속자 아바타(`PresenceBar`). 단일 사용자 무회귀(peers=[] → null). 실브라우저 2-탭 검증 완료
- ✅ **M3-Editor-d(컨텍스트 메뉴)** 우클릭 메뉴(`ContextMenu.tsx`, 원본 `ctxMenu`/`ctxSub` 이식): 히트테스트 후 대상 선택→종류별 메뉴(node=하위/형제·텍스트 정렬▸ 플라이아웃·삭제 / zone=이름편집·삭제 / float·line=삭제 / multi=삭제(N개) / bg=도형·메모·선·영역 추가, 클릭 좌표에 생성). 뷰포트 clamp·플라이아웃 flip·바깥클릭/Esc/실행후 닫힘. `setTextAlign`(대량 노드 필드 세터) 신설, `add*At`에 `at?:{x,y}` 옵션 추가. **버그 수정**: 메뉴가 `.mf-ed-vp`(배경 드래그 소유) 자식이라 버튼이 `mousedown`만 stop→실제 클릭의 `pointerdown`이 배경 마퀴 드래그를 띄우고 무이동 `pointerup`이 선택 해제 →2단계 정렬 플라이아웃이 대상 상실. 메뉴 루트에서 `pointerdown` stop으로 해결(정렬 테스트를 full 클릭 시퀀스로 강화해 회귀 가드). 실브라우저 검증 완료
- ✅ **M3-Editor-e(라인 앵커 마그넷)** 라인 끝점→노드/플로트 포트 스냅·앵커(원본 `findSnap`/`resolveEnd`/`resolveLine`/`lineTargetBox`/`borderPoint` 이식). 코어: `LineAnchor{kind,id,side?}` + `Line.a1/a2`(순수 추가, 직렬화 라운드트립·골든 무회귀), `findLineSnap`(SNAP=34)·`resolveLineEndpoints`·`borderPoint`(박스 조회 주입식, 순수성 유지). 웹: `line-end` 드래그가 매 이동 `findLineSnap`으로 스냅→`a{which}` 커밋, 앵커 라인은 렌더/히트/마퀴/PNG에서 `resolveLineEndpoints`로 해석해 노드 이동 시 자동 추종, 빈 곳 드롭 시 detach. 렌더: 앵커 끝점 마그넷 dot + 드래그 중 대상 박스 4포트 인디케이터(스냅 side 강조). **버그 수정**: geomRef는 post-commit useEffect에서만 갱신 → 앵커 마그넷이 한 프레임 지연 → 렌더타임용 `*Live`(현재 render의 geom/doc 클로저) 변형 분리. 실브라우저 검증(스냅·추종·detach) 완료
- ✅ **M3-Editor-f(부분 리치텍스트)** 노드 텍스트 일부만 굵게/색상(원본 `applyPartial`/`domToRuns`/`runsToHtml`/`linearize`/`commitRichEdit` 이식). 코어: `richtext.ts`—`applyPartialStyle(src,s0,s1,kind,val)`·`stripRichStyle`·`runsToChars`/`charsToRuns`(순수 char-model, DOM 없음, 골든 무회귀). 웹: `NodeEditBox`를 contentEditable로 교체(`runsToHtml` 시드·IME 가드·Enter/Shift+Enter/Escape), `richtextDom.ts`(escHtml/rgbToHex/runsToHtml/domToRuns/linearize/setLinearSelection), 선택 시 뜨는 `TextToolbar`(B·색 스와치·지우기)→`linearize`로 offset→코어 변환→innerHTML 갱신·선택 복원, `commitNodeRichText`(플레인이면 rich=null), 전체 bold 토글 시 `stripRichStyle`로 부분 bold 정리. **인터랙션 함정 3종 방지**: 툴바 루트 `pointerdown` stop(배경 마퀴 누수 차단), 버튼 `mousedown` preventDefault(편집 blur·선택 소실 방지=원본 `_tctxHold` 역할), 테스트 full 클릭 시퀀스. 실브라우저 검증(부분 bold·색·지우기·plain→rich=null) 완료
- ✅ **M7-assets(네이티브 아이콘/스플래시)** MindFlow 마크(코럴 둥근사각+흰 M)를 `apps/mobile/scripts/generate-native-assets.mjs`(M6 `markSvg` 재사용, `sharp`, 결정적·외부애셋/네트워크 없음)로 전 해상도 생성·설치: Android adaptive(배경색 코럴 + 흰 M 투명 전경 5종)·legacy `ic_launcher`/`_round` 5종·스플래시(기존 치수 유지 11종), iOS `AppIcon-512@2x`(1024 full-bleed)·`Splash.imageset` 3종. `@capacitor/splash-screen` 추가(config `launchAutoHide:false`) + `nativeShell`에서 `SplashScreen.hide()`(웹 no-op 폴백). 기본 Capacitor placeholder 교체 완료, 생성 자산 직접 확인. **실기기 빌드·서명·스토어 제출은 여전히 로컬 Android Studio/Xcode 필요**(`apps/mobile/README.md`)
- ✅ **회원 탈퇴** 프로필 팝오버에 `설정` 진입점 추가 → `AccountSettingsModal`(계정 정보 + `위험 구역`의 회원 탈퇴) → `DeleteAccountModal`(비가역 경고·삭제 항목 명시·`탈퇴` 문구 타이핑 게이트로 파괴 버튼 arming). 포트 `AuthProvider.deleteAccount()` 신설: Supabase는 `delete_account()` SECURITY DEFINER RPC(`supabase/migrations/0005_delete_account.sql`, 본인 `auth.users` 삭제→`on delete cascade`로 documents/workspaces/profiles 동반 삭제) 후 signOut / Local·데모는 `mf_`·`mindflow_` 네임스페이스 저장소 전체 wipe. 컨트롤러는 성공 시 로컬 캐시도 정리하고 `/login`으로 replace, 실패 시 다이얼로그에 에러 노출·재시도 유지. 유닛(문구 게이트·삭제 후 저장소 clear+`/login`) + 실브라우저 전체 흐름 검증 완료
- ✅ **GIS 직접 연동 + 법적 문서** 구글 동의 화면의 `<ref>.supabase.co` 표시 제거: 로그인 페이지가 GIS 공식 버튼을 우리 origin에서 렌더 → ID 토큰을 신설 포트 `AuthProvider.signInWithIdToken`으로 교환(`GoogleSignInButton.tsx`/`googleIdentity.ts`, nonce=원본↔SHA-256 쌍). `VITE_GOOGLE_CLIENT_ID` 미설정·데모 모드·스크립트 차단 시 기존 리다이렉트 버튼 폴백(실브라우저로 차단 환경 degradation 검증). 공개 라우트 `/privacy`·`/terms`(RequireAuth 밖, 로그인 푸터 링크) + 브랜드 인증용 120×120 로고(`/brand/geurio-logo-120.png`). 콘솔 절차는 `backend.md` §1d
- ✅ **브랜드 마크 리디자인** 문자 "G" → 흰 모노라인 **소용돌이**(중심 점으로 감기는 세 호, 사용자 선정안). 지오메트리 3곳 동기화: `src/components/BrandMark.tsx`(앱 내: 로그인 BrandPanel·에디터 툴바·법적 문서 헤더) + `generate-icons.mjs`(원본) + 모바일 `generate-native-assets.mjs`. PWA·파비콘·브랜드 120·Android adaptive/legacy/스플래시·iOS 아이콘/스플래시 전부 재생성
- ✅ **이미지 첨부 ①(캔버스 이미지 플로트)** `Float.img`(데이터 URL, post-dc 순수 추가 — 직렬화/CRDT 제네릭 통과, 골든 무회귀). 저장 전략=문서 인라인: `imageAttach.ts`가 첨부 시 다운스케일(긴변 1024, PNG는 투명 보존·그 외 JPEG q.85, 초과 시 재압축). 진입 3종: 삽입 메뉴·배경 우클릭 "이미지 추가"(파일 선택), 클립보드 붙여넣기(텍스트 입력 중 제외), 캔버스 드롭(드롭 지점). 렌더=FloatLayer 이미지 분기(접기토글/편집 없음), 리사이즈 비율 고정, 속성패널 이미지 전용, PNG 내보내기 async 프리디코드 후 drawImage. 실브라우저 전 시나리오(삽입·드래그·리사이즈·영속·리로드·드롭·삭제·내보내기) 검증
- ✅ **이미지 첨부 ②(노드 이미지)** `Node.img/imgW/imgH`(항상 세트, post-dc 순수 추가) — 표시 크기는 첨부 시 긴변 180px 비율 고정. `computeMetrics`가 `imgW+패딩`/`imgH+8`만큼 박스를 키워 **레이아웃 자동 반영**(sizeOf 주입 경로 그대로). 렌더=NodeLayer 세로 스택(썸네일 위·이모지/텍스트 아래), 진입=노드 우클릭 "이미지 추가/변경/제거"(`setNodeImage`/`clearNodeImage` — clear는 키 삭제로 CRDT 필드 제거), PNG 내보내기 노드 프리디코드+동일 스택 재현. 실브라우저 검증(추가→박스확장→영속→제거→복원→내보내기 픽셀 일치)
- ✅ **새 버전 적용 게이트** 기존엔 새 배포가 잡히면 **모든 화면**(랜딩·약관·로그인·홈·에디터)에 똑같이 "새 버전이 준비됐어요" 토스트가 떴다. 토스트의 근거는 "에디터가 열린 채 리로드되면 편집이 끊긴다" 하나뿐인데 잃을 게 없는 화면까지 묻고 있던 것. `pwa/updateGate.ts` 신설 — 경로가 아니라 **화면이 자기 상태로 위험도를 신고**(`useUpdateGuard`, 같은 화면도 상태별로 다름): `safe`(랜딩·약관·손대지 않은 로그인 폼)=즉시 조용히 적용 / `defer`(홈·유휴 에디터)=탭이 백그라운드일 때만 적용 / `block`(입력·편집 중)=토스트만. 판정은 순수 함수로 분리(`auth/updateRisk.ts`—입력 시작·인증 코드 단계, `home/updateRisk.ts`—팝업·확인창·검색어·진행 중 작업). 적용 전 `prepare()`가 돌아 미저장 변경을 먼저 저장하고(에디터 `flushSave` 신설: 자동저장 flush 후 **실제 저장됐는지** 반환), 저장 실패 시 리로드를 멈추고 토스트에 알린다(로컬 복구본은 저장 성공 시에만 갱신되므로 그냥 리로드하면 유실). **탭 간 조율**: 한 탭이 적용하면 `skipWaiting`→`controlling`으로 **다른 탭까지 리로드**된다(vite-plugin-pwa register.js) → 자동 적용 전 BroadcastChannel로 피어에 질의, 편집 중인 탭이 있으면 미루고 20초 주기로 재시도(수동 클릭은 본인 선택이므로 질의 없음). 실브라우저 검증 7종(실제 SW 업데이트 사이클: safe 무토스트 자동적용 / block 토스트·무리로드·입력보존 / 수동 클릭 적용 / defer 가시=토스트 / defer 숨김=조용히 적용 / 편집 탭 있을 때 옆 탭 미룸 / 그 탭 닫히면 재시도 적용)
- ✅ **문서 공유(0009) + 실제 공동 편집 수리** 랜딩에 "실시간 공동 편집"이라 써 뒀지만 `documents`가 소유자 전용이라 **남과는 애초에 불가능**했다(M5/M5-awareness는 같은 사람의 여러 탭까지만). 공유: `document_shares`(이메일 초대 — 클라이언트는 `auth.users`를 못 읽고, 미가입자도 초대 가능) + `documents` SELECT/UPDATE 정책 확장 + 정책 재귀를 끊는 `owns_document()`/`shared_with_me()` SECURITY DEFINER + `ShareStore` 포트(Supabase/Local) + 에디터 `ShareModal` + 홈 LNB "공유받은 맵" 구획.
  **배포 후 제보 3건과 그 원인**: ① 공유받은 맵이 본문 상단을 크게 차지 → LNB 접이식 항목으로 이동(`sharedItems`/`sharedOpen`, 즐겨찾기·휴지통과 같은 꼴, 공유받은 게 없으면 구획 자체가 없음, 모바일 44px). ② **편집·접속자·커서가 한꺼번에 오지 않음** → 진짜 원인은 `private: true` 채널이 아니라 **반쪽 동기화**였다: 합류할 때 sync-request만 보내고 **자기 전체 상태는 보내지 않아서**, 각자 자기 Y.Doc을 따로 심은 두 피어의 연산 이력이 어긋나 이후 업데이트가 상대에서 **보류**됐다(부분 적용된 노드로 `children`이 undefined가 되어 상대 캔버스가 통째로 비는 것까지 실브라우저로 재현 — 기존 테스트는 원격 피어를 **빈** Y.Doc으로 만들어 이 경우를 못 잡았다). 수리: 두 전송 모두 합류 시 전체 상태를 **양방향 교환**, `yDocToDoc`이 부분 병합 상태를 **유효한 Doc으로 정규화**(필드 기본값·없는 자식 id 제거)하고 순서 배열의 중복 id를 하나로 읽음(메모가 두 개로 늘던 문제). 덧붙여 `useYjsDocSync`는 **초기 로드 전엔 붙지 않는다**(공유받은 맵을 처음 여는 기기의 빈 자리표시자가 상대 문서와 병합되는 것 차단), Supabase 전송은 private 거부 시 공개 채널로 폴백하되 `broadcast.ack`로 **발신 권한까지 확인**하고 상태를 `CollabStatus`로 올려 보내 `PresenceBar`가 "실시간 연결 끊김"/보안 경고를 표시한다(조용히 죽지 않게 — 이 사건의 핵심 교훈). ③ 초대받지 않은 계정이 URL을 열면 편집만 막힌 채 툴바·메뉴가 다 보였다 → 에디터 대신 크롬 없는 전용 화면(`MapUnavailable`). 실브라우저 검증: 2탭 양방향 편집·메모 이동·중복 없음·리로드 영속, LNB 구획(데스크톱/모바일 드로어)·열기, 전용 화면(캔버스·공유·내보내기 전무 + 저장 흔적 없음), 단독 사용 무회귀
- ✅ **협업 전송 강화(실계정 테스트 후속 3건, #226/#228/#229)** 두 계정 실사용에서 나온 제보를 차례로 수리. ① `edgeStyle`이 CRDT meta에서 빠져 연결선 스타일 변경이 상대에게 안 갔고 수신 측 로컬 미러도 갱신 안 됨 → 바인딩에 추가(옵션 필드, 골든 무회귀) + 원격 문서 도착 시 미러 갱신. 커서 이름표는 이메일 → **프로필명**(`useProfileName`: 로컬 캐시→공급자 이름→이메일 로컬파트→`profiles.display_name` 대조, 색은 이메일 시드 유지). ② **인증 레이스**: private 구독 전 `realtime.setAuth()`를 await하지 않아 한 탭만 공개 채널로 폴백 → 같은 이름이라도 private/public 채널은 메시지가 안 오가서 협업이 조용히 죽음("한 명만 경고 없음 + 동시 편집 불가"). await + 세대 카운터 + private 1회 재시도 + ack 강등 사유를 명시적 'error'로 축소(10초 지연 제거, 확인 타임아웃 4초). 콘솔에 `[geurio] build <시각>` 스탬프(PWA가 에디터 열림 중 업데이트를 미뤄 이전 번들 테스트 혼선 방지). ③ **유실 자가 치유**: join 밖 send가 REST로 우회되고(콘솔 스팸) 수신은 멎어 상대 메시지를 영영 유실 — awareness는 절대 상태라 복구되지만 Yjs는 증분이라 이후 업데이트가 전부 보류("커서는 보이는데 편집만 안 옴"). 15초 주기 상태 벡터(`ysv`) 방송→빠진 연산만 diff 응답(삭제는 delete set 경로), 합류/재합류도 SV 기반 diff 교환(전체 상태 반복 전송 제거), join 밖 send 중단. **운영 절차 교정**: `realtime.messages` 정책 수동 적용은 0009의 do 블록이 아니라 **create policy 두 개만** SQL Editor에서 실행(alter는 42501, 예외 가드가 가짜 성공을 만듦 — `backend.md` §6, 실 프로젝트 검증)
- ✅ **Realtime 사용량 절감(#231, 실기기 확정)** 하루 테스트로 무료 한도의 4%(86K건)를 소모 → 지배 항목 둘을 조임: ① 혼자 열어 둔 탭은 15초 치유 신호(ysv)를 보내지 않음(awareness 피어 없으면 skip — 탭당 하루 ~5,700건이던 유휴 낭비 제거, 체감 0) ② 커서 스로틀 50→100ms(커서 트래픽 절반). 두 계정 **실기기 테스트로 커서 자연스러움 확인 후 확정**. 부산물: y-protocols Awareness 생성자 기본 상태({})는 clock 0이라 상대에게 적용되지 않음 — 실앱은 usePresence가 정체성을 심어(clock≥1) 무관, provider 단독 테스트만 같은 순서로 교정. 협업 전체 흐름(편집·커서·연결선 스타일·프로필명·자가 치유)이 실기기 2계정에서 정상 확인됨
- ✅ **랜딩 리뉴얼(Claude Design 이식)** 인트로 페이지를 새 디자인으로 재구현(원본 `Geurio 랜딩 리뉴얼.dc.html` 루트 보존 — 수정 금지 대상). 쌍둥이 구조 유지: `public/landing.html`(크롤러용 무스크립트 정적 — 히어로 데모는 완성 상태 SVG 한 장, FAQ는 `<details>`) + `Landing.tsx`+`landing.css`(React — dc 원본의 인터랙티브 데모 이식: 480ms 간격 rev 1→7 등장 애니메이션·가지 토글·"처음부터" 리셋·ResizeObserver 축소 스케일(640×420 고정 좌표계), FAQ 단일 열림 아코디언 grid-rows 트랜지션, 스타일은 `.lp-root` 스코프로 충돌 차단). JetBrains Mono 라틴 서브셋 self-host(`public/fonts/jetbrains-mono/`), 로고는 export 추출본이 기존 브랜드 PNG와 바이트 동일해 재사용. SEO head(canonical·OG·JSON-LD·한글 title)와 브랜드 인증 3요소 계약(기존 테스트) 무변경 통과, CTA 세션 인지(/login↔/home) 유지. 실브라우저 검증(정적/React × 데스크톱/모바일 — 데모 자람·토글·리셋·FAQ·앵커 이동·가로 스크롤 없음)
- ⏭️ **다음 후보**: 실기기 빌드·서명·스토어 제출 (로컬 툴체인 필요 — 원격 코드 작업 소진)

> **로드맵 1·2단계 완료**: 웹 프로덕션화(코어 분리·React·인증/DB) + PWA/모바일 웹 + 실시간 다중편집 + 앱스토어 래핑(Capacitor). 라이브 백엔드/실기기 배포는 키·툴체인 설정 후 로컬에서.

> **M3 완결 + M4**: 로그인 → 홈 → 에디터 전부 React로 동작, `mindmap-core` 소비. 인증·문서 저장은 포트 추상화(Local/Supabase). 실 Supabase는 키 설정 시 활성(미설정 시 localStorage 데모).

> `mindmap-core`는 순수 TS(DOM/React/canvas 금지, lint 강제). 노드 크기는 `sizeOf` 주입.

## 규칙 (에이전트·사람 공통)
- `support.js`와 `*.dc.html`(디자인 원본)은 **변경하지 않는다.** 이식은 새 `packages/`에서 진행.
- 새 코드는 **TypeScript** 우선. 코어는 프레임워크·DOM 의존 없이 순수 로직으로.
- 비자명한 변경은 **테스트로 동작을 검증**한 뒤 커밋. 로컬은 정적 서버(`python3 -m http.server`)로 확인.
- 브랜치 접두사 `claude/`. main 직접 푸시 금지, PR로.
- 커밋/PR에 모델 식별자·비밀정보를 넣지 않는다.

## 로컬 실행
```bash
python3 -m http.server 8000   # http://localhost:8000/
```
`file://` 직접 열기는 동작하지 않음(형제 파일 fetch 필요).

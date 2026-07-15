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
- ✅ **M4** 백엔드: `AuthProvider`/`DocStore` 포트 + Local/Supabase 어댑터 + 팩토리(env-게이트). Supabase 스키마·RLS(`server/supabase/`), 낙관적 잠금. **env 없으면 로컬/데모 폴백**(앱 안 깨짐). 라이브는 `server/supabase/docs/backend.md`대로 프로비저닝 필요
- ✅ **M6** PWA + 모바일 반응형: `vite-plugin-pwa`(Workbox, 오프라인 앱셸), manifest·아이콘·Pretendard self-host. 768px 브레이크포인트 — Home 드로어, Editor 속성패널 바텀시트, 44px 터치타겟
- ✅ **M5** 실시간 협업(Yjs/CRDT): 코어 `crdt/` Doc↔Y.Doc 바인딩(순수, 충돌 없는 수렴) + 웹 전송 포트(BroadcastChannel 로컬 다중탭 / Supabase Realtime / Noop) + `useYjsDocSync` 에디터 통합. env-게이트, 단일 사용자 무회귀
- ✅ **M7** Capacitor 앱셸(`apps/mobile`): android/·ios/ 스캐폴딩, `capacitor.config`(webDir=web dist), `build:mobile`(web build→cap sync), 네이티브 브리지(Share/Filesystem·StatusBar·Keyboard, 웹 폴백). **실기기 빌드·서명·스토어 제출은 로컬 Android Studio/Xcode 필요**(`apps/mobile/README.md`)
- ✅ **M5-awareness** 협업 커서/선택 공유(`y-protocols` Awareness, 웹 전용): `CollabProvider.getAwareness()` + BroadcastChannel/Supabase Realtime 릴레이(에코 방지 origin 필터, 기존 M5 채널 재사용·신규 스키마 불필요) + `usePresence` 훅(정체성=인증 이메일 또는 clientID, 색·이름 시드 결정적, 커서 50ms 스로틀). 에디터 UI: 팬/줌 변환 안의 원격 커서·이름표(`PresenceLayer`), 노드/플로트/라인/존 원격 선택 하이라이트(피어 색), 우상단 접속자 아바타(`PresenceBar`). 단일 사용자 무회귀(peers=[] → null). 실브라우저 2-탭 검증 완료
- ⏭️ **다음 후보**: 실기기 빌드·스토어 제출, Editor 잔여(컨텍스트메뉴·부분 리치텍스트·라인 앵커 마그넷), 아이콘/스플래시 네이티브 생성

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

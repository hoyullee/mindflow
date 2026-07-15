# ADR-0001: MindFlow 프로덕션 아키텍처 최종 결정

- **상태**: Accepted (Lead Architect 결정, 2026-07-15)
- **결정자**: 리드 아키텍트
- **입력**: 3개 독립 제안(speed/native/longterm), 평가 스코어보드, dc 프로토타입 현황 브리핑
- **적용 범위**: `packages/`·`apps/`·`server/` 전체. 원본 `*.dc.html`/`support.js`는 읽기전용 레퍼런스로 보존(수정 금지 원칙 유지).

---

## 1. 결정 요약과 근거

### 1.1 채택 결정

**기본 방향 = `speed`(속도 우선) 제안을 채택한다.** 스코어보드에서 speed(30/50)가 native(29)·longterm(29)를 앞섰고, 특히 **제품 목표(웹→모바일웹→앱)를 코드 1벌로 최단 경로 커버**한다는 점에서 우리의 핵심 제약("마인드맵 코어를 플랫폼 독립으로 재사용")과 정면으로 일치하기 때문이다.

그러나 speed 제안은 평가에서 **일정 낙관·리스크 반영 부족(저리스크 5/10)**과 **장기 유지보수 관점의 스키마 규율 부재**를 지적받았다. 따라서 speed를 뼈대로 삼되, 아래 표처럼 다른 두 제안의 검증된 아이디어를 **명시적으로 접목**한다(맹목적 채택 금지).

| 축 | 최종 결정 | 출처 | 비고 |
|---|---|---|---|
| 모노레포 | pnpm workspaces + Turborepo + TS project references | speed + longterm | project refs·경계 lint는 longterm에서 접목 |
| 웹 프레임워크 | React 18 + Vite + TypeScript(strict) | 3안 공통 | 이견 없음 |
| 상태관리 | Zustand + Immer, **문서/UI 2계층 분리** | speed + longterm | "문서=코어 소유, UI=별개 슬라이스" 경계는 longterm 채택 |
| 렌더링 | SVG + absolute DOM 오버레이(원본 그대로) + **`MindmapRenderer` 인터페이스** | speed + longterm | 렌더러 교체 경로는 longterm 채택 |
| 코어 | `mindmap-core` 순수 TS + 포트 주입 | 3안 공통 | |
| **스키마** | v1 파서는 원본 관대 병합 **동결**, 내부 `DocV2` 통합 + **`migrate()` 레지스트리** | longterm | speed는 스키마 규율 약함 → longterm 접목 |
| 제스처 | **`interaction-core` 순수 의도 상태머신** + Pointer Events 어댑터 | native | 어차피 신규 작성 → 플랫폼 독립화 이득 |
| 백엔드 | **Supabase**(Postgres + Auth + RLS + Realtime), 문서 = JSONB(DocV2) | speed | native/longterm의 풀스택 서버는 과잉설계로 판단, 후속 이관 가능하게 캡슐화 |
| 동기화 | 낙관적 잠금(`version`) LWW → **Yjs 경계 선긋기(코드 미작성)** | speed + longterm | CRDT 바인딩 스켈레톤은 코어에 자리만 |
| 모바일 앱 | **PWA → Capacitor 래핑**(React Native 비채택) | speed + longterm 합의 | 네이티브 성능 한계 시 "에디터만 선택적 네이티브화" 문 열어둠 |
| 테스트 | **골든 스냅샷 + 속성기반(fast-check) + Playwright 시각회귀** | longterm | speed의 스냅샷 테스트를 3중으로 강화 |

### 1.2 핵심 근거

1. **핵심 자산은 마인드맵 엔진뿐이다.** 격리 지점을 `mindmap-core` 하나로 엄격히 두고 나머지는 검증된 올인원(Vite/Supabase/Capacitor)에 위임하면, 웹·PWA·앱·서버 export가 동일 로직을 공유하고 미래의 무거운 요구(협업/Canvas/RN)는 **코어를 건드리지 않는 어댑터 교체**로 흡수된다. (speed의 통찰)
2. **에디터가 DOM contentEditable/SVG/리치텍스트에 깊게 의존**한다. RN(native 제안)은 이 편집 UX·접근성을 버리고 렌더러를 재구현해야 하며, 평가에서도 두 트랙 영구 병행 비용·`interaction-core 100% 재사용` 주장의 허점이 지적됐다. 따라서 **웹 코드 1벌 + Capacitor**가 우리 목표에 맞다.
3. 그러나 speed의 약점(스키마 불일치 처리, 회귀 안전망, 협업 전환 비용)은 **저비용으로 지금 접목 가능**하다. `migrate()` 레지스트리·2계층 상태 경계·렌더러 인터페이스·`interaction-core`는 초기 코드량이 작으면서 장기 재작업을 막는다.

### 1.3 명시적으로 접목하지 **않은** 것과 이유

| 미채택 아이디어 | 출처 | 사유 |
|---|---|---|
| React Native + Skia 주력 앱 트랙 | native | 편집기 재구현·PWA/RN 영구 병행 비용. 목표(빠른 웹→앱)와 충돌. **단, "에디터만 선택적 네이티브화" 옵션은 미래 카드로 보존** |
| `render-shared` 별도 패키지 선분리 | native | 지금은 web 렌더러 1개뿐 → 과잉. **`MindmapRenderer` 인터페이스로 draw-list 경계만 남기고**, RN이 실제로 확정되면 그때 승격 |
| NestJS + Prisma + 자체 인증 풀스택 | longterm | 평가상 검증 전 과잉설계. Supabase로 인증·DB·RLS·Realtime을 코드 없이 확보하고, 벤더 종속은 `adapters/` 캡슐화 + 표준 Postgres 덤프로 완화 |
| 처음부터 Yjs/CRDT | native/longterm | 초기 복잡도 과다. **경계만** 코어에 예약 |

---

## 2. 최종 모노레포 / 패키지 트리

```
mindflow/
├─ pnpm-workspace.yaml
├─ turbo.json                     # 태스크 캐시 + 영향 그래프 기반 선택 실행
├─ tsconfig.base.json             # strict, noUncheckedIndexedAccess, project references 루트
├─ .changeset/                    # mindmap-core를 라이브러리처럼 버전 관리(브레이킹 추적)
├─ package.json                   # 루트 스크립트(dev/build/test/lint)
├─ CLAUDE.md
│
├─ docs/
│  ├─ architecture/               # 이 ADR 및 후속 ADR
│  ├─ core-api.md                 # mindmap-core 공개 API 레퍼런스
│  └─ doc-schema.md               # DocV1(레거시)→DocV2 스키마 + 마이그레이션 규약
│
├─ packages/
│  ├─ mindmap-core/               # ★ 핵심 자산. 순수 TS. DOM/React/네트워크/스토리지 0 의존
│  │  ├─ src/
│  │  │  ├─ model/                # Node/Float/Line/Zone/Doc 타입 + 트리 CRUD
│  │  │  ├─ layout/               # layout(doc, mode, sizeOf) → LayoutGeometry (좌표는 doc에 안 씀)
│  │  │  ├─ serialize/            # serializeDoc / parseDoc / migrate 레지스트리
│  │  │  ├─ history/              # HistoryStack (snapshot + 1200ms coalesce, max 60)
│  │  │  ├─ export/               # toMarkdown / toSVG(geom 주입)
│  │  │  ├─ geometry/             # resolveLineGeometry / cubicAt / 도형크기 산술(순수)
│  │  │  ├─ ports/                # TextMeasurer, Clock, IdGen 인터페이스(구현 없음)
│  │  │  ├─ crdt/                 # (조건부) Doc <-> Y.Doc 바인딩 스켈레톤. 지금은 인터페이스+TODO만
│  │  │  └─ index.ts
│  │  └─ test/                    # 골든 스냅샷 + 속성기반(fast-check)
│  │
│  ├─ interaction-core/           # ★ (native에서 접목) 제스처→의도 순수 상태머신
│  │                              # pan/pinch/drag-node/marquee/long-press 를 리듀서로
│  │                              # 입력 이벤트는 어댑터가 정규화(PointerEvent → intent)
│  │
│  ├─ ui/                         # 디자인 토큰(테마 6종 coral..mono) + 공유 React 프리미티브
│  └─ config/                     # eslint/tsconfig/prettier 공유 프리셋(코어 순수성 lint 룰 포함)
│
├─ apps/
│  ├─ web/                        # React + Vite + TS. PWA. core 소비 + 어댑터 구현
│  │  ├─ src/
│  │  │  ├─ features/editor/      # MindFlow.dc.html 이식. MindmapRenderer 구현(SvgDomRenderer)
│  │  │  ├─ features/home/        # Home.dc.html 이식
│  │  │  ├─ features/auth/        # Login.dc.html 이식 + Supabase Auth
│  │  │  ├─ adapters/             # CanvasTextMeasurer, SupabaseDocStore, LocalDocStore, PngRasterizer
│  │  │  ├─ store/                # Zustand: doc 슬라이스(코어 소유) + ui 슬라이스(ephemeral)
│  │  │  └─ platform/             # Capacitor 유무 감지, 공유/파일 저장 분기, Pointer 어댑터 배선
│  │  ├─ vite.config.ts           # vite-plugin-pwa (Workbox)
│  │  └─ index.html
│  │
│  └─ mobile/                     # Capacitor 셸. apps/web 빌드 산출물 래핑 + 네이티브 플러그인만
│     ├─ capacitor.config.ts
│     ├─ android/  ios/           # 생성물
│     └─ src/                     # 공유/파일/상태바/키보드 브릿지
│
└─ server/
   └─ supabase/
      ├─ migrations/              # SQL 스키마 + RLS 정책
      └─ functions/               # (선택) Edge Function: 서버측 export 등(코어 toSVG 재사용)
```

**의존 방향 규칙**: 모든 의존은 `mindmap-core` 방향 단방향. 코어는 아무도 import하지 않는 leaf. 코어에 `window`/`document`/`canvas`/React import가 들어오면 **ESLint `no-restricted-imports`로 CI 실패** 처리(longterm 접목). `server`는 코어의 **타입·직렬화 스키마만** 공유(문서 검증을 클라·서버 동일 코드로).

**패키지 책임 경계**

| 패키지 | 책임 | 금지 |
|---|---|---|
| `mindmap-core` | 모델·레이아웃·직렬화·마이그레이션·undo·export 문자열·기하 | DOM/React/네트워크/스토리지 import |
| `interaction-core` | 제스처 의도 해석·선택/드래그 상태머신(순수) | 실제 이벤트 리스너 등록 |
| `ui` | 디자인 토큰·공유 프리미티브 | 도메인 로직 |
| `apps/web` | 렌더/입력/동기화/PWA. **어댑터 구현 유일 지점** | 엔진 로직 재구현 |
| `apps/mobile` | Capacitor 래핑 + 네이티브 브릿지 | 앱 코드 사실상 없음 |
| `server/supabase` | 스키마·RLS·(선택)Edge Function | 렌더 지식 |

---

## 3. 확정 기술 스택과 선택 이유

### 3.1 웹

| 영역 | 선택 | 이유 |
|---|---|---|
| 언어 | TypeScript strict (`noUncheckedIndexedAccess`) | 수년 유지보수 1차 방어선. 코어~앱 단일 언어 |
| 프레임워크 | React 18 | dc가 이미 `React.createElement` 기반 → `renderCanvas/renderOutline/renderMinimap`을 컴포넌트로 **기계적 1:1 이식** |
| 빌드 | Vite 5 | 빠른 HMR로 이식 반복 극대화, `vite-plugin-pwa` 성숙 |
| 상태 | Zustand + Immer | 원본 snapshot/`cloneNodes` 불변 패턴과 직결. **문서 슬라이스(코어 소유)와 UI 슬라이스(ephemeral) 분리** → 협업 도입 시 문서 소스만 교체 |
| 서버상태 | TanStack Query | 문서 목록/저장/낙관적 업데이트·재시도 |
| 라우팅 | React Router (data router) | Home/Editor/Login 3표면 + 문서 딥링크(`window.location` 대체) |
| 렌더 | SVG(엣지·도형) + absolute DOM div(노드·메모·영역), `MindmapRenderer` 인터페이스 뒤 | 재구현 0으로 최속 이식 + 편집/접근성/리치텍스트 공짜. 성능 임계 시 CanvasRenderer로 국소 교체 |
| 입력 | Pointer Events(단일 경로) + `interaction-core` | 마우스/터치/펜 통일, PWA/앱에서 재작성 불필요 |
| 테스트 | Vitest + Playwright | 코어 골든 테스트와 동일 러너 + E2E/시각회귀 |

**렌더러 결정 근거**: 3개 제안이 모두 SVG+DOM 하이브리드 유지에 합의. Canvas/WebGL 전환은 편집·리치텍스트·히트테스트 전면 재구현을 강제해 출시를 몇 주 지연시킨다. 대신 longterm의 `MindmapRenderer` 인터페이스를 접목해 **초대형 맵 성능 상한을 미래에 올릴 여지**를 남긴다(뷰포트 컬링 → 그래도 부족하면 Canvas 렌더러 교체, 코어 무영향).

### 3.2 코어

- **순수 함수 + 포트 주입.** 시간·DOM·네트워크·측정을 코어가 모른다.
- **텍스트 측정은 `TextMeasurer` 포트로 격리** — `_layout` 순수화의 유일한 핀치포인트(브리핑 §2). 웹은 canvas `measureText`, 테스트는 문자수 근사.
- **레이아웃은 좌표를 `doc`에 쓰지 않고 별도 `LayoutGeometry`로 반환**(longterm 접목). `x,y`를 저장값으로 신뢰하지 않고 로드 후 재계산 → `needsLayout` 런타임 플래그 문제를 구조적으로 해소.

### 3.3 백엔드 — Supabase

| 영역 | 선택 | 이유 |
|---|---|---|
| 플랫폼 | Supabase (Postgres + Auth + RLS + Realtime + Storage) | 인증·DB·소켓·정책을 **서버 코드 거의 없이** 확보 → 속도 렌즈 최대 지렛대 |
| 인증 | Supabase Auth (이메일/비번 + Google OAuth + 이메일 OTP) | 원본 Login의 데모 플로우·`demoCode`와 1:1 대응 |
| 문서 저장 | `documents.doc` = **JSONB(DocV2)** | 코어 `serializeDoc` 결과 그대로 저장/복원. 이식 즉시 호환, 스키마 유연 |
| 권한 | Row Level Security (`owner = auth.uid()`) | 권한 로직을 DB에 내장 → 백엔드 코드 없이 안전 |
| 동기화 | `version` 낙관적 잠금 + LWW, 오프라인 시 localStorage 큐 | 개인 문서 특성상 충분. 충돌 시 사용자 고지 |
| 협업(조건부) | Yjs + Supabase Realtime(브로드캐스트) 또는 y-websocket | 코어 `crdt/` 바인딩으로 격리 도입 |

**벤더 종속 완화(평가 지적 대응)**: 데이터는 표준 Postgres(덤프 이관 자유), 인증 SDK는 `apps/web/adapters/`에 캡슐화, 문서 본문이 `DocV2` JSONB라 어떤 백엔드로도 이관 가능. **native/longterm의 자체 서버(Hono·NestJS)는 요구가 확정되면 `SupabaseDocStore` 어댑터만 교체**하는 방식으로 후속 이관.

```sql
profiles(id uuid pk → auth.users, display_name)
spaces(id, owner uuid, name, created_at)
folders(id, space_id, name, parent_id)
documents(
  id uuid pk, owner uuid, space_id, folder_id,
  title text, doc jsonb,               -- DocV2 통째
  schema_version int,                  -- 마이그레이션 추적(longterm 접목)
  is_favorite bool, deleted_at timestamptz,   -- 휴지통 = soft delete
  updated_at timestamptz, version int  -- 낙관적 잠금
)
document_snapshots(id, document_id, doc jsonb, created_at)  -- 버전 이력/복원
```

### 3.4 모바일

- **2단계(모바일 웹)**: `apps/web`을 `vite-plugin-pwa`로 PWA화(매니페스트/서비스워커/오프라인/설치). 반응형 브레이크포인트로 고정폭 패널(236×2, LNB 248, 로그인 520) → 바텀시트/드로어 전환.
- **3단계(앱스토어)**: 동일 web 빌드를 **Capacitor**로 iOS/Android 셸에 래핑. 코드 재작성 0. 플러그인: `@capacitor/share`·`filesystem`·`preferences`(모바일 DocStore)·`status-bar`·`keyboard`·`app`.
- **RN 비채택 근거**: 편집기의 DOM/SVG/contentEditable 의존을 버려야 하고 두 UI 트랙 영구 유지 비용이 크다(평가 확인). **미래 카드**: 네이티브 감성이 제품 차별화가 되는 순간이 오면 코어·`interaction-core`가 이미 공유되므로 **에디터 화면만 선택적으로 RN+Skia로 승격** 가능(longterm 접목).

---

## 4. mindmap-core API 경계

원칙: **순수 함수 + 포트(어댑터) 주입.** 부수효과는 전부 호출자(앱)가 주입.

### 4.1 포트(어댑터 인터페이스)

```ts
// 텍스트 측정 — _layout 순수화의 유일한 핀치포인트
interface TextMeasurer { measure(text: string, font: Font): { w: number; h: number }; }
interface Clock  { now(): number; }        // 히스토리 coalesce 판정
interface IdGen  { next(): string; }        // 결정론적 테스트용
// PNG 래스터화·localStorage I/O·다운로드는 코어 밖(apps/web/adapters)
```

### 4.2 공개 API 표면

```ts
// ── model ──────────────────────────────────────────────
type DocV2 = { v: 2; nodes: NodeMap; floats: Float[]; lines: Line[];
               zones: Zone[]; layoutMode: LayoutMode;
               edgeStyle: EdgeStyle; themeKey: ThemeKey };
// ↑ 원본 serializeDoc(themeKey有/edgeStyle無) vs takeSnap(edgeStyle有/themeKey無)
//   필드셋 불일치를 v2에서 통합·명문화. v1 파서는 원본 관대 병합 동작 그대로 동결.

// ── factory / clone ────────────────────────────────────
createInitialDoc(opts?): DocV2                 // 원본 buildInitial
cloneNodes(nodes): NodeMap                      // 얕은 복제 + children 새 배열

// ── tree ops — 순수. layout은 호출자가 별도 조합(원본은 내부 _layout 호출 → 분리) ──
addChildNode(doc, parentId, gen: IdGen): DocV2
addSiblingNode(doc, nodeId, gen: IdGen): DocV2
deleteNode(doc, nodeId): DocV2
toggleCollapse(doc, nodeId): DocV2
moveNode(doc, nodeId, newParentId): DocV2

// ── layout — sizeOf 주입, geom 반환(좌표를 doc에 안 씀) ──
type SizeOf = (nodeId: string, depth: number) => { w: number; h: number };
layout(doc: DocV2, mode: LayoutMode, sizeOf: SizeOf, rootAnchor: XY): LayoutGeometry
layoutFreeSubtree(doc, rootId, sizeOf): LayoutGeometry
computeNodeSize(node, depth, measure: TextMeasurer): { w: number; h: number }
//   "텍스트→측정값"만 어댑터, "측정값→도형크기(diamond/hex/pill…)" 산술은 코어 순수

// ── serialize — 순수 + 스키마 버저닝(원본엔 없음, 신설) ──
serializeDoc(doc: DocV2): DocV2
parseDoc(json: string | object): Result<DocV2, ParseError>  // loadDoc 관대 병합 이식
migrate(anyDoc): DocV2                          // v1(레거시)→v2 마이그레이션 레지스트리

// ── history — 순수 상태기계 ──
class HistoryStack {
  push(doc: DocV2, at: number, contChange: boolean): void   // 1200ms coalesce, max 60
  undo(current: DocV2): DocV2 | null
  redo(current: DocV2): DocV2 | null
}

// ── export — 문자열 생성까지만 코어. 다운로드/래스터화는 어댑터 ──
toMarkdown(doc: DocV2): string                  // 원본 exportOutline
toSVG(geom: LayoutGeometry, doc: DocV2, theme: Theme): string  // geom 명시 주입

// ── geometry — 순수 수학 ──
resolveLineGeometry(line, geomLookup): LinePath // lineCPs/resolveEnd/cubicAt

// ── crdt (조건부, 지금은 인터페이스+TODO만) ──
bindYDoc(ydoc): { toDoc(): DocV2; applyLocal(mutation): void }
```

### 4.3 원본 매핑표 확정

| 원본 (파일:라인) | 코어 API | 순수성 |
|---|---|---|
| `buildInitial` L487 | `createInitialDoc` | 순수 |
| `cloneNodes` L884 | `cloneNodes` | 순수 |
| `_layout` L977 | `layout(doc, mode, sizeOf, rootAnchor)` | sizeOf·rootAnchor 주입 시 순수 |
| `metrics`/`wrapMeasure` L893 | `computeNodeSize(node, depth, measure)` | 측정만 어댑터 |
| `serializeDoc` L534 | `serializeDoc` | 순수 |
| `loadDoc`(파싱) L792 | `parseDoc` | 순수(storage read는 어댑터) |
| `takeSnap`/`recordHistory`/`undo`/`redo` L548 | `HistoryStack` | 순수 |
| `exportOutline` L617 | `toMarkdown` | 순수 |
| `exportSVGString` L638 | `toSVG(geom, …)` | geom 주입 시 순수 |
| `exportPNG` L730 | (코어 밖) `PngRasterizer` 어댑터 | DOM 전용 |
| `lineCPs`/`resolveEnd`/`cubicAt` L2403 | `resolveLineGeometry` | geom 주입 시 순수 |

### 4.4 확정된 오픈 이슈 처리(브리핑 §불명확)

| 항목 | 결정 |
|---|---|
| `mindflow_floats` 별도 localStorage 키 | 코어에 이식하지 않고 단일 `DocV2.floats`로 통일. 마이그레이션 시 존재하면 흡수(v1 로더에서만) |
| `d.needsLayout` 런타임 플래그 | 저장 스키마에서 제거. **로드 후 `layout()` 무조건 1회 실행**(좌표 저장값 불신, 재계산)으로 구조적 대체 |
| `d.v` 버전(쓰기만/검사 없음) | `migrate()` 레지스트리 신설. v1→v2 파이프라인 |
| `takeSnap` vs `serializeDoc` 필드 불일치 | **v1 파서는 원본 동작 골든 테스트로 동결**, 내부 `DocV2`는 두 필드셋(themeKey·edgeStyle)을 모두 포함해 통합 |
| `_rootAnchor` 등 숨은 인스턴스 상태 | 명시적 `rootAnchor` 인자로 승격(평가에서 native/longterm이 지적한 parity 위험 차단) |

---

## 5. dc → 프로덕션 단계별 마이그레이션 로드맵

**원칙(strangler)**: 원본 dc는 읽기전용 레퍼런스로 보존. 각 단계는 **독립 배포 가능한 얇은 수직 슬라이스**로, 항상 동작하는 상태 유지. 코어 추출(M1)을 최우선에 둬 이후 모든 단계가 회귀 안전망 위에서 진행.

| 단계 | 작업 | 산출물 | 검증 방법 |
|---|---|---|---|
| **M0 스캐폴딩** (0.5주) | pnpm+Turbo+tsconfig refs, 빈 패키지, CI(lint/type/test/build), 코어 순수성 lint 룰, Vercel 프리뷰 | 녹색 CI + 프리뷰 배포 | 빈 패키지 빌드 통과, `no-restricted-imports` 룰 발동 확인 |
| **M1 코어 추출** ★최우선 (2~2.5주) | `serialize/parse/migrate`, `cloneNodes`, `layout(sizeOf)`, `computeNodeSize`, `HistoryStack`, `toMarkdown`, `toSVG`, `resolveLineGeometry` 이식. 포트 정의 | `mindmap-core` v0 | **골든 스냅샷**: dc에서 뽑은 실문서 JSON을 통과시켜 layout/MD/SVG 출력 바이트 비교. **속성기반(fast-check)**: 트리 정합성, undo/redo 왕복 identity, `parse∘serialize=identity`. **결정론**: IdGen/Clock 주입 |
| **M2 스키마 정리** (0.5주, M1 병행) | DocV2 통합 + `migrate(v1→v2)`. 레거시 필드(`mindflow_floats`/`needsLayout`) v1 로더에 격리 | 마이그레이션 파이프라인 | v1 실데이터 → v2 무손실 마이그레이션 스냅샷 테스트 |
| **M3 에디터 이식** (2.5~3주) | `renderCanvas/renderOutline/renderMinimap` → React(`SvgDomRenderer`). Zustand 2슬라이스(doc/ui) 바인딩. **처음부터 Pointer Events + `interaction-core`**(마우스만 이식 금지). `CanvasTextMeasurer` 주입. LocalDocStore 로컬 저장 | 로컬 동작 에디터 | Playwright E2E: 노드 추가/편집/3레이아웃 모드/undo/export가 dc와 **시각·기능 등가**. 골든 이미지 시각회귀 |
| **M4 Home/Login + 인증** (1.5주) | 대시보드·로그인 React화(React Router). Supabase Auth(Google+이메일 OTP). 데모 코드 → 실 OTP. hover 전용 UI → 상시/롱프레스 재설계 | 인증 붙은 앱 | E2E: 로그인/문서목록/생성/열기 플로우 |
| **M5 동기화 + 실계정 문서** (1.5주) | Supabase Postgres + RLS + `documents` JSONB. TanStack Query 낙관적 저장, `version` 잠금, 오프라인 큐. 스페이스/폴더/휴지통/즐겨찾기 | 멀티기기 동기화 | 다기기 로그인·저장·복원·휴지통. `version` 충돌 시 409 고지 확인 |
| **M6 PWA화** (0.5주) | `vite-plugin-pwa`, 매니페스트, 오프라인 캐시, 반응형 브레이크포인트(패널→드로어/바텀시트), 터치 타겟 44px, 컨텍스트메뉴 좌표 clamp | **모바일 웹(2단계) 달성** | Lighthouse PWA 통과, 모바일 실기기 편집 |
| **M7 Capacitor 래핑 + 스토어** (1.5주) | `apps/mobile` 생성, 네이티브 플러그인 배선, 아이콘/스플래시, TestFlight/내부테스트 | **앱스토어(3단계) 달성** | 실기기 공유/파일저장/오프라인 동작, 스토어 심사 통과 |
| **M8 (조건부) 실시간 협업** | 수요 확정 시 코어 `crdt/` Yjs 바인딩 활성화, 스토어 소스를 Y.Doc로 전환, Realtime 게이트웨이 + awareness | 동시편집 | 2인 동시편집 수렴, 오프라인 재접속 무충돌 병합 |

**총 ~10주**에 웹+PWA+앱스토어. 평가에서 지적된 일정 낙관을 반영해 **M3(에디터)와 M7(스토어 심사)에 버퍼**를 두고, 터치는 M3에서 선반영(뒤로 미루지 않음).

---

## 6. 리스크와 완화책

| # | 리스크 | 영향 | 완화책 |
|---|---|---|---|
| R1 | **텍스트 측정 이식 오차** — 코어 `sizeOf`가 브라우저/Pretendard 렌더와 어긋나면 레이아웃 전체 틀어짐 | 높음 | `TextMeasurer` 어댑터 격리 + 폰트 self-host로 로드 타이밍 고정(`document.fonts.ready` 후 측정). 골든 테스트는 **고정 sizeOf로 배치 로직만**, 픽셀 정합은 Playwright 시각회귀로 별도(longterm 접목) |
| R2 | **레거시 스키마 불일치/미문서 필드**를 잘못 통합 → 데이터 손상 | 중 | v1 파서 원본 동작 **골든 테스트로 동결**, 불명확 필드는 v2로 넘기지 않고 로더에서 흡수. 사람 확인 항목은 ADR/`doc-schema.md`에 명시 |
| R3 | **`_layout` 숨은 인스턴스 상태(`_rootAnchor`) parity 위험**(평가 지적) | 중 | 앵커를 명시적 `rootAnchor` 인자로 승격. 노드 추가 시 전체 흔들림 방지 동작을 골든 테스트로 고정 |
| R4 | **터치 이식을 미룸** → 이벤트 경로 2번 작성 | 중 | M3에서 처음부터 Pointer Events + `interaction-core`. 롱프레스=컨텍스트메뉴, 핀치줌 1급 요구사항 |
| R5 | **DOM+SVG 렌더 성능**(수천 노드, 저사양 기기) | 중~높 | 뷰포트 컬링 + `transform` GPU 합성 1차 대응. `MindmapRenderer` 인터페이스로 Canvas 렌더러 국소 교체 경로 확보(코어 무영향) |
| R6 | **Supabase 벤더 종속** | 중 | 표준 Postgres(덤프 이관), SDK를 `adapters/`에 캡슐화, 문서 본문 `DocV2` JSONB. 자체 서버 필요 시 DocStore 어댑터 교체 |
| R7 | **LWW 동기화 데이터 유실**(멀티기기 동시편집) | 중 | `version` 낙관적 잠금으로 무자각 덮어쓰기 방지(충돌 시 고지), 디바운스 저장으로 창 축소, `document_snapshots`로 복원 가능. 진짜 동시편집은 M8 CRDT |
| R8 | **Capacitor WebView 성능·"웹 껍데기" 심사 리젝** | 중 | 실제 네이티브 기능(공유/파일/오프라인) 탑재, 성능은 R5 경로. 최악의 경우 에디터만 선택적 네이티브화 |
| R9 | **협업(Yjs) 후행 도입이 상태 아키텍처를 흔듦** | 중 | M3부터 문서=코어 소유 불변 Doc / UI=별개 슬라이스 경계 확립. 코어 `crdt/` 바인딩 스켈레톤 선반영 → M8은 소스 교체만 |
| R10 | **원본 `support.js` 미문서 동작 의존** | 중 | 수정 금지 유지. 동작은 골든 테스트로 관찰·고정 후 코어에 재구현(런타임 리버스엔지니어링 금지) |

### 명시적 트레이드오프

1. **실시간 협업을 지금 안 짓는다** — 경계(순수 코어 + `crdt/` 스켈레톤)만 남기고 수요 검증 후 도입.
2. **RN 네이티브 감성을 포기** — Capacitor로 3플랫폼 1벌. 미래 "에디터만 선택 네이티브화" 문 보존.
3. **문서 정규화 없이 JSONB 통째 저장** — 서버측 노드 단위 쿼리/권한 불가하나 이식 즉시 호환·개발 속도.
4. **렌더러 SVG+DOM 고정** — 초대형 맵 상한 있으나 재구현 0. 인터페이스로 상한 상향 여지.
5. **Supabase(올인원) 선택** — 자체 서버의 세밀한 제어를 포기하는 대신 초기 속도. 어댑터 캡슐화로 이관 자유 확보.

---

## 7. 다음 즉시 실행할 작업 3가지

1. **M0 스캐폴딩 착수** — `claude/` 접두사 브랜치에서 pnpm workspaces + Turborepo + `tsconfig.base.json`(strict) + 빈 `mindmap-core`/`apps/web` 패키지 생성. CI(lint/type/test/build)와 **코어 순수성 lint 룰(`no-restricted-imports`로 DOM/React 차단)**을 첫 커밋에 포함. PR로 올린다.

2. **골든 테스트용 기준 데이터 캡처** — 로컬 정적 서버(`python3 -m http.server 8000`)로 dc 프로토타입을 띄우고, 3개 레이아웃 모드(radial/right/down) × 대표 문서(도형/free 노드/floats/lines/zones 포함)에 대해 `serializeDoc` JSON, `exportOutline`(.md), `exportSVGString`(SVG)을 추출해 `packages/mindmap-core/test/fixtures/`에 고정한다. M1 이식의 회귀 기준선.

3. **오픈 이슈 사람 확인 문서화** — 브리핑이 지적한 3건(`mindflow_floats` 별도 키 목적, `d.needsLayout` 용도, `takeSnap`/`serializeDoc` 필드 불일치가 의도인지 버그인지)을 `docs/doc-schema.md`에 §4.4의 결정과 함께 기록하고, 팀에 확인 요청한다. `migrate()` 레지스트리 설계 전 반드시 선행.
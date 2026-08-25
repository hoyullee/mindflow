import { useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel, DocKindName } from '../viewModel';
import { docKindOf } from '../viewModel';
import { DASH_CAP, DASH_COLS, DASH_MIN_SIZE, DASH_ROW_PX, parseSize, sizesFor } from '../dashboard/model';
import { widgetDataOf, type WidgetData, type WidgetKanban } from '../dashboard/widgetData';
import { realPreview } from '../mapPreview';
import { mapHref, readDocRaw } from '../storage';
import { formatLastEdited } from '../timeFormat';
import { META_MONO } from '../chrome';

/**
 * 대시보드 보기 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 isDash 화면.
 *
 * 위젯은 전부 **보기 전용**이다(1단계): 내용은 썸네일 프리페치와 같은 본문
 * (`previewDocs`)에서 실제 문서를 읽고, 편집은 hover의 "열기"가 에디터로 보낸다.
 * 배치 편집(드래그·리사이즈)은 다음 단계 — 지금은 우클릭 메뉴의 크기·내리기·
 * 맨 앞으로가 그 몫을 맡는다.
 *
 * 몸통이 그리는 것(제보로 확정): 마인드맵·화이트보드는 홈 카드와 같은
 * **실렌더**(`realPreview` — 실제 좌표·색·잉크)이고, 칸반은 에디터의 시각 규칙
 * (`widgetData`가 `kanbanMeta`로 계산)을 디자인의 위젯 틀에 부어 실제 보드처럼
 * 보인다.
 */
const KIND_META: Record<DocKindName, { name: string; color: string; icon: JSX.Element }> = {
  map: {
    name: '마인드맵',
    color: 'var(--mf-doc-map)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="5" cy="12" r="2.4" />
        <path d="M7.4 12h5M12.4 12c2.6 0 3.6-5 6.1-5M12.4 12c2.6 0 3.6 5 6.1 5" />
        <circle cx="20" cy="7" r="1.7" />
        <circle cx="20" cy="17" r="1.7" />
      </svg>
    ),
  },
  board: {
    name: '화이트보드',
    color: 'var(--mf-doc-board)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="14" rx="2.5" />
        <path d="m8 14 3-4 2.4 3 2-2.4L18 14" />
      </svg>
    ),
  },
  kanban: {
    name: '칸반보드',
    color: 'var(--mf-doc-kanban)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4" width="4.6" height="16" rx="1.3" />
        <rect x="9.7" y="4" width="4.6" height="10" rx="1.3" />
        <rect x="15.9" y="4" width="4.6" height="13" rx="1.3" />
      </svg>
    ),
  },
};

function greetingNow(): { greeting: string; dateLine: string } {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  const dateLine = `${now.getMonth() + 1}월 ${now.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][now.getDay()]}요일`;
  return { greeting, dateLine };
}

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  isMobile?: boolean;
}

/** 위젯을 여는 런치 전환의 재료 — 그 위젯의 화면 사각형에서 화면 전체로 펼쳐진다. */
interface LaunchState {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  kindName: string;
  space: string;
}

export function DashboardView({ state, view, controller, isMobile = false }: Props) {
  // 편집 모드는 데스크톱 전용(1단계 합의 — 모바일 다듬기는 PR④). HTML5 드래그가
  // 터치에서 발화하지 않고, 모서리 리사이즈도 마우스 전제다.
  const edit = state.dashEdit && !isMobile;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 리사이즈 중의 라이브 크기 — 커밋은 손을 뗄 때 한 번(undo·저장이 한 단계).
  const [resize, setResize] = useState<{ itemId: string; size: string } | null>(null);
  const resizeRef = useRef<{ itemId: string; size: string } | null>(null);
  const [launch, setLaunch] = useState<LaunchState | null>(null);

  const dash = state.dashboards.find((d) => d.id === state.activeDash);
  if (!dash) return null;
  const { greeting, dateLine } = greetingNow();
  const others = state.dashboards.filter((d) => d.id !== dash.id);
  const cols = isMobile ? 2 : DASH_COLS;
  const atCap = dash.items.length >= DASH_CAP;

  /** 위젯 클릭 → 그 자리에서 화면 전체로 펼쳐지며 에디터로(디자인의 ghLaunch).
   * 실제 이동은 `openWithLoader`의 타이머(900ms)가 하고, 이 오버레이는 그동안
   * 로더 위(z 260)를 덮는다 — 이동하면 홈째 언마운트되며 스스로 사라진다. */
  const launchOpen = (rect: DOMRect, docId: string, title: string, kindName: string, space: string) => {
    if (launch) return; // 이미 여는 중 — 두 번째 클릭은 무시
    setLaunch({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, name: title, kindName, space });
    controller.openWithLoader(mapHref(title, docId), title, docId);
  };

  /** 모서리 리사이즈(디자인 startResize) — 시작 사각형 기준으로 픽셀 → 칸 수 환산,
   * 움직이는 동안은 라이브 상태만 갱신하고 손을 뗄 때 커밋한다. */
  const startResize = (e: MouseEvent, itemId: string, kind: DocKindName, startSize: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('[data-dash-widget]');
    const grid = gridRef.current;
    if (!el || !grid) return;
    const GAP = 14;
    const cellW = (grid.getBoundingClientRect().width - GAP * (cols - 1)) / cols;
    const start = el.getBoundingClientRect();
    const [minC, minR] = DASH_MIN_SIZE[kind];
    const move = (ev: globalThis.MouseEvent) => {
      const w = ev.clientX - start.left;
      const h = ev.clientY - start.top;
      const cNew = Math.max(minC, Math.min(cols, Math.round((w + GAP) / (cellW + GAP))));
      const rNew = Math.max(minR, Math.min(3, Math.round((h + GAP) / (DASH_ROW_PX + GAP))));
      const size = `${cNew}x${rNew}`;
      if (resizeRef.current?.size !== size) {
        resizeRef.current = { itemId, size };
        setResize({ itemId, size });
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const fin = resizeRef.current;
      resizeRef.current = null;
      setResize(null);
      if (fin && fin.size !== startSize) controller.setDashItemSize(itemId, fin.size);
    };
    resizeRef.current = { itemId, size: startSize };
    setResize({ itemId, size: startSize });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // 편집 모드의 고스트 격자 — 지금 배치가 차지하는 넓이에서 여유 행을 더해
  // "놓을 수 있는 자리"를 보여 준다(디자인 editCells).
  const cellArea = dash.items.reduce((a, it) => {
    const [ic, ir] = parseSize(resize?.itemId === it.id ? resize.size : it.size);
    return a + Math.min(ic, cols) * ir;
  }, 0);
  const ghostRows = Math.max(2, Math.ceil(cellArea / cols)) + 3;

  return (
    <div data-dashboard-view style={{ display: 'flex', flexDirection: 'column', animation: 'mf-fade .3s ease both', margin: isMobile ? '-16px -14px -32px' : '-24px -32px -44px' }}>
      {/* 다크 히어로 — 대시보드 화면임을 한눈에 가르는 띠(디자인 원본 #332E29 고정:
          어두운 면이라 다크 테마에서도 그대로 성립한다). */}
      <div style={{ position: 'relative', background: '#332E29', padding: isMobile ? '20px 16px 18px' : '26px 32px 24px', display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(247,239,232,.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#B7A995', whiteSpace: 'nowrap' }}>
              {greeting}, {state.userName} 님
            </span>
            <span style={{ ...META_MONO, color: '#8C7E6B', whiteSpace: 'nowrap' }}>{dateLine}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', color: '#F7EFE8', whiteSpace: 'nowrap' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3.5, background: 'var(--mf-accent)', display: 'block', flexShrink: 0 }} />
              {dash.name}
            </h2>
            <span style={{ ...META_MONO, color: dash.items.length >= DASH_CAP ? '#E8A08A' : '#8C7E6B', whiteSpace: 'nowrap', paddingTop: 6 }}>
              {dash.items.length}/{DASH_CAP}
            </span>
            {others.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 3 }}>
                {others.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="btn"
                    onClick={() => controller.selectDash(d.id)}
                    style={{ height: 24, padding: '0 11px', borderRadius: 999, border: '1px solid rgba(247,239,232,.16)', background: 'transparent', color: '#8C7E6B', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {d.name}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
          {/* 편집 토글(디자인) — 켜면 위젯 드래그 재배치·모서리 리사이즈·인라인
              크기/제거가 열린다. 히어로가 고정 다크 면이라 색도 디자인 값 그대로. */}
          {!isMobile && (
            <button
              type="button"
              className="btn"
              data-dash-edit-toggle
              aria-pressed={edit}
              onClick={controller.toggleDashEdit}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                height: 32,
                padding: '0 13px',
                borderRadius: 999,
                border: `1px solid ${edit ? '#F2A184' : 'rgba(247,239,232,.28)'}`,
                background: edit ? '#F2A184' : 'rgba(247,239,232,.07)',
                color: edit ? '#332E29' : '#F7EFE8',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background .14s ease, color .14s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              {edit ? '편집 끝내기' : '편집'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={controller.openDashPicker}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 32,
              padding: '0 15px',
              borderRadius: 999,
              border: '1px solid var(--mf-accent)',
              background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))',
              color: 'var(--mf-accent-ink)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: '0 9px 20px -12px rgba(var(--mf-accent-rgb), .9)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            보드 추가
          </button>
        </div>
      </div>

      {/* 격자 바닥 — 캔버스 같은 점 격자(디자인). */}
      <div style={{ padding: isMobile ? '14px 14px 32px' : '18px 32px 44px', display: 'flex', flexDirection: 'column', gap: 14, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '17px 17px', minHeight: 420, flex: 1 }}>
        {/* 편집 안내 띠(디자인) — 무엇을 할 수 있는지와 종류별 최소 크기를 말한다. */}
        {edit && (
          <div data-dash-edit-banner style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderRadius: 13, background: 'var(--mf-accent-soft)', border: '1px solid rgba(var(--mf-accent-rgb), .25)', animation: 'mf-dim-in .2s ease both' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent-strong)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--mf-subtext)' }}>카드를 끌어 순서를 바꾸고, 오른쪽 아래 모서리를 끌어 크기를 조절해요. 칸반 보드는 3×2부터, 마인드맵과 화이트보드는 1×1부터 놓을 수 있어요.</span>
          </div>
        )}
        {dash.items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '70px 24px', borderRadius: 20, border: '1.5px dashed var(--mf-border)', background: 'var(--mf-card)' }}>
            <span style={{ width: 46, height: 46, borderRadius: 15, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.6" />
                <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.6" />
                <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.6" />
                <rect x="13" y="11" width="7.5" height="9.5" rx="1.6" />
              </svg>
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em' }}>아직 올려둔 보드가 없어요</span>
            <span style={{ fontSize: 12, color: 'var(--mf-muted)', textAlign: 'center', maxWidth: 300 }}>스페이스나 공유받은 문서에서 보드를 골라 올리면, 여기서 한눈에 볼 수 있어요.</span>
            <button
              type="button"
              className="btn"
              onClick={controller.openDashPicker}
              style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-accent)', background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              보드 추가
            </button>
          </div>
        ) : (
          <div ref={gridRef} data-dash-grid style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gridAutoFlow: 'row dense', gap: 14 }}>
            {/* 고스트 격자(디자인 editCells) — 놓을 수 있는 자리를 점선 칸으로 보여 준다.
                포인터를 받지 않아 드래그·리사이즈를 방해하지 않는다. */}
            {edit && (
              <div data-dash-ghost-cells aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: DASH_ROW_PX, gap: 14, pointerEvents: 'none', overflow: 'hidden' }}>
                {Array.from({ length: ghostRows * cols }, (_, i) => (
                  <span key={i} style={{ border: '1.5px dashed var(--mf-border)', borderRadius: 16, background: 'rgba(var(--mf-accent-rgb), .04)' }} />
                ))}
              </div>
            )}
            {dash.items.map((it, idx) => (
              <DashWidget
                key={it.id}
                itemId={it.id}
                docId={it.docId}
                size={resize?.itemId === it.id ? resize.size : it.size}
                committedSize={it.size}
                maxCols={cols}
                edit={edit}
                dragging={dragIdx === idx}
                resizing={resize?.itemId === it.id ? resize.size : null}
                state={state}
                view={view}
                controller={controller}
                onDragStartW={() => setDragIdx(idx)}
                onDragEndW={() => setDragIdx(null)}
                onDragOverW={(e) => {
                  if (dragIdx !== null && dragIdx !== idx) e.preventDefault();
                }}
                onDropW={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== idx) controller.moveDashItem(dragIdx, idx);
                  setDragIdx(null);
                }}
                onResizeStart={startResize}
                onLaunch={launchOpen}
              />
            ))}
            {/* 편집 중 여유 드롭 공간 — 맨 아래로 끌어낼 자리(디자인 editBottomRow). */}
            {edit && !atCap && <span aria-hidden style={{ gridColumn: '1 / -1', gridRow: 'span 1', visibility: 'hidden', pointerEvents: 'none' }} />}
          </div>
        )}
      </div>

      {/* 런치 전환(디자인 ghLaunch) — 위젯이 제자리에서 화면 전체로 펼쳐지며 열린다.
          카드의 기본 스타일이 곧 도착 상태라, 움직임을 줄인 사용자에게는(애니메이션
          off) 전체 화면 로딩 카드로 조용히 축퇴한다. 이동(900ms)과 함께 홈째
          언마운트되므로 뒷정리가 필요 없다.
          **body 포털인 이유**: 이 화면의 루트가 mf-fade(fill both)를 달고 있어
          스태킹 컨텍스트가 영구로 남는다 — 그 안의 fixed는 z 260이어도 컨텍스트째
          z auto로 깔려 LoadingOverlay(z 200)가 위에 그려졌다(실브라우저에서 확인,
          #488 확인창과 같은 계열). */}
      {launch &&
        createPortal(
        <div data-dash-launch style={{ position: 'fixed', inset: 0, zIndex: 260, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'var(--mf-bg)', animation: 'mf-dim-in .5s cubic-bezier(.4,0,.2,1) both' }} />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100vw',
              height: '100vh',
              borderRadius: 0,
              background: 'var(--mf-card)',
              border: '1px solid var(--mf-border)',
              boxShadow: '0 40px 90px -40px rgba(46,42,38,.6)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'mf-dash-launch .56s cubic-bezier(.32,.72,0,1) both',
              ['--lx' as never]: `${launch.x}px`,
              ['--ly' as never]: `${launch.y}px`,
              ['--lw' as never]: `${launch.w}px`,
              ['--lh' as never]: `${launch.h}px`,
            }}
          >
            <div data-launch-copy style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'mf-dim-in .3s ease .26s both' }}>
              <span aria-hidden style={{ width: 34, height: 34, borderRadius: 999, border: '2.5px solid var(--mf-accent-soft)', borderTopColor: 'var(--mf-accent)', animation: 'mf-spin .7s linear infinite', display: 'block' }} />
              <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{launch.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>
                {launch.kindName} · {launch.space} 여는 중
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── 위젯 ─────────────────────────────────────────────────────────────────

interface DashWidgetProps {
  itemId: string;
  docId: string;
  /** 지금 그릴 크기 — 리사이즈 중에는 라이브 값이 들어온다. */
  size: string;
  /** 저장된 크기 — 리사이즈 시작점·크기 순환 버튼의 기준. */
  committedSize: string;
  maxCols: number;
  edit: boolean;
  dragging: boolean;
  /** 이 위젯이 리사이즈 중이면 그 라이브 크기(`"3x2"`), 아니면 null. */
  resizing: string | null;
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  onDragStartW: () => void;
  onDragEndW: () => void;
  onDragOverW: (e: ReactDragEvent) => void;
  onDropW: (e: ReactDragEvent) => void;
  onResizeStart: (e: MouseEvent, itemId: string, kind: DocKindName, startSize: string) => void;
  onLaunch: (rect: DOMRect, docId: string, title: string, kindName: string, space: string) => void;
}

function DashWidget({ itemId, docId, size, committedSize, maxCols, edit, dragging, resizing, state, view, controller, onDragStartW, onDragEndW, onDragOverW, onDropW, onResizeStart, onLaunch }: DashWidgetProps) {
  const raw = state.previewDocs[docId] || readDocRaw(docId) || null;
  const resolved = !!raw || !!state.previewResolved[docId];
  const kind = docKindOf('', docId, state.previewDocs);
  const meta = KIND_META[kind];
  const [c0, rows] = parseSize(size);
  const c = Math.min(c0, maxCols); // 모바일(2열)에서는 넓은 위젯을 접는다
  const title = view.dashDocTitles[docId];
  const space = view.dashDocSpaces[docId];
  const when = formatLastEdited(state.docTimes[docId]);
  const missing = resolved && !raw && !title;
  const data: WidgetData | null = raw ? widgetDataOf(raw, { maxCards: rows >= 3 ? 4 : 2 }) : null;
  const shared = space === '공유받음';
  // 실렌더의 가지 색 폴백 — 홈 카드가 쓰는 그 hue(카탈로그에 실려 있다).
  const hue = view.dashPickCatalog.find((b) => b.docId === docId)?.hue ?? '#f0663f';

  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (!title || edit) return; // 편집 중의 클릭은 배치 조작이지 열기가 아니다(디자인 openBoard)
    const el = (e.currentTarget as HTMLElement).closest('[data-dash-widget]');
    if (!el) return;
    onLaunch(el.getBoundingClientRect(), docId, title, meta.name, space || '');
  };
  const onCtx = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'widget', id: itemId });
  };
  const presets = sizesFor(kind);
  const cycleSize = (e: MouseEvent) => {
    e.stopPropagation();
    const next = presets[(presets.indexOf(committedSize) + 1) % presets.length]!;
    controller.setDashItemSize(itemId, next);
  };
  const removeSelf = (e: MouseEvent) => {
    e.stopPropagation();
    controller.removeDashItem(itemId);
  };
  const sizeLabel = (resizing ?? committedSize).replace('x', '×');

  return (
    <div
      data-dash-widget={itemId}
      onContextMenu={onCtx}
      onClick={open}
      className="mf-dash-widget"
      draggable={edit}
      onDragStart={(e) => {
        if (!edit) return;
        onDragStartW();
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEndW}
      onDragOver={onDragOverW}
      onDrop={onDropW}
      style={{
        gridColumn: `span ${c}`,
        gridRow: `span ${rows}`,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        position: 'relative',
        borderRadius: 16,
        border: `1px solid ${dragging || resizing ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
        background: 'var(--mf-card)',
        overflow: 'hidden',
        boxShadow: '0 2px 5px -3px rgba(46,42,38,.14), 0 20px 36px -30px rgba(46,42,38,.5)',
        opacity: dragging ? 0.45 : 1,
        cursor: edit ? 'grab' : title ? 'pointer' : 'default',
        transition: 'border-color .14s ease, opacity .14s ease',
      }}
    >
      {/* 리사이즈 손잡이(편집 모드) — 오른쪽 아래 모서리를 끌어 칸 수를 바꾼다. */}
      {edit && (
        <span
          data-dash-resize
          title="모서리를 끌어 크기 조절"
          onMouseDown={(e) => onResizeStart(e, itemId, kind, committedSize)}
          style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 5, width: 22, height: 22, cursor: 'nwse-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--mf-faint2)" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M11 5 5 11M11 9l-2 2" />
          </svg>
        </span>
      )}
      {/* 리사이즈 중 — 점선 테두리 + 라이브 크기 라벨(디자인). 커밋은 손을 뗄 때. */}
      {resizing && (
        <span data-dash-resizing style={{ position: 'absolute', inset: 0, zIndex: 4, borderRadius: 15, border: '1.5px dashed var(--mf-accent)', background: 'rgba(var(--mf-accent-rgb), .08)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ padding: '5px 11px', borderRadius: 999, background: '#332E29', color: '#FBEDE6', ...META_MONO, fontSize: 12, fontWeight: 700 }}>{sizeLabel}</span>
        </span>
      )}
      {/* 1×1의 편집 컨트롤 — 머리에 자리가 없어 아래 구석에 띄운다(디자인 overlayControls). */}
      {edit && c === 1 && (
        <span style={{ position: 'absolute', right: 22, bottom: 7, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <EditSizeButton label={sizeLabel} onClick={cycleSize} overlay />
          <EditRemoveButton onClick={removeSelf} overlay />
        </span>
      )}

      {/* hover 열기 알약(디자인) — 클릭 전체가 열기이지만, 무엇이 일어날지 미리 말해 준다.
          편집 중에는 감춘다(그 시간의 클릭은 열기가 아니다 — showOpen: !editMode). */}
      {title && !edit && (
        <button
          type="button"
          className="btn mf-dash-open"
          title="에디터에서 열기"
          onClick={open}
          style={{
            position: 'absolute',
            right: 9,
            bottom: 9,
            zIndex: 5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 11px',
            borderRadius: 999,
            border: '1px solid var(--mf-border)',
            background: 'rgba(255,253,251,.94)',
            color: 'var(--mf-subtext)',
            font: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 10px 20px -14px rgba(46,42,38,.7)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
          열기
        </button>
      )}

      {/* 머리 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px 9px', borderBottom: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
        <span style={{ color: meta.color, display: 'inline-flex', flexShrink: 0 }}>{meta.icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 44, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.015em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title ?? (missing ? '문서를 찾을 수 없어요' : '불러오는 중…')}</span>
            {shared && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--mf-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[space, when].filter(Boolean).join(' · ')}</span>
        </span>
        {/* 1단계는 전부 보기 전용 — 대시보드에서 고치는 것은 다음 단계(칸반 열 이동)에서 열린다. */}
        {c >= 2 && !edit && (
          <span title="대시보드에서는 볼 수만 있어요. 편집은 열어서 하세요" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-bg)', color: 'var(--mf-muted)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
            보기 전용
          </span>
        )}
        {/* 편집 컨트롤(디자인 inlineControls) — 크기 순환 + 내리기. 배지 자리를 이어받는다. */}
        {edit && c >= 2 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <EditSizeButton label={sizeLabel} onClick={cycleSize} />
            <EditRemoveButton onClick={removeSelf} />
          </span>
        )}
      </div>

      {/* 몸통 */}
      {missing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontSize: 11.5, color: 'var(--mf-faint)', textAlign: 'center' }}>휴지통에 있거나 삭제된 문서예요. 우클릭으로 내릴 수 있어요.</div>
      ) : !data ? (
        <div aria-busy={!resolved} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!resolved ? <span className="mf-skel" style={{ width: '60%', height: 10, borderRadius: 6 }} /> : <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</div>
      ) : data.kind === 'kanban' ? (
        <KanbanBody data={data} cols={c} />
      ) : (
        <SceneBody raw={raw!} hue={hue} />
      )}

      {/* 발치 — 아바타(칸반 담당) + 지표 한 줄(디자인). 1행 크기에서는 접는다. */}
      {rows >= 2 && data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px 9px', borderTop: '1px solid var(--mf-hairline)', flexShrink: 0 }}>
          {data.kind === 'kanban' && data.avatars.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center' }} aria-hidden>
              {data.avatars.map((a, i) => (
                <span key={i} style={{ width: 19, height: 19, marginLeft: i ? -5 : 0, borderRadius: 999, background: a.color, border: '1.5px solid var(--mf-card)', color: '#fff', fontSize: 8.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.label}
                </span>
              ))}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ ...META_MONO, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' }}>
            {data.kind === 'kanban' && data.done ? `${data.done.done}/${data.done.total} done` : data.kind === 'mind' ? `노드 ${data.nodeCount}개` : data.kind === 'board' ? `메모 ${data.noteTotal}개` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

/** 칸반 몸통 — 디자인 원본의 위젯 틀에 **에디터의 시각 규칙**을 부었다: 면 층·열 색·
 * 분류 색·기한 문구·아바타 색이 전부 `widgetData`(=`kanbanMeta`)에서 온다.
 * 색이 문서 테마의 hex라 홈 다크 테마와 무관하게 실제 보드의 인상이 유지된다. */
function KanbanBody({ data, cols }: { data: WidgetKanban; cols: number }) {
  const shown = data.columns.slice(0, 4);
  const s = data.surface;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: s.board }}>
      {/* 진행 바 — 에디터 보드 머리의 그 줄(완료부터 왼쪽에서, 열 색 그대로.
          남는 자리는 빈 트랙 = 아직 시작하지 않은 일). */}
      <div style={{ display: 'flex', height: 3, flexShrink: 0, overflow: 'hidden', background: data.track }} aria-hidden>
        {data.segments.map((seg, i) => (
          <span key={i} style={{ width: `${seg.pct}%`, background: seg.color, display: 'block' }} />
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 7, padding: '9px 10px' }}>
        {shown.map((col) => (
          <div key={col.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, minHeight: 0, borderRadius: 10, background: col.bg, border: `1px solid ${s.line}`, padding: '6px 5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 3px', flexShrink: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: col.dot, display: 'block', flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, fontWeight: 800, color: s.subInk, letterSpacing: '-.01em', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
              <span style={{ ...META_MONO, fontSize: 8.5, color: s.subInk, background: s.line, borderRadius: 999, padding: '1px 5px', flexShrink: 0 }}>{col.more > 0 ? `${col.cards.length}/${col.count}` : col.count}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0, overflow: 'hidden' }}>
              {col.cards.map((k) => (
                <div key={k.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 7px', borderRadius: 9, background: s.card, border: `1px solid ${s.line}`, boxShadow: '0 5px 12px -9px rgba(46,42,38,.35)' }}>
                  {k.tag && k.tagBg && (
                    <span style={{ alignSelf: 'flex-start', maxWidth: '100%', height: 14, padding: '0 5px', borderRadius: 5, background: k.tagBg, color: k.tagFg ?? s.ink, fontSize: 8, fontWeight: 800, letterSpacing: '-.01em', display: 'inline-flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{k.tag}</span>
                  )}
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: s.ink, letterSpacing: '-.015em', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{k.title || '(빈 카드)'}</span>
                  {(k.due || k.who) && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      {k.due && cols >= 3 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0, color: k.dueTone === 'over' ? '#c05a2e' : s.subInk }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
                            <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
                            <path d="M8 3v4M16 3v4M3.5 10h17" />
                          </svg>
                          <span style={{ fontSize: 8, fontWeight: k.dueTone === 'over' ? 700 : 500, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.due}</span>
                        </span>
                      )}
                      <span style={{ flex: 1 }} />
                      {k.who && <span style={{ width: 15, height: 15, flexShrink: 0, borderRadius: 99, background: k.whoColor ?? 'var(--mf-accent)', color: '#fff', fontSize: 7.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{k.who}</span>}
                    </span>
                  )}
                </div>
              ))}
              {col.more > 0 && <span style={{ fontSize: 8.5, color: s.subInk, padding: '0 3px' }}>+{col.more}개 더</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 마인드맵·화이트보드 몸통 — 홈 카드와 같은 **실렌더**(`realPreview`). 실제 문서의
 * 좌표·도형·색·잉크가 그대로 축소되어, 위젯이 문서와 다르게 보일 길이 없다(제보).
 * 바탕은 카드 wash + 점 격자(디자인의 위젯 바닥). */
function SceneBody({ raw, hue }: { raw: string; hue: string }) {
  const scene = realPreview(raw, hue);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--mf-wash, var(--mf-bg))', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
      <span data-dash-scene style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{scene ?? <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</span>
    </div>
  );
}

/** 편집 모드의 크기 순환 버튼 — 누를 때마다 그 종류가 놓일 수 있는 다음 크기로
 * (디자인 onCycle). 정밀한 조절은 모서리 드래그가 맡는다. */
function EditSizeButton({ label, onClick, overlay = false }: { label: string; onClick: (e: MouseEvent) => void; overlay?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="크기 바꾸기"
      data-dash-cycle
      onClick={onClick}
      style={{
        height: 22,
        minWidth: 24,
        padding: '0 6px',
        borderRadius: 7,
        border: '1px solid var(--mf-border)',
        background: overlay ? 'rgba(255,253,251,.94)' : 'var(--mf-bg)',
        color: 'var(--mf-subtext)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...META_MONO,
        fontSize: 8.5,
        fontWeight: 800,
        ...(overlay ? { backdropFilter: 'blur(6px)' } : null),
      }}
    >
      {label}
    </button>
  );
}

/** 편집 모드의 내리기 ✕ — 우클릭 메뉴의 "대시보드에서 내리기"와 같은 동작. */
function EditRemoveButton({ onClick, overlay = false }: { onClick: (e: MouseEvent) => void; overlay?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="대시보드에서 내리기"
      aria-label="대시보드에서 내리기"
      data-dash-remove
      onClick={onClick}
      style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        border: '1px solid var(--mf-border)',
        background: overlay ? 'rgba(255,253,251,.94)' : 'var(--mf-bg)',
        color: 'var(--mf-faint)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...(overlay ? { backdropFilter: 'blur(6px)' } : null),
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

export { KIND_META };

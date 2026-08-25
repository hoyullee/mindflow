import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent } from 'react';
import { cardsInColumn } from '@mindflow/mindmap-core';
import { useCommentStore } from '../../../adapters/BackendContext';
import { CardFace, cardBase, COL_W, COL_SHADOW } from '../../editor/components/KanbanBoard';
import { UI_THEME, hexA } from '../../editor/theme';
import { boardSurface, columnBg, columnColor, innerLine } from '../../editor/kanbanMeta';
import { useParticipantAvatars } from '../../editor/useParticipantAvatars';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel, DocKindName } from '../viewModel';
import { docKindOf } from '../viewModel';
import { DASH_CAP, DASH_COLS, DASH_MIN_SIZE, DASH_ROW_PX, DASH_ROWS_MAX, parseSize, sizesFor } from '../dashboard/model';
import { widgetDataOf, type WidgetData, type WidgetKanban } from '../dashboard/widgetData';
import { realPreview } from '../mapPreview';
import { mapHref, readDocRaw } from '../storage';
import { formatLastEdited } from '../timeFormat';
import { META_MONO } from '../chrome';
import { UNREAD_BADGE_BG } from '../theme';

/**
 * 대시보드 보기 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 isDash 화면.
 *
 * 위젯은 전부 **보기 전용**이다: 내용은 썸네일 프리페치와 같은 본문(`previewDocs`)
 * 에서 실제 문서를 읽고, 에디터로 가는 길은 **"열기" 버튼 하나뿐**이다(요청) —
 * 카드 아무 데나 눌러도 열리면, 칸반 카드를 옮기거나 내용을 읽다 실수로 화면이
 * 통째로 바뀐다.
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
  /** 폰의 LNB 서랍 열기 — 대시보드가 홈의 첫 화면이 되면서(요청) 이 화면에도
   * ≡가 있어야 한다. 없으면 스페이스·검색·알림으로 갈 길이 사라진다. */
  onOpenNav?: () => void;
}


export function DashboardView({ state, view, controller, isMobile = false, onOpenNav }: Props) {
  // 편집 모드는 모바일에서도 열린다(PR④) — 다만 **탭으로 되는 것만** 내준다:
  // 크기 순환·내리기 버튼. HTML5 드래그(재배치)와 모서리 리사이즈는 터치에서
  // 발화하지 않는 마우스 제스처라 데스크톱 전용이고, 순서는 길게 눌러 여는
  // 메뉴의 "맨 앞으로 옮기기"가 맡는다(안내 띠가 기기별로 그렇게 말한다).
  const edit = state.dashEdit;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 리사이즈 중의 라이브 크기 — 커밋은 손을 뗄 때 한 번(undo·저장이 한 단계).
  const [resize, setResize] = useState<{ itemId: string; size: string } | null>(null);
  const resizeRef = useRef<{ itemId: string; size: string } | null>(null);

  const dash = state.dashboards.find((d) => d.id === state.activeDash);
  if (!dash) return null;
  const { greeting, dateLine } = greetingNow();
  const others = state.dashboards.filter((d) => d.id !== dash.id);
  const cols = isMobile ? 2 : DASH_COLS;
  const atCap = dash.items.length >= DASH_CAP;


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
      const rNew = Math.max(minR, Math.min(DASH_ROWS_MAX, Math.round((h + GAP) / (DASH_ROW_PX + GAP))));
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
    <div data-dashboard-view style={{ display: 'flex', flexDirection: 'column', margin: isMobile ? '-16px -14px -32px' : '-24px -32px -44px' }}>
      {/* 다크 히어로 — 대시보드 화면임을 한눈에 가르는 띠(디자인 원본 #332E29 고정:
          어두운 면이라 다크 테마에서도 그대로 성립한다). */}
      <div style={{ position: 'relative', background: '#332E29', padding: isMobile ? '20px 16px 18px' : '26px 32px 24px', display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(247,239,232,.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ display: 'flex', alignItems: isMobile ? 'center' : 'baseline', gap: 10, minWidth: 0 }}>
            {/* 폰의 앱 바 ≡ — 홈의 첫 화면이 대시보드라(요청) 여기에도 서랍 손잡이가
                있어야 한다. 툴바의 그것과 같은 고스트 버튼(44px)이고, 색만 다크 히어로에
                맞춘다. 확인하지 않은 공유가 있으면 문에도 점을 찍는다(닫힌 문 뒤의
                배지는 알림이 아니다 — 툴바와 같은 규칙). */}
            {isMobile && onOpenNav && (
              <button
                type="button"
                className="btn"
                onClick={onOpenNav}
                title={view.sharedUnread > 0 ? `메뉴 열기 (새 공유 ${view.sharedUnread}개)` : '메뉴 열기'}
                aria-label={view.sharedUnread > 0 ? `메뉴 열기, 확인하지 않은 공유 ${view.sharedUnread}개` : '메뉴 열기'}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginLeft: -12, marginRight: -8, marginTop: -6, marginBottom: -6, border: 'none', borderRadius: 10, background: 'transparent', color: '#F7EFE8', cursor: 'pointer', padding: 0, flexShrink: 0 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </svg>
                {view.sharedUnread > 0 && <span data-unread-dot aria-hidden="true" style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: UNREAD_BADGE_BG, border: '2px solid #332E29' }} />}
              </button>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: '#B7A995', whiteSpace: 'nowrap' }}>
              {greeting}, {state.userName} 님
            </span>
            <span style={{ ...META_MONO, color: '#8C7E6B', whiteSpace: 'nowrap' }}>{dateLine}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 25, fontWeight: 800, letterSpacing: '-.035em', color: '#F7EFE8', whiteSpace: 'nowrap' }}>
              {/* 색은 만들기 팝업에서 고른 그 색(없으면 강조색). 히어로는 고정 다크 면이라
                  어두운 색은 묻히므로 옅은 빛 테두리를 둘러 어느 색에서도 점이 산다. */}
              <span data-dash-hero-dot style={{ width: 10, height: 10, borderRadius: 3.5, background: dash.color ?? 'var(--mf-accent)', boxShadow: '0 0 0 1px rgba(247,239,232,.3)', display: 'block', flexShrink: 0 }} />
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
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 11px', borderRadius: 999, border: '1px solid rgba(247,239,232,.16)', background: 'transparent', color: '#8C7E6B', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {/* 그 대시보드의 색 — 이름을 읽지 않고도 어느 것인지 알아본다(LNB와 같은 색). */}
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: d.color ?? 'var(--mf-accent)', display: 'block', flexShrink: 0 }} />
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
        {/* 편집 안내 띠(디자인) — 무엇을 할 수 있는지와 종류별 최소 크기를 말한다.
            모바일은 드래그·모서리 리사이즈가 없으므로(터치에서 발화하지 않는 마우스
            제스처) 실제로 되는 조작만 말한다 — 안내가 안 되는 것을 약속하면 안 된다. */}
        {edit && (
          <div data-dash-edit-banner style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderRadius: 13, background: 'var(--mf-accent-soft)', border: '1px solid rgba(var(--mf-accent-rgb), .25)', animation: 'mf-dim-in .2s ease both' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent-strong)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--mf-subtext)' }}>
              {isMobile
                ? '크기 버튼(2×2)으로 카드 크기를 바꾸고 ✕로 내려요. 카드를 길게 누르면 맨 앞으로 옮길 수 있어요.'
                : '카드를 끌어 순서를 바꾸고, 오른쪽 아래 모서리를 끌어 크기를 조절해요. 칸반 보드는 3×2부터, 마인드맵과 화이트보드는 1×1부터 — 최대 4×4까지 놓을 수 있어요.'}
            </span>
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
                isMobile={isMobile}
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
                onOpen={(docId, title) => controller.openWithLoader(mapHref(title, docId), title, docId)}
              />
            ))}
            {/* 편집 중 여유 드롭 공간 — 맨 아래로 끌어낼 자리(디자인 editBottomRow). */}
            {edit && !atCap && <span aria-hidden style={{ gridColumn: '1 / -1', gridRow: 'span 1', visibility: 'hidden', pointerEvents: 'none' }} />}
          </div>
        )}
      </div>

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
  /** 터치 화면 — 드래그·모서리 리사이즈·카드 열 이동은 마우스 제스처라 내주지
   * 않는다(죽은 어포던스 방지). 편집은 탭으로 되는 것(크기 순환·내리기)만. */
  isMobile: boolean;
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
  /** 에디터로 열기 — 스페이스의 카드와 같은 길(전체 화면 로더 → 이동). */
  onOpen: (docId: string, title: string) => void;
}

function DashWidget({ itemId, docId, size, committedSize, maxCols, edit, isMobile, dragging, resizing, state, view, controller, onDragStartW, onDragEndW, onDragOverW, onDropW, onResizeStart, onOpen }: DashWidgetProps) {
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
  const data: WidgetData | null = raw ? widgetDataOf(raw) : null;
  const shared = space === '공유받음';
  // 곁정보도 에디터와 같은 출처 — 담당 사진(share_participants)·댓글 수(comments).
  // 칸반 위젯일 때만 읽는다(문서당 한 번, 다른 종류는 왕복 0).
  const isKanbanWidget = kind === 'kanban' && !!raw;
  const participantAvatars = useParticipantAvatars(docId, isKanbanWidget);
  const commentCounts = useDocCommentCounts(isKanbanWidget ? docId : '');
  // 실렌더의 가지 색 폴백 — 홈 카드가 쓰는 그 hue(카탈로그에 실려 있다).
  const hue = view.dashPickCatalog.find((b) => b.docId === docId)?.hue ?? '#f0663f';
  // 칸반 카드 열 이동 — 대시보드에서 유일하게 허용된 편집(디자인 "열 이동 가능").
  // 보기 전용으로 공유받은 보드는 어포던스도 내주지 않는다(진짜 게이트는 서버 RLS).
  // 터치에서도 내주지 않는다 — HTML5 드래그가 발화하지 않아 배지가 거짓 약속이 된다.
  const sharedRole = state.sharedMaps.find((m) => m.docId === docId)?.role;
  const canMoveCards = kind === 'kanban' && !!title && !missing && sharedRole !== 'view' && !isMobile;

  /** 에디터로 여는 **유일한 길**(요청) — 카드 어디를 눌러도 열리던 것을 "열기"
   *  버튼 하나로 좁혔다. 위젯 안에서 카드를 옮기거나 글을 읽다 실수로 화면이
   *  통째로 바뀌는 일이 없다. */
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    if (!title || edit) return; // 편집 중의 클릭은 배치 조작이지 열기가 아니다(디자인 openBoard)
    onOpen(docId, title);
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
      className="mf-dash-widget"
      draggable={edit && !isMobile}
      onDragStart={(e) => {
        if (!edit || isMobile) return;
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
        // 카드 전체는 더 이상 열기 대상이 아니다(요청: "열기" 버튼으로만) — 손가락
        // 커서를 띄우면 아무 데나 눌러도 열린다는 거짓 약속이 된다.
        cursor: edit && !isMobile ? 'grab' : 'default',
        // transition은 여기서 주지 않는다 — 인라인이 `.mf-dash-widget`의 규칙(transform
        // 포함)을 덮어 hover 떠오름이 전이 없이 툭 바뀐다(홈 카드에서 겪은 함정).
      }}
    >
      {/* 리사이즈 손잡이(편집 모드, 데스크톱) — 오른쪽 아래 모서리를 끌어 칸 수를
          바꾼다. 터치에는 내주지 않는다(마우스 제스처 — 크기는 순환 버튼이 맡는다). */}
      {edit && !isMobile && (
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
      {/* 1×1의 편집 컨트롤 — 머리에 자리가 없어 아래 구석에 띄운다(디자인 overlayControls).
          모바일은 리사이즈 손잡이가 없어 구석까지 붙는다. */}
      {edit && c === 1 && (
        <span style={{ position: 'absolute', right: isMobile ? 7 : 22, bottom: 7, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <EditSizeButton label={sizeLabel} onClick={cycleSize} overlay big={isMobile} />
          <EditRemoveButton onClick={removeSelf} overlay big={isMobile} />
        </span>
      )}

      {/* hover 열기 알약(디자인) — **에디터로 가는 유일한 문**이다(요청: 카드 어디를
          눌러도 열리던 것을 이 버튼 하나로 좁혔다). 데스크톱은 카드에 손을 얹으면
          드러나고, 터치에는 hover가 없어 늘 보인다(home.css).
          편집 중에는 감춘다(그 시간의 클릭은 배치 조작이다 — showOpen: !editMode). */}
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
        {/* 권한 배지(디자인) — 칸반은 카드의 열만 옮길 수 있고, 나머지는 보기 전용.
            보기 전용으로 공유받은 칸반은 그대로 보기 전용을 단다. */}
        {c >= 2 &&
          !edit &&
          (canMoveCards ? (
            <span title="대시보드에서 카드의 열만 옮길 수 있어요" data-dash-perm="move" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-success-soft)', color: 'var(--mf-success-ink)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 6 4 12l4 6M16 6l4 6-4 6" />
              </svg>
              열 이동 가능
            </span>
          ) : (
            <span title="대시보드에서는 볼 수만 있어요. 편집은 열어서 하세요" data-dash-perm="view" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px', flexShrink: 0, borderRadius: 999, background: 'var(--mf-bg)', color: 'var(--mf-muted)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
                <circle cx="12" cy="12" r="2.4" />
              </svg>
              보기 전용
            </span>
          ))}
        {/* 편집 컨트롤(디자인 inlineControls) — 크기 순환 + 내리기. 배지 자리를 이어받는다. */}
        {edit && c >= 2 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <EditSizeButton label={sizeLabel} onClick={cycleSize} big={isMobile} />
            <EditRemoveButton onClick={removeSelf} big={isMobile} />
          </span>
        )}
      </div>

      {/* 몸통 */}
      {missing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontSize: 11.5, color: 'var(--mf-faint)', textAlign: 'center' }}>휴지통에 있거나 삭제된 문서예요. 우클릭으로 내릴 수 있어요.</div>
      ) : !data ? (
        <div aria-busy={!resolved} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!resolved ? <span className="mf-skel" style={{ width: '60%', height: 10, borderRadius: 6 }} /> : <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>내용이 아직 없어요</span>}</div>
      ) : data.kind === 'kanban' ? (
        <KanbanBody data={data} isMobile={isMobile} comments={commentCounts} avatars={participantAvatars.byEmail} onMoveCard={canMoveCards && !edit ? (cardId, toColId) => void controller.moveDashCard(docId, cardId, toColId) : undefined} />
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

/** 그 문서의 댓글 수 — 에디터 카드 곁정보와 **같은 규칙**(미해결 스레드 수, 답글
 * 제외). 위젯이 0을 지어내면 안 되므로 실제 목록을 한 번 읽는다(칸반 위젯당 1회,
 * 못 읽으면 빈 표 — 카드에는 0이 그려진다). */
function useDocCommentCounts(docId: string): Record<string, number> {
  const store = useCommentStore();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!docId) {
      setCounts({});
      return;
    }
    let alive = true;
    store
      .list(docId)
      .then((rows) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        rows.forEach((cm) => {
          if (cm.parentId || cm.resolved) return;
          m[cm.nodeId] = (m[cm.nodeId] ?? 0) + 1;
        });
        setCounts(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [store, docId]);
  return counts;
}

/** 칸반 몸통 — **에디터의 칸반 보드 그대로**다(제보: 열 크기·카드 디자인이 실제
 * 에디터와 달라 보이면 안 된다). 카드는 에디터의 `CardFace`/`cardBase`를 그대로
 * 재사용하고(분류 배지·본문 rich·기한 톤·댓글 수·담당 얼굴·긴급 왼 테두리까지
 * 한 코드), 열도 에디터의 스펙(폭 308/264·머리 구성·그림자)을 같은 값으로 그린다.
 * 색도 에디터와 같은 **UI_THEME 고정**(제보) — 칸반 에디터는 스타일 메뉴가 없어
 * doc.themeKey를 쓰지 않는다(문서에 실린 'white'는 템플릿의 관성값). 위젯이 그걸
 * 읽으면 에디터는 코랄인데 위젯만 파란 팔레트가 된다.
 *
 * 상호작용은 **카드의 열 이동 하나**다: `onMoveCard`가 오면 카드를 다른 열로 끌 수
 * 있고(놓일 자리는 에디터와 같은 점선 상자 — 이 경로는 열 끝에 붙이므로 맨 뒤에
 * 선다), 편집 진입(더블클릭 상세·우클릭 메뉴·추가/삭제)은 내주지 않는다 —
 * 그건 열어서 한다. 배치 편집 모드·보기 전용 공유·터치에서는 드래그 자체가 없다. */
function KanbanBody({ data, isMobile, comments, avatars, onMoveCard }: { data: WidgetKanban; isMobile: boolean; comments: Record<string, number>; avatars: Record<string, string>; onMoveCard?: (cardId: string, toColId: string) => void }) {
  const th = UI_THEME;
  const track = innerLine(th);
  const colW = isMobile ? 264 : COL_W; // 에디터 Column과 같은 폭
  const lastIdx = data.columns.length - 1;
  // 끄는 카드·드롭 대상 열 — 위젯 안의 화면 상태(에디터의 drag/dropTarget).
  const [dragCard, setDragCard] = useState<{ id: string; fromCol: string; h: number } | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: boardSurface(th) }}>
      {/* 진행 바 — 에디터 보드 머리의 그 줄(완료부터 왼쪽에서, 열 색 그대로.
          남는 자리는 빈 트랙 = 아직 시작하지 않은 일). */}
      <div style={{ display: 'flex', height: 3, flexShrink: 0, overflow: 'hidden', background: track }} aria-hidden>
        {data.segments.map((seg, i) => (
          <span key={i} style={{ width: `${seg.pct}%`, background: seg.color, display: 'block' }} />
        ))}
      </div>
      {/* 열 줄 — 에디터 보드와 같은 배치(실제 폭의 열이 옆으로 늘어서고 넘치면
          가로 스크롤). 위젯이라고 열을 오그리면 그 순간 에디터와 다른 물건이 된다. */}
      <div data-dash-kanban-board style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', gap: 16, padding: '12px 14px 14px', overflowX: 'auto', overflowY: 'hidden', boxSizing: 'border-box' }}>
        {data.columns.map((col, i) => {
          const mine = cardsInColumn(data.cards, col.id);
          const hot = overCol === col.id && !!dragCard && dragCard.fromCol !== col.id;
          const divider = innerLine(th);
          return (
            <section
              key={col.id}
              data-dash-col={col.id}
              data-drop-hot={hot || undefined}
              onDragOver={(e) => {
                if (!dragCard || dragCard.fromCol === col.id) return;
                e.preventDefault(); // 놓을 수 있는 열임을 브라우저에 알린다
                if (overCol !== col.id) setOverCol(col.id);
              }}
              onDragLeave={() => {
                if (overCol === col.id) setOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragCard && dragCard.fromCol !== col.id && onMoveCard) onMoveCard(dragCard.id, col.id);
                setDragCard(null);
                setOverCol(null);
              }}
              style={{
                flex: '0 0 auto',
                width: colW,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                alignSelf: 'flex-start',
                maxHeight: '100%',
                background: columnBg(col, th),
                border: `1px solid ${hot ? hexA(th.accent, 0.55) : th.border}`,
                borderRadius: 16,
                boxShadow: COL_SHADOW,
                boxSizing: 'border-box',
              }}
            >
              {/* 열 머리 — 에디터와 같은 구성(점·제목·카드 수). ＋/⋯은 편집 동작이라
                  위젯에는 없다(에디터의 읽기 전용 모드와 같은 얼굴). */}
              <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 13px 11px', borderBottom: `1px solid ${divider}` }}>
                <span style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 999, background: columnColor(col, i, th.palette), display: 'block' }} />
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.title}</span>
                <span style={{ flex: '0 0 auto', minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: th.panel, color: th.subtext, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{mine.length}</span>
              </header>
              <div style={{ flex: '0 1 auto', minHeight: 44, overflowY: 'auto', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {mine.map((k) => (
                  <div
                    key={k.id}
                    data-dash-card={k.id}
                    data-card-urgent={k.flagged ? k.id : undefined}
                    draggable={!!onMoveCard}
                    onDragStart={(e) => {
                      if (!onMoveCard) return;
                      e.stopPropagation(); // 위젯 자체의 드래그(편집 모드 재배치)와 갈라 둔다
                      setDragCard({ id: k.id, fromCol: col.id, h: (e.currentTarget as HTMLElement).getBoundingClientRect().height });
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragCard(null);
                      setOverCol(null);
                    }}
                    // 에디터의 카드와 **같은 클래스** — 호버 떠오름·누름 반응이 같다
                    // (규칙은 `kanbanCard.css`, 인라인 transition은 두지 않는다: 그걸
                    // 얹으면 transform 전이가 덮여 툭 바뀐다).
                    className="mf-kb-card"
                    style={{
                      ...cardBase(k, th, false),
                      position: 'relative',
                      userSelect: 'none',
                      // 끌리는 원본은 자리를 지키되 흐리게(에디터와 같은 신호).
                      opacity: dragCard?.id === k.id ? 0.35 : 1,
                      cursor: onMoveCard ? 'grab' : 'default',
                    }}
                  >
                    <CardFace card={k} theme={th} comments={comments[k.id] ?? 0} tags={data.tags} done={i === lastIdx} avatars={avatars} />
                  </div>
                ))}
                {/* 놓일 자리 — 에디터와 같은 점선 상자(높이 = 끌고 있는 카드).
                    이 경로는 열 끝에 붙이므로 상자도 맨 뒤에 선다. */}
                {hot && <div data-dash-drop-slot style={{ flex: '0 0 auto', height: dragCard?.h || 44, borderRadius: 12, border: `1.5px dashed ${hexA(th.accent, 0.75)}`, background: hexA(th.accent, 0.08), boxSizing: 'border-box' }} />}
                {mine.length === 0 && !hot && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px 14px', borderRadius: 12, border: `1.5px dashed ${th.border}`, textAlign: 'center' }}>
                    {/* 에디터의 빈 열 상자와 같은 꼴 — 문구만 위젯의 것("추가해 보세요"는
                        여기서 할 수 없는 일이라 약속하지 않는다). */}
                    <span style={{ fontSize: 12.5, color: th.subtext }}>이 단계에 카드가 없어요.</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
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
 * (디자인 onCycle). 정밀한 조절은 모서리 드래그가 맡는다(데스크톱).
 * `big` = 터치 타깃(30px — 칸반 카드 ✕·색 라벨 버튼과 같은 폰 크기 규칙). */
function EditSizeButton({ label, onClick, overlay = false, big = false }: { label: string; onClick: (e: MouseEvent) => void; overlay?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="크기 바꾸기"
      data-dash-cycle
      onClick={onClick}
      style={{
        height: big ? 30 : 22,
        minWidth: big ? 34 : 24,
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
function EditRemoveButton({ onClick, overlay = false, big = false }: { onClick: (e: MouseEvent) => void; overlay?: boolean; big?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title="대시보드에서 내리기"
      aria-label="대시보드에서 내리기"
      data-dash-remove
      onClick={onClick}
      style={{
        width: big ? 30 : 22,
        height: big ? 30 : 22,
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

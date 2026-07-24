import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { Theme } from '../theme';
import { boxFor } from './MoveHandle';

interface MobileSelectBarProps {
  controller: EditorController;
  theme: Theme;
}

/**
 * Mobile-only floating action bar for the current single selection: 편집(inline
 * text) · 속성(open the sheet) · 삭제. On mobile a tap just SELECTS an object;
 * this compact bar is the explicit follow-up (hidden while the property sheet is
 * open). It's anchored just BELOW the selected object (following pan/zoom) rather
 * than pinned to the bottom centre — where it used to cover the minimap. Clamped
 * into the canvas, and flipped ABOVE the object when there's no room below.
 *
 * Positioned `absolute` inside the editor's canvas-area container (the same
 * positioned box `.mf-ed-vp` fills), so `boxFor`/`pan`/`zoom`/`vw`/`vh` — all in
 * that box's coordinate space (origin below the toolbar) — map straight to
 * left/top. (`fixed` would offset it up by the toolbar height.)
 */
export function MobileSelectBar({ controller, theme: th }: MobileSelectBarProps) {
  const sel = controller.selection;
  // 노드 선택에는 하위/형제 추가 버튼이 붙는다 — 모바일에는 Tab/Enter도
  // 우클릭 컨텍스트 메뉴도 없어서, 이 바가 노드를 늘릴 유일한 진입점이다.
  const isNode = sel?.kind === 'node';
  const isRoot = isNode && sel?.id === ROOT_ID; // 루트는 형제가 없다(컨텍스트 메뉴와 동일)
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 190, h: 54 });
  // Re-measure whenever the button composition changes (node selections carry
  // extra 하위/형제 buttons) so clamp/flip stays accurate.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [isNode, isRoot]);
  if (!sel) return null;

  const startEdit = (): void => {
    if (sel.kind === 'node') controller.startEditNode(sel.id);
    else if (sel.kind === 'float') controller.startEditFloat(sel.id);
    else if (sel.kind === 'line') controller.startEditLineLabel(sel.id);
    else if (sel.kind === 'zone') controller.startEditZoneLabel(sel.id);
  };

  // Position (in the canvas box's coordinate space): below the object's bottom
  // edge, centred on it.
  const box = boxFor(controller);
  const { pan, zoom, vw, vh } = controller;
  const GAP = 12;
  const M = 8; // canvas margin
  // The zoom/minimap cluster is pinned to the bottom-right of this same box
  // (ZoomControls: absolute, right:16, bottom:16). Reserve a conservative
  // rectangle around it so the bar flips ABOVE the object rather than landing on
  // the minimap — dodging that occlusion is the whole point of this move.
  const CORNER_W = 150;
  const CORNER_H = 160;
  const cornerLeft = vw - CORNER_W;
  const cornerTop = vh - CORNER_H;
  let left: number;
  let top: number;
  if (box) {
    const cx = box.x * zoom + pan.x; // object centre x
    const bottomY = (box.y + box.h / 2) * zoom + pan.y;
    const topY = (box.y - box.h / 2) * zoom + pan.y;
    left = Math.min(Math.max(cx - size.w / 2, M), Math.max(M, vw - size.w - M));
    const below = bottomY + GAP;
    // "Below" fits only if it stays within the canvas AND clears the bottom-right
    // minimap cluster (when the bar's horizontal span reaches into that corner).
    const withinCanvas = below + size.h <= vh - M;
    const hitsCorner = left + size.w > cornerLeft && below + size.h > cornerTop;
    top = withinCanvas && !hitsCorner ? below : Math.max(M, topY - GAP - size.h);
  } else {
    // No measurable box (shouldn't happen for a live selection) — fall back to
    // the old bottom-centre spot.
    left = Math.max(M, vw / 2 - size.w / 2);
    top = Math.max(M, vh - size.h - 16);
  }

  const btn: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 56,
    height: 44,
    padding: '0 10px',
    border: 'none',
    borderRadius: 12,
    background: 'transparent',
    color: th.text,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="선택 동작"
      style={{
        position: 'absolute',
        left,
        top,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 5,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 16,
        boxShadow: '0 6px 22px rgba(0,0,0,.16)',
        zIndex: 22,
      }}
    >
      {isNode && (
        <button type="button" className="mf-ed-btn" style={btn} onClick={controller.addChild}>
          {/* 자식으로 가지를 뻗는 모양: 아래로 꺾이는 커넥터 + 새 노드(＋) */}
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4v9a4 4 0 0 0 4 4h3" />
            <path d="M17 14v6" />
            <path d="M14 17h6" />
          </svg>
          하위
        </button>
      )}
      {isNode && !isRoot && (
        <button type="button" className="mf-ed-btn" style={btn} onClick={controller.addSibling}>
          {/* 같은 들여쓰기의 새 줄(＋): 형제 주제 */}
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 6h9" />
            <path d="M5 12h9" />
            <path d="M9.5 15v6" />
            <path d="M6.5 18h6" />
          </svg>
          형제
        </button>
      )}
      <button type="button" className="mf-ed-btn" style={btn} onClick={startEdit}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        편집
      </button>
      <button type="button" className="mf-ed-btn" style={btn} onClick={controller.openProps}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={3} />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        속성
      </button>
      <button type="button" className="mf-ed-btn" style={{ ...btn, color: '#d92626' }} onClick={controller.deleteSelection}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        삭제
      </button>
    </div>
  );
}

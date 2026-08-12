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
  // 그리기 획에는 글자가 없고(편집 없음) 우클릭 메뉴도 삭제뿐이라, 바에는
  // 속성·삭제만 남긴다 — 눌러도 아무 일 없는 버튼을 두지 않는다.
  const isStroke = sel?.kind === 'stroke';
  const isRoot = isNode && sel?.id === ROOT_ID; // 루트는 형제가 없다(컨텍스트 메뉴와 동일)
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 190, h: 54 });

  // Position (in the canvas box's coordinate space): below the object's bottom
  // edge, centred on it.
  const box = boxFor(controller);
  const { pan, zoom, vw, vh } = controller;
  const GAP = 12;
  const M = 8; // canvas margin

  // 버튼 폭은 가용 폭에 맞춰 줄인다 — 고정 56px로 두면 버튼이 여섯 개가 되는
  // 노드 선택 시 폭이 368px이라 360px 기기(갤럭시 S·아이폰 mini 등 흔한 폭)에서
  // 바가 화면 밖으로 삐져나갔다. 터치 타겟 최소치(44px)는 바닥으로 지킨다.
  const BTN_GAP = 4;
  const BAR_PAD = 5;
  const btnCount = (isStroke ? 2 : 4) + (isNode ? 1 : 0) + (isNode && !isRoot ? 1 : 0); // 편집·속성·삭제·메뉴 + 하위/형제 (획은 속성·삭제)
  const availW = Math.max(0, vw - 2 * M - 2 * BAR_PAD - (btnCount - 1) * BTN_GAP);
  const btnMin = Math.max(44, Math.min(56, Math.floor(availW / btnCount)));

  // Re-measure whenever the button composition OR their width changes, so the
  // clamp/flip below works off the real rendered size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [isNode, isRoot, isStroke, btnMin]);

  if (!sel) return null; // 훅은 전부 위에서 호출한 뒤에 빠져나간다(hooks 규칙)

  const startEdit = (): void => {
    if (sel.kind === 'node') controller.startEditNode(sel.id);
    else if (sel.kind === 'float') controller.startEditFloat(sel.id);
    else if (sel.kind === 'line') controller.startEditLineLabel(sel.id);
    else if (sel.kind === 'zone') controller.startEditZoneLabel(sel.id);
  };

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
    minWidth: btnMin,
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
        gap: BTN_GAP,
        padding: BAR_PAD,
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
      {!isStroke && (
        <button type="button" className="mf-ed-btn" style={btn} onClick={startEdit}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          편집
        </button>
      )}
      <button type="button" className="mf-ed-btn" style={btn} onClick={controller.openProps}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={3} />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        속성
      </button>
      <button type="button" className="mf-ed-btn" style={{ ...btn, color: '#d92626' }} onClick={() => (isStroke ? controller.deleteStroke(sel.id) : controller.deleteSelection())}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        삭제
      </button>
      {/* 메뉴 — 우클릭 메뉴 전체(복사/잘라내기/붙여넣기·이미지·텍스트 정렬 …)를
          그대로 연다. 모바일엔 우클릭이 없고 길게 누르기는 이미 선택된 객체에선
          이동 드래그로 가로채이므로, 이 버튼이 전체 메뉴로 가는 확실한 길이다.
          바에 항목을 더 눕히지 않는 이유: 390px 화면에서 이미 폭이 거의 찼다
          (노드 선택 시 308px) — 그래서 '넓히기'가 아니라 '펼치기'로 푼다.
          메뉴는 바 바로 아래에 띄우고(뷰포트를 벗어나면 ContextMenu가 clamp),
          열려 있는 동안 바는 숨겨 두 겹으로 겹치지 않게 한다(Editor.tsx).
          라벨이 '더보기'가 아닌 이유: 상단 툴바의 앱 메뉴(햄버거)가 이미 그 이름을
          쓰고 있어, 한 화면에 같은 이름의 버튼이 둘 생기지 않도록 구분한다. */}
      {!isStroke && (
        <button
          type="button"
          className="mf-ed-btn"
          style={btn}
          aria-label="객체 메뉴"
          aria-haspopup="menu"
          onClick={(e) => {
            // ⋯ 버튼의 중심 x(바 기준 좌표계로 환산)와 바의 위/아래 변을 넘긴다 —
            // 메뉴가 바에 붙고 이 버튼을 가리키는 꼬리를 그릴 수 있도록.
            const bar = ref.current;
            const btnEl = e.currentTarget;
            const bx = bar ? btnEl.getBoundingClientRect().left - bar.getBoundingClientRect().left : 0;
            controller.openCtxMenuForSelection({ x: left + bx + btnEl.offsetWidth / 2, top, bottom: top + size.h });
          }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
          메뉴
        </button>
      )}
    </div>
  );
}

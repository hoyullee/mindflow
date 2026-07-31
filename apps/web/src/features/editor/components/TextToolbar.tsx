import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect } from 'react';
import type { ListOp } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';

/** 팝업 최대 폭 — 이 폭에서 [B I S | 리스트 4종]과 [색상 10 | 지우기]가 두 줄로 나뉜다. */
const TOOLBAR_W = 320;

interface TextToolbarProps {
  controller: EditorController;
}

/**
 * Floating partial-style toolbar — "B" (bold) / color swatches / "지우기"
 * (clear) — port of the `.mf-tctx` template block + `tctxBold`/`tctxColor`/
 * `tctxClear` (MindFlow.dc.html:433-442, 3088-3100).
 *
 * The original opens this via a right-click INSIDE an active text selection
 * (`Component#onCtxMenu`'s `.mf-richedit` branch, MindFlow.dc.html:2777-2785).
 * This port instead opens it directly off a drag-selection in the node editor
 * (`NodeEditBox`'s own `onMouseUp`/`onKeyUp`, via `controller.openTextCtx`) —
 * an explicit, documented deviation: right-click-while-selecting is an
 * awkward two-handed desktop-only gesture (and the original ALSO overloads
 * right-click-drag for canvas panning elsewhere in this port), whereas a
 * plain drag-selection works identically with mouse, trackpad, AND touch.
 * CLAUDE.md's task brief explicitly allows either trigger ("우클릭-inside-
 * selection 분기 (또는 selection change)").
 */
export function TextToolbar({ controller }: TextToolbarProps) {
  // 팝업 전체(크롬 + 스와치 값)를 **고정** `uiTheme`으로 그린다 — 문서 테마를 바꿔도
  // 이 팝업은 변하지 않는다. 예전엔 문서 테마를 그대로 써서 다크/모노로 바꾸면 팝업이
  // 어두워지고 스와치 색까지 달라졌다(제보).
  //
  // 크롬은 이 코드베이스의 관례(메뉴·패널 = `uiTheme`)와 일치한다. 스와치 **값**은
  // 관례상 문서 테마 쪽이었지만(`panel/NodePanel.tsx`의 `ct.palette`), 여기서는
  // "팝업은 항상 같은 색을 제안한다"를 택했다 — 제보자의 요청이고, 테마를 바꿀 때마다
  // 방금 쓴 색이 목록에서 사라지는 편이 더 혼란스럽다.
  // (트레이드오프: 파랑·초록·보라 테마의 테마-맞춤 색은 이 팝업에서 고를 수 없다.
  //  그 색들은 속성 패널의 텍스트 색 스와치에 그대로 남아 있다.)
  const { textCtx, editingNodeId, uiTheme: th, vw } = controller;

  // 편집 세션 동안 상시 노출(사용자 결정 — NodeEditBox 마운트에서 열림). 그래서
  // 편집 박스 안 클릭(캐럿 이동·드래그 선택)은 닫지 않는다 — 닫히는 경우는
  // ① 편집 종료(커밋/취소가 textCtx를 지움) ② 다른 메뉴 열림(openCtxAt)
  // ③ 그 외 바깥 mousedown(어차피 blur 커밋으로 편집도 끝난다 — 방어적 유지).
  useEffect(() => {
    if (!textCtx) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && target.closest && (target.closest('.mf-tctx') || target.closest('.mf-richedit'))) return;
      controller.closeTextCtx();
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [textCtx, controller]);

  if (!textCtx || !editingNodeId) return null;

  // port of `textCtxStyle` (MindFlow.dc.html:3089-3092) — clamped so the toolbar never
  // overflows past the right edge of the viewport, and never sits above its top edge.
  // 리스트 버튼 4종이 늘면서 한 줄에 다 들어가지 않는다 → `maxWidth` + 줄바꿈으로
  // 2행(서식·리스트 / 색상)이 되게 하고, 위치 clamp도 그 폭 기준으로 잡는다.
  const style: CSSProperties = {
    position: 'absolute',
    left: Math.max(8, Math.min(textCtx.sx, (vw || 600) - TOOLBAR_W - 8)),
    top: Math.max(8, textCtx.sy - 92),
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    maxWidth: TOOLBAR_W,
    rowGap: 7,
    gap: 6,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.16)',
    padding: '7px 9px',
    zIndex: 45,
  };

  // port of `tctxSwatches`: `[th.text].concat(th.palette)` (MindFlow.dc.html:3097-3100).
  // `th`는 고정 `uiTheme`이므로 이 목록도 문서 테마와 무관하다(위 주석 참고).
  const swatches = [th.text, ...th.palette];

  return (
    <div
      className="mf-tctx"
      style={style}
      // Same trap as `ContextMenu.tsx`'s root: this toolbar is a child of `.mf-ed-vp`
      // (which owns `onBackgroundPointerDown`). A real click's `pointerdown` fires BEFORE
      // any button's `mousedown` here — left unstopped, it would bubble to the viewport
      // and start a background marquee drag whose no-move `pointerup` clears the node's
      // text selection out from under the button that's about to act on it. Stopping
      // `pointerdown` at the root keeps every toolbar interaction off the canvas.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" title="선택 영역 굵게 (**굵게**)" onMouseDown={(e) => applyAndGuard(e, controller, 'b')} style={boldButtonStyle(th)}>
        B
      </button>
      <button type="button" title="선택 영역 기울임 (*기울임*)" onMouseDown={(e) => applyAndGuard(e, controller, 'i')} style={{ ...boldButtonStyle(th), fontStyle: 'italic', fontWeight: 600, fontFamily: 'Georgia, serif' }}>
        I
      </button>
      <button type="button" title="선택 영역 취소선 (~~취소선~~)" onMouseDown={(e) => applyAndGuard(e, controller, 's')} style={{ ...boldButtonStyle(th), fontWeight: 600, textDecoration: 'line-through' }}>
        S
      </button>
      <div style={dividerStyle(th)} />
      {/* 줄 단위 리스트 — 글머리/번호 토글과 들여쓰기/내어쓰기. 규칙은 코어
          `applyListOp`가 단일 소스이고 Tab/Shift+Tab과 같은 경로를 쓴다. */}
      <button type="button" title="글머리 기호" onMouseDown={(e) => listAndGuard(e, controller, { type: 'toggle', kind: 'ul' })} style={boldButtonStyle(th)}>
        •
      </button>
      <button type="button" title="번호 매기기" onMouseDown={(e) => listAndGuard(e, controller, { type: 'toggle', kind: 'ol' })} style={{ ...boldButtonStyle(th), fontSize: 11 }}>
        1.
      </button>
      <button type="button" title="내어쓰기 (Shift+Tab)" onMouseDown={(e) => listAndGuard(e, controller, { type: 'indent', dir: -1 })} style={boldButtonStyle(th)}>
        <IndentGlyph dir={-1} />
      </button>
      <button type="button" title="들여쓰기 (Tab)" onMouseDown={(e) => listAndGuard(e, controller, { type: 'indent', dir: 1 })} style={boldButtonStyle(th)}>
        <IndentGlyph dir={1} />
      </button>
      <div style={dividerStyle(th)} />
      {swatches.map((hex) => (
        <button key={hex} type="button" title={hex} onMouseDown={(e) => applyAndGuard(e, controller, 'c', hex)} style={swatchButtonStyle(hex, th)} />
      ))}
      <div style={dividerStyle(th)} />
      <button type="button" title="부분 스타일 지우기" onMouseDown={(e) => applyAndGuard(e, controller, 'clear')} style={clearButtonStyle(th)}>
        지우기
      </button>
    </div>
  );
}

/** Every toolbar button shares this `mousedown` handler — port of `tctxBold`/`tctxColor`/
 * `tctxClear`'s shared shape (MindFlow.dc.html:3093-3100): `preventDefault` keeps the
 * `contentEditable` focused (so its Selection survives the click instead of collapsing on
 * blur) — this IS the original's `_tctxHold` role (MindFlow.dc.html:2652-2654), just achieved
 * without a hold flag, since these buttons call `applyPartial` directly rather than going
 * through `execCommand` (the only call path that actually sets `_tctxHold`). `stopPropagation`
 * is redundant with the root's own `onPointerDown` stop above but kept for defense in depth
 * (matches `ContextMenu.tsx`'s per-button belt-and-suspenders convention). */
function applyAndGuard(e: ReactMouseEvent<HTMLButtonElement>, controller: EditorController, kind: 'b' | 'i' | 's' | 'c' | 'clear', val?: string | null): void {
  e.preventDefault();
  e.stopPropagation();
  controller.applyPartial(kind, val ?? null);
}

/** 리스트 버튼도 서식 버튼과 같은 가드(`applyAndGuard` 참고) — `preventDefault`로
 * 편집 박스의 포커스/선택을 지켜야 연산이 그 선택에 적용된다. */
function listAndGuard(e: ReactMouseEvent<HTMLButtonElement>, controller: EditorController, op: ListOp): void {
  e.preventDefault();
  e.stopPropagation();
  controller.applyListOp(op);
}

/** 들여쓰기/내어쓰기 글리프 — 세 줄과 방향 화살표(텍스트 아이콘보다 뜻이 분명하다). */
function IndentGlyph({ dir }: { dir: 1 | -1 }) {
  return (
    <svg width={14} height={12} viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden style={{ display: 'block', margin: '0 auto' }}>
      <line x1={dir === 1 ? 6 : 1} y1={1} x2={13} y2={1} />
      <line x1={dir === 1 ? 6 : 1} y1={6} x2={13} y2={6} />
      <line x1={dir === 1 ? 6 : 1} y1={11} x2={13} y2={11} />
      {dir === 1 ? <polyline points="1,3 3.5,6 1,9" /> : <polyline points="3.5,3 1,6 3.5,9" />}
    </svg>
  );
}

function dividerStyle(th: EditorController['theme']): CSSProperties {
  return { width: 1, height: 18, background: th.border, flexShrink: 0 };
}

function boldButtonStyle(th: EditorController['theme']): CSSProperties {
  return {
    width: 28,
    height: 26,
    border: `1px solid ${th.border}`,
    borderRadius: 7,
    background: th.panel,
    color: th.text,
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    flexShrink: 0,
  };
}

function clearButtonStyle(th: EditorController['theme']): CSSProperties {
  return {
    height: 26,
    padding: '0 9px',
    border: `1px solid ${th.border}`,
    borderRadius: 7,
    background: th.panel,
    color: th.subtext,
    fontSize: 11.5,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  };
}

function swatchButtonStyle(hex: string, th: EditorController['theme']): CSSProperties {
  return {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: hex,
    border: `2px solid ${th.panel}`,
    boxShadow: `0 0 0 1px ${th.border}`,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  };
}

import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect } from 'react';
import type { EditorController } from '../useEditorState';

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
  const { textCtx, editingNodeId, theme: th, vw } = controller;

  // Outside click closes it — port of the original's `_winDown` `.mf-tctx` branch
  // (MindFlow.dc.html:820): ANY mousedown that doesn't land inside `.mf-tctx` closes
  // the toolbar (a plain click to reposition the caret closes it; a NEW drag-selection
  // reopens it via `openTextCtx` once it completes, same as `ContextMenu.tsx`'s own
  // outside-click effect).
  useEffect(() => {
    if (!textCtx) return;
    function onDown(e: MouseEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && target.closest && target.closest('.mf-tctx')) return;
      controller.closeTextCtx();
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [textCtx, controller]);

  if (!textCtx || !editingNodeId) return null;

  // port of `textCtxStyle` (MindFlow.dc.html:3089-3092) — clamped so the toolbar never
  // overflows past the right edge of the viewport, and never sits above its top edge.
  const style: CSSProperties = {
    position: 'absolute',
    left: Math.max(8, Math.min(textCtx.sx, (vw || 600) - 330)),
    top: Math.max(8, textCtx.sy - 52),
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: th.panel,
    border: `1px solid ${th.border}`,
    borderRadius: 11,
    boxShadow: '0 10px 30px rgba(0,0,0,.16)',
    padding: '7px 9px',
    zIndex: 45,
  };

  // port of `tctxSwatches`: `[th.text].concat(th.palette)` (MindFlow.dc.html:3097-3100).
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
      <button type="button" title="선택 영역 굵게" onMouseDown={(e) => applyAndGuard(e, controller, 'b')} style={boldButtonStyle(th)}>
        B
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
function applyAndGuard(e: ReactMouseEvent<HTMLButtonElement>, controller: EditorController, kind: 'b' | 'c' | 'clear', val?: string | null): void {
  e.preventDefault();
  e.stopPropagation();
  controller.applyPartial(kind, val ?? null);
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

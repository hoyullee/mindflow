import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface AnchoredMenuProps {
  /** The trigger wrapper the menu hangs off of (its bottom-right corner). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Menu width in px — also used to right-align it under the anchor. */
  width: number;
  /** Which edge of the menu aligns to the anchor: 'right' (default — menu's
   * right edge under the anchor's right, for right-side triggers like 내보내기)
   * or 'left' (menu's left edge under the anchor's left, for left-side menu-bar
   * items like 편집/삽입). Both clamp into the viewport with an 8px margin. */
  align?: 'left' | 'right';
  children: ReactNode;
}

/**
 * Renders `children` in a fixed-position portal on `document.body`, anchored to
 * the bottom-right of `anchorRef`.
 *
 * Why a portal + `position: fixed` (not the simpler in-place `absolute`): the
 * top bar is a NON-positioned flex sibling that sits *above* the canvas in DOM
 * order but paints *below* it (the canvas container is `position: relative`, so
 * it wins the paint order over a static sibling — the bar's `zIndex` is ignored
 * because it isn't positioned). It also has `overflowX: auto`, which clips any
 * `absolute` child that spills past the 56px-tall bar. So an in-toolbar dropdown
 * was both clipped by the bar and painted behind the canvas. Portaling to
 * `body` with `position: fixed` escapes both — mirroring the dc original's
 * runtime-measured `position: fixed` popovers.
 */
export function AnchoredMenu({ anchorRef, width, align = 'right', children }: AnchoredMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Align the chosen edge to the anchor, clamped into the viewport (8px margin).
      const raw = align === 'left' ? r.left : r.right - width;
      const left = Math.max(8, Math.min(raw, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 8, left });
    };
    compute();
    window.addEventListener('resize', compute);
    // capture: catch scrolls on any ancestor (e.g. the horizontally-scrolling top bar)
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchorRef, width, align]);

  if (!pos) return null;
  return createPortal(
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 200 }}
      // Keep clicks inside the menu from reaching the window `mousedown`
      // outside-close handler (the menu now lives outside the trigger's wrap).
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

import { useEffect, useRef } from 'react';

// A touch starting within this many px of the left screen edge is an "open"
// gesture candidate (standard nav-drawer edge zone).
const EDGE_ZONE = 24;
// Horizontal travel required before the gesture commits (open or close).
const SWIPE_THRESHOLD = 48;
// Once vertical travel dominates by this much the user is scrolling, not
// swiping the drawer — abandon the gesture.
const VERTICAL_ABORT = 12;

/**
 * Left-edge swipe gestures for the mobile nav drawer (M6): swiping right from
 * the left screen edge opens it, and — while open — swiping left anywhere
 * (drawer or backdrop) closes it. Complements the hamburger button so the
 * drawer is one-thumb reachable regardless of where the button sits.
 *
 * Listeners are passive and attached at the document level only while
 * `enabled` (mobile); a vertical-dominant move abandons the gesture so normal
 * page/tray scrolling never triggers it. The open gesture is restricted to the
 * edge zone, which also keeps it clear of the recent tray's horizontal scroll
 * (a rightward swipe at the tray's leftmost position is a no-op scroll anyway).
 */
export function useDrawerSwipe(enabled: boolean, isOpen: boolean, onOpen: () => void, onClose: () => void): void {
  // Refs so the document listeners (bound once per `enabled`) always see the
  // current open-state/callbacks without re-subscribing on every render.
  const gesture = useRef<{ x: number; y: number; kind: 'open' | 'close' } | null>(null);
  const live = useRef({ isOpen, onOpen, onClose });
  live.current = { isOpen, onOpen, onClose };

  useEffect(() => {
    if (!enabled) return;
    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t) return;
      if (!live.current.isOpen && t.clientX <= EDGE_ZONE) gesture.current = { x: t.clientX, y: t.clientY, kind: 'open' };
      else if (live.current.isOpen) gesture.current = { x: t.clientX, y: t.clientY, kind: 'close' };
      else gesture.current = null;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const start = gesture.current;
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > VERTICAL_ABORT) {
        gesture.current = null; // vertical scroll wins
        return;
      }
      if (start.kind === 'open' && dx >= SWIPE_THRESHOLD) {
        gesture.current = null;
        live.current.onOpen();
      } else if (start.kind === 'close' && dx <= -SWIPE_THRESHOLD) {
        gesture.current = null;
        live.current.onClose();
      }
    };
    const onTouchEnd = (): void => {
      gesture.current = null;
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled]);
}


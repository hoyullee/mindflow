import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { MapCard } from './MapCard';

// Recent row sizing: a compact card is ~this wide (incl. the grid gap), so the
// number that fit is `floor(width / RECENT_CARD_STEP)`. Clamped to [2, 6] so a
// phone still shows a couple and a wide monitor doesn't sprawl into a dozen tiny
// cards.
const RECENT_CARD_STEP = 116; // ≈104px card + 12px gap
const RECENT_MIN_COLS = 2;
const RECENT_MAX_COLS = 6;

/**
 * Global "최근 항목" strip — recently opened maps across EVERY space, shown at the
 * very top of Home (above the space toolbar) so it reads as a cross-cutting
 * "jump back in" bar rather than something belonging to the current space. It's a
 * single row whose card count adapts to the width (measured via ResizeObserver):
 * ~3 on a phone, up to 6 on a wide desktop; we render exactly that many so it's
 * always one clean row.
 */
export function RecentStrip({ cards, controller }: { cards: CardViewData[]; controller: HomeController }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth;
      if (!w) return;
      const fit = Math.floor((w + 12) / RECENT_CARD_STEP);
      setCols(Math.max(RECENT_MIN_COLS, Math.min(RECENT_MAX_COLS, fit)));
    };
    measure();
    // ResizeObserver is absent in some test/SSR environments (jsdom) — fall back
    // to a one-time measure + window resize there.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 14 }}>최근 항목</div>
      <div ref={ref} className="mf-recent-grid" style={{ marginBottom: 22, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cards.slice(0, cols).map((c) => (
          <MapCard key={c.title} card={c} controller={controller} draggableEnabled={false} compact />
        ))}
      </div>
      <div style={{ height: 1, background: '#ecdfd5' }} />
    </div>
  );
}

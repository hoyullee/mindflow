import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { MapCard } from './MapCard';

// Recent card sizing. Cards are a FIXED width (never `1fr`/`minmax(…,1fr)`) so
// they can NOT stretch to fill the row — that's what previously made them balloon
// "wide" when only a couple fit. A fixed track also can't be widened by a long
// title (it clips via ellipsis). The only thing that varies with the viewport is
// HOW MANY fit (the count), never the per-card size.
const RECENT_CARD_W = 104; // fixed px card width (fits ~3 on a phone, more on desktop)
const RECENT_GAP = 12;
const RECENT_STEP = RECENT_CARD_W + RECENT_GAP;
const RECENT_MIN_COLS = 2;
const RECENT_MAX_COLS = 8;

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
      const fit = Math.floor((w + RECENT_GAP) / RECENT_STEP);
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
  const shown = Math.min(cols, cards.length);
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 14 }}>최근 항목</div>
      {/* Fixed-width columns (`${RECENT_CARD_W}px`, not `1fr`) → cards stay the same
          size no matter how many there are or how wide the screen is; only the
          count changes. `overflow: hidden` is a backstop against sub-min widths. */}
      <div
        ref={ref}
        className="mf-recent-grid"
        style={{ marginBottom: 22, gridTemplateColumns: `repeat(${shown}, ${RECENT_CARD_W}px)`, gap: RECENT_GAP, overflow: 'hidden' }}
      >
        {cards.slice(0, shown).map((c) => (
          <MapCard key={c.title} card={c} controller={controller} draggableEnabled={false} compact />
        ))}
      </div>
      <div style={{ height: 1, background: '#ecdfd5' }} />
    </div>
  );
}

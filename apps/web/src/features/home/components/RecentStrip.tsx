import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { MapCard } from './MapCard';

// Recent card sizing (design-system §8.1). Cards are a FIXED width (never
// `1fr`/`minmax(…,1fr)`/`flex: 1`) so they can NOT stretch — that's what
// previously made them balloon "wide". What varies with the viewport is only
// HOW MANY are exposed, never the per-card size.
export const RECENT_CARD_W = 128; // fixed px card width
const RECENT_GAP = 12;
const RECENT_STEP = RECENT_CARD_W + RECENT_GAP;
const TRAY_PAD_X = 32; // desktop tray padding (16px × 2) — mobile doesn't use `fit`
// Mobile swipe depth: how far the touch tray scrolls back in history. Bounded so
// a long history doesn't mount dozens of preview cards on a phone; must stay
// ≤ RECENT_RENDER_MAX (storage.ts), which caps what the view materializes.
const MOBILE_SWIPE_MAX = 20;

/**
 * Global "최근 항목" tray — recently opened maps across EVERY space, shown at the
 * very top of Home. `surface-sunken` container ("well") that shrinks to its
 * content (`width: fit-content`) so a short history never sits in a full-width
 * box.
 *
 * How many cards are EXPOSED adapts to the viewport (history retention is much
 * larger — RECENT_CAP):
 * - Desktop: exactly as many as fit one row (available width is measured via
 *   ResizeObserver on the full-width wrapper — the tray itself is fit-content,
 *   so measuring it would be circular). No horizontal scroll, no cut-off card.
 * - Mobile (<768px): fixed-width cards overflow into a swipeable row (snap
 *   points, peeking card as the affordance) up to MOBILE_SWIPE_MAX — width-fit
 *   would strand everything past the ~2 that fit a phone.
 */
export function RecentStrip({ cards, controller }: { cards: CardViewData[]; controller: HomeController }) {
  const isMobile = useIsMobile();
  const outerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(3);
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth - TRAY_PAD_X;
      if (w <= 0) return; // jsdom/unlaid-out: keep the default
      setFit(Math.max(1, Math.floor((w + RECENT_GAP) / RECENT_STEP)));
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

  const shown = isMobile ? Math.min(cards.length, MOBILE_SWIPE_MAX) : Math.min(cards.length, fit);
  return (
    // Full-width measuring wrapper (block) around the fit-content tray.
    <div ref={outerRef}>
      <div className="mf-recent-tray">
        {/* Eyebrow label — same scale as the "맵"/"폴더" section labels below, so it
            doesn't compete with the actual page title (the space name) for hierarchy. */}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 8 }}>최근 항목</div>
        <div className="mf-recent-scroll" style={{ display: 'flex', gap: RECENT_GAP, overflowX: 'auto', scrollSnapType: 'x proximity' }}>
          {cards.slice(0, shown).map((c) => (
            // Fixed-width, non-shrinking slot (`flex: 0 0 auto`) — the flex analogue
            // of the old fixed grid track. Never `flex: 1` (would stretch like `1fr`).
            <div key={c.title} style={{ width: RECENT_CARD_W, flex: '0 0 auto', scrollSnapAlign: 'start' }}>
              <MapCard card={c} controller={controller} draggableEnabled={false} compact />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

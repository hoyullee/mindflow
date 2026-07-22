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

/** Small clock glyph in front of the "최근 항목" header (SVG per design-system
 * §10 — no emoji), colored via `currentColor` so it follows the header accent. */
function ClockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12.5 15.5 14.5" />
    </svg>
  );
}

/**
 * Global "최근 항목" tray — recently opened maps across EVERY space, shown at the
 * very top of Home. The `surface-sunken` background is a full-width "shelf":
 * it spans the available width (sized by the viewport alone) and the
 * fixed-width cards sit INSIDE it — the zone stays a stable landmark whether
 * the history holds 2 cards or 20.
 *
 * How many cards are EXPOSED adapts to the viewport (history retention is much
 * larger — RECENT_CAP):
 * - Desktop: exactly as many as fit one row (the tray's own width is measured
 *   via ResizeObserver — it's full-width, so it's a stable measuring box).
 *   No horizontal scroll, no cut-off card.
 * - Mobile (<768px): fixed-width cards overflow into a swipeable row (snap
 *   points, peeking card as the affordance) up to MOBILE_SWIPE_MAX — width-fit
 *   would strand everything past the ~2 that fit a phone.
 */
export function RecentStrip({ cards, controller }: { cards: CardViewData[]; controller: HomeController }) {
  const isMobile = useIsMobile();
  const trayRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(3);
  useLayoutEffect(() => {
    const el = trayRef.current;
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
    <div ref={trayRef} className="mf-recent-tray">
      {/* Header: brand-accented clock glyph + strong text so the zone label is
          perceivable at a glance, while staying small enough (13px) not to
          compete with the page title (the space name, 22px). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ color: '#f0663f', display: 'inline-flex' }} aria-hidden="true">
          <ClockGlyph />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.01em', color: '#33281f' }}>최근 항목</span>
      </div>
      <div className="mf-recent-scroll" style={{ display: 'flex', gap: RECENT_GAP, overflowX: 'auto', scrollSnapType: 'x proximity' }}>
        {cards.slice(0, shown).map((c) => (
          // Fixed-width, non-shrinking slot (`flex: 0 0 auto`) — the flex analogue
          // of the old fixed grid track. Never `flex: 1` (would stretch like `1fr`).
          <div key={c.docId || c.title} style={{ width: RECENT_CARD_W, flex: '0 0 auto', scrollSnapAlign: 'start' }}>
            <MapCard card={c} controller={controller} draggableEnabled={false} compact />
          </div>
        ))}
      </div>
    </div>
  );
}

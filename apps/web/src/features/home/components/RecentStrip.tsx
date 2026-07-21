import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { MapCard } from './MapCard';

// Recent card sizing (design-system §8.1). Cards are a FIXED width (never
// `1fr`/`minmax(…,1fr)`) so they can NOT stretch to fill the row — that's what
// previously made them balloon "wide" when only a couple fit. A fixed slot also
// can't be widened by a long title (it clips via ellipsis).
export const RECENT_CARD_W = 128; // fixed px card width
const RECENT_GAP = 12;

/**
 * Global "최근 항목" tray — recently opened maps across EVERY space, shown at the
 * very top of Home (above the space toolbar) so it reads as a cross-cutting
 * "jump back in" bar rather than something belonging to the current space.
 *
 * Design (design-system §8.1): a `surface-raised` tray that shrinks to its
 * content (`width: fit-content`) — the previous grid stretched a full-width
 * container + full-width divider around 2-3 fixed cards, leaving a large dead
 * zone that read as a broken grid. All cards render (the data layer caps the
 * history at RECENT_CAP=12); when they overflow the viewport the tray scrolls
 * horizontally with snap points, so no column-count measuring is needed.
 */
export function RecentStrip({ cards, controller }: { cards: CardViewData[]; controller: HomeController }) {
  return (
    <div className="mf-recent-tray">
      {/* Eyebrow label — same scale as the "맵"/"폴더" section labels below, so it
          doesn't compete with the actual page title (the space name) for hierarchy. */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#9c8b7e', marginBottom: 8 }}>최근 항목</div>
      <div className="mf-recent-scroll" style={{ display: 'flex', gap: RECENT_GAP, overflowX: 'auto', scrollSnapType: 'x proximity' }}>
        {cards.map((c) => (
          // Fixed-width, non-shrinking slot (`flex: 0 0 auto`) — the flex analogue
          // of the old fixed grid track. Never `flex: 1` (would stretch like `1fr`).
          <div key={c.title} style={{ width: RECENT_CARD_W, flex: '0 0 auto', scrollSnapAlign: 'start' }}>
            <MapCard card={c} controller={controller} draggableEnabled={false} compact />
          </div>
        ))}
      </div>
    </div>
  );
}

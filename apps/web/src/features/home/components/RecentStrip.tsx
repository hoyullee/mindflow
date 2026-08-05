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
 * 선택 링이 스크롤 박스 안에서 온전히 보이도록 두는 여유(px).
 *
 * 선택된 카드는 그리드와 같은 표시를 쓴다 — 2px 테두리 + 카드 **밖으로 3px** 번지는
 * 글로우(`MapCard`의 `boxShadow: 0 0 0 3px`). 그런데 이 트레이는 가로 스크롤
 * 컨테이너라 `overflow-x: auto`가 **다른 축까지 auto로 만들고**(CSS 규칙), 여유가
 * 0이면 링이 위·아래·왼쪽에서 잘려 보였다(제보, 실측 각 4px). 스크롤 박스에 이만큼
 * 패딩을 주고 같은 크기의 음수 마진으로 상쇄하면 **카드 위치는 그대로**인 채 링만
 * 안쪽 여유에 들어간다.
 */
const RING_SLACK = 4;

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

/** 로딩 중 "최근 항목" 자리 확보용 스켈레톤 — 저장된 최근 기록이 있으면 실제
 * 트레이와 같은 컨테이너(.mf-recent-tray)·헤더 높이·카드 footprint(128×121)로
 * 미리 깔아 둔다. 없으면 로드 후 트레이가 갑자기 끼어들며 아래 툴바(파일 검색·
 * 새로 만들기…)가 위아래로 튀던 레이아웃 점프가 이것으로 사라진다. */
export function RecentStripSkeleton({ count }: { count: number }) {
  const n = Math.max(1, Math.min(count, 6));
  return (
    <div className="mf-recent-tray" aria-busy="true" aria-label="최근 항목을 불러오는 중">
      {/* 실제 헤더와 동일한 고정 높이(16px + marginBottom 10) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, height: 16 }}>
        <span className="mf-skel" style={{ width: 14, height: 14, borderRadius: 4 }} />
        <span className="mf-skel" style={{ width: 56, height: 13, borderRadius: 6 }} />
      </div>
      <div style={{ display: 'flex', gap: RECENT_GAP, overflow: 'hidden' }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} style={{ width: RECENT_CARD_W, flex: '0 0 auto', border: '1px solid var(--mf-border-soft)', borderRadius: 10, background: 'var(--mf-panel)', overflow: 'hidden' }}>
            {/* compact MapCard와 footprint 정확히 일치:
                썸네일 72 + 패딩 8·8 + 제목줄 15 + (marginTop 2 + 위치줄 14).
                위치줄이 생기며 카드가 16px 높아졌으므로 스켈레톤도 같이 키운다 —
                어긋나면 로드 완료 순간 트레이 높이가 변하며 아래 툴바가 튄다. */}
            <div className="mf-skel" style={{ height: 72, borderRadius: 0 }} />
            <div style={{ padding: '8px 10px' }}>
              <div style={{ height: 15, display: 'flex', alignItems: 'center' }}>
                <div className="mf-skel" style={{ height: 11, width: '70%', borderRadius: 6 }} />
              </div>
              <div style={{ height: 14, marginTop: 2, display: 'flex', alignItems: 'center' }}>
                <div className="mf-skel" style={{ height: 9, width: '45%', borderRadius: 5 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
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
      {/* height/lineHeight를 px로 고정 — 폰트 스왑에 따른 행 높이 변화(→ 아래
          툴바 밀림)를 막고, 로딩 스켈레톤과 footprint를 정확히 일치시킨다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, height: 16 }}>
        <span style={{ color: 'var(--mf-accent)', display: 'inline-flex' }} aria-hidden="true">
          <ClockGlyph />
        </span>
        <span style={{ fontSize: 13, lineHeight: '16px', fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)' }}>최근 항목</span>
      </div>
      <div
        className="mf-recent-scroll"
        style={{
          display: 'flex',
          gap: RECENT_GAP,
          overflowX: 'auto',
          scrollSnapType: 'x proximity',
          // 선택 링이 잘리지 않게 여유를 두고 같은 크기로 상쇄한다(RING_SLACK 참고).
          // 스냅 지점도 그만큼 당겨 첫 카드가 여유 안쪽에 딱 맞게 선다.
          padding: RING_SLACK,
          margin: -RING_SLACK,
          scrollPaddingLeft: RING_SLACK,
        }}
      >
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

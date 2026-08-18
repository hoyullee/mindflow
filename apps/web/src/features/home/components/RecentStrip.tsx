import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { MapCard } from './MapCard';

// Recent card sizing (design-system §8.1). Cards are a FIXED width (never
// `1fr`/`minmax(…,1fr)`/`flex: 1`) so they can NOT stretch — that's what
// previously made them balloon "wide". What varies with the viewport is only
// HOW MANY are exposed, never the per-card size.
export const RECENT_CARD_W = 158; // fixed px card width(디자인 원본)
const RECENT_GAP = 10;
const RECENT_STEP = RECENT_CARD_W + RECENT_GAP;
/**
 * 스크롤 박스가 카드 주변에 두는 여유(px) — 선택 링(outline 2px + offset 2)과
 * hover 시 3px 떠오르는 카드의 **그림자**가 잘리지 않아야 한다(제보: 그림자가
 * 하단 영역에 잘려 보인다). 가로 스크롤 컨테이너는 `overflow-x: auto`가 다른
 * 축까지 auto로 만들어 여유가 없으면 안쪽에서 잘린다. 위·옆은 링/떠오름 몫,
 * 아래는 그림자 몫(디자인 원본도 아래 12px을 상쇄하지 않고 남긴다).
 */
const SLACK_TOP = 8;
const SLACK_X = 24;
const SLACK_BOTTOM = 18;
// 트레이는 이제 상자가 아니라 선으로만 갈린 구획이라 좌우 패딩이 없다 —
// 재는 폭은 컨테이너 폭 그대로다(선택 링 여유만 뺀다).
const TRAY_PAD_X = SLACK_X * 2;
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

/** 로딩 중 "최근 항목" 자리 확보용 스켈레톤 — 저장된 최근 기록이 있으면 실제
 * 트레이와 같은 컨테이너(.mf-recent-tray)·헤더 높이·카드 footprint(128×121)로
 * 미리 깔아 둔다. 없으면 로드 후 트레이가 갑자기 끼어들며 아래 툴바(파일 검색·
 * 새로 만들기…)가 위아래로 튀던 레이아웃 점프가 이것으로 사라진다. */
export function RecentStripSkeleton({ count }: { count: number }) {
  const n = Math.max(1, Math.min(count, 6));
  return (
    <div className="mf-recent-tray" aria-busy="true" aria-label="최근 항목을 불러오는 중">
      {/* 실제 헤더와 동일한 고정 높이(16px + marginBottom 10) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, height: 16 }}>
        <span className="mf-skel" style={{ width: 14, height: 14, borderRadius: 4 }} />
        <span className="mf-skel" style={{ width: 56, height: 13, borderRadius: 6 }} />
        <span className="mf-skel" style={{ width: 62, height: 11, borderRadius: 6 }} />
      </div>
      <div style={{ display: 'flex', gap: RECENT_GAP, overflow: 'hidden' }}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} style={{ width: RECENT_CARD_W, flex: '0 0 auto', border: '1px solid var(--mf-border-soft)', borderRadius: 15, background: 'var(--mf-card)', overflow: 'hidden' }}>
            {/* compact MapCard와 footprint 정확히 일치:
                썸네일 74 + 패딩 9·11 + 제목줄 15 + (marginTop 2 + 위치줄 14).
                위치줄이 생기며 카드가 16px 높아졌으므로 스켈레톤도 같이 키운다 —
                어긋나면 로드 완료 순간 트레이 높이가 변하며 아래 툴바가 튄다. */}
            <div className="mf-skel" style={{ height: 74, borderRadius: 0 }} />
            <div style={{ padding: '9px 11px 11px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, height: 16 }}>
        <span style={{ color: 'var(--mf-faint)', display: 'inline-flex' }} aria-hidden="true">
          <ClockGlyph />
        </span>
        <span style={{ fontSize: 12.5, lineHeight: '16px', fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-subtext)' }}>최근 항목</span>
        {/* 범위를 문구가 말한다 — 이 목록만 스페이스를 가로지른다(디자인 원본). */}
        <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--mf-faint)' }}>모든 스페이스</span>
      </div>
      <div
        className="mf-recent-scroll"
        style={{
          display: 'flex',
          gap: RECENT_GAP,
          overflowX: 'auto',
          scrollSnapType: 'x proximity',
          // 링·그림자 여유(SLACK_* 참고) — 위·옆은 같은 크기 음수 마진으로 상쇄해
          // 카드 위치가 그대로고, **아래는 상쇄하지 않아** 그림자가 놓일 자리가
          // 실제로 넓어진다(상쇄하면 다음 구획이 그 위로 올라와 도로 잘린다).
          padding: `${SLACK_TOP}px ${SLACK_X}px ${SLACK_BOTTOM}px`,
          margin: `${-SLACK_TOP}px ${-SLACK_X}px 0`,
          scrollPaddingLeft: SLACK_X,
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

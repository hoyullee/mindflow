import type { HomeController } from '../useHomeController';
import type { CardViewData } from '../viewModel';
import { MapCard } from './MapCard';

/**
 * "공유받은 맵" — 남이 나에게 공유한 문서들(0009의 `document_shares`).
 *
 * 내 스페이스·폴더에 속하지 않는 목록이라(워크스페이스 블롭은 per-user다) 최근 항목
 * 트레이처럼 스페이스 툴바 **위**에 따로 놓는다. 카드는 compact 변형이라 ☰ 메뉴도
 * 드래그도 없다 — 내 문서가 아니어서 옮기거나 지울 수 없기 때문이다.
 */
export function SharedStrip({ cards, controller }: { cards: CardViewData[]; controller: HomeController }) {
  return (
    <div className="mf-recent-tray" aria-label="공유받은 맵">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, height: 16, fontSize: 12.5, fontWeight: 700, color: '#9c8b7e' }}>
        <span style={{ display: 'flex', color: '#3f8fd0' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 21v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 19.4V21" />
            <circle cx="9" cy="7.5" r="3.5" />
            <path d="M17.5 11.5 21 8l-3.5-3.5" />
            <path d="M21 8h-6" />
          </svg>
        </span>
        공유받은 맵
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
        {cards.map((c) => (
          <div key={c.key} style={{ width: 128, flex: '0 0 auto' }}>
            <MapCard card={c} controller={controller} draggableEnabled={false} compact />
          </div>
        ))}
      </div>
    </div>
  );
}

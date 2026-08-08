import type { HomeController } from '../useHomeController';
import type { HomeViewModel } from '../viewModel';
import { FolderCard } from './FolderCard';
import { MapCard } from './MapCard';

interface Props {
  view: HomeViewModel;
  controller: HomeController;
}

const GRID_STYLE = { gap: 20 } as const;

/**
 * 전역 검색 결과 화면 — 질의가 있는 동안 스페이스 그리드를 **대신한다**.
 *
 * 결과를 스페이스별로 묶는 이유: 검색이 전 스페이스를 뒤지므로 "어디 것인가"가
 * 제목만큼 중요한 정보가 됐다. 묶음 헤더의 색 점은 LNB의 스페이스 색과 같은 표식이고,
 * 카드마다 붙는 폴더 경로가 그 안에서의 위치를 마저 알려 준다.
 */
export function SearchResults({ view, controller }: Props) {
  if (view.searchEmpty) {
    return (
      <div data-search-empty style={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: 20 }}>
        <div style={{ width: 88, height: 88, borderRadius: 24, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>&apos;{view.searchQuery}&apos;에 맞는 맵이 없어요</div>
        <div style={{ fontSize: 13.5, color: 'var(--mf-muted)', lineHeight: 1.6, textAlign: 'center' }}>
          모든 스페이스의 맵 제목과 내용(주제·메모·영역 이름)에서 찾았어요.
          <br /> 다른 낱말로 찾아보세요.
        </div>
      </div>
    );
  }

  return (
    <div data-search-results>
      <div data-search-notice style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>
          &apos;{view.searchQuery}&apos; 검색 결과
        </h2>
        <span style={{ fontSize: 13, color: 'var(--mf-muted)' }}>
          {view.searchCount}개 · 모든 스페이스
          {/* 다른 스페이스 본문이 아직 오는 중이면 제목으로만 걸린 상태다 — 결과가
              뒤늦게 늘어나는 것이 고장으로 보이지 않게 말해 준다. */}
          {view.searchLoading && ' · 내용에서 더 찾는 중…'}
        </span>
      </div>

      {view.searchGroups.map((g) => (
        <div key={g.spaceId} style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 13 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: g.spaceColor, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.18)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-subtext)' }}>{g.spaceName}</span>
            <span style={{ fontSize: 12, color: 'var(--mf-faint)' }}>{g.cards.length + g.folders.length}</span>
          </div>
          <div className="mf-map-grid" style={GRID_STYLE}>
            {g.folders.map((f) => (
              <FolderCard key={`f:${f.id}`} folder={f} controller={controller} />
            ))}
            {g.cards.map((c) => (
              <MapCard key={c.key} card={c} controller={controller} draggableEnabled={false} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

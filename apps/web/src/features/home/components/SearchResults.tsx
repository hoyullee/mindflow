import type { HomeController } from '../useHomeController';
import type { HomeViewModel } from '../viewModel';
import { FolderCard } from './FolderCard';
import { MapCard } from './MapCard';

interface Props {
  view: HomeViewModel;
  controller: HomeController;
}

const GRID_STYLE = { gap: 20 } as const;

/** 종류 칩의 바탕 — 문서 종류 색과 같은 계열로 옅게(칩이 글자를 가리지 않게). */
const HIT_TONE: Record<string, string> = {
  페이지: 'color-mix(in srgb, var(--mf-doc-note) 16%, transparent)',
  본문: 'var(--mf-wash)',
  주제: 'color-mix(in srgb, var(--mf-doc-map) 14%, transparent)',
  메모: 'color-mix(in srgb, var(--mf-doc-board) 14%, transparent)',
  영역: 'color-mix(in srgb, var(--mf-doc-board) 10%, transparent)',
  열: 'color-mix(in srgb, var(--mf-doc-kanban) 12%, transparent)',
  카드: 'color-mix(in srgb, var(--mf-doc-kanban) 16%, transparent)',
};

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
          모든 스페이스의 문서 제목과 내용에서 찾았어요
          <br /> (주제·메모·영역 · 칸반 카드 · 공책의 페이지와 본문).
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
          {view.searchHits.length > 0 && ` · 내용 ${view.searchHits.length}`}
          {/* 다른 스페이스 본문이 아직 오는 중이면 제목으로만 걸린 상태다 — 결과가
              뒤늦게 늘어나는 것이 고장으로 보이지 않게 말해 준다. */}
          {view.searchLoading && ' · 내용에서 더 찾는 중…'}
        </span>
      </div>

      {/* 내용에서 걸린 줄들 — **카드 위**에 둔다(요청: 공책과 페이지 내용도 찾게).
          제목에 없는 낱말로 찾은 경우 "왜 이 문서가 나왔는지"가 여기서만 보이므로,
          스크롤해 내려가야 보이면 있으나 마나다. 공책의 페이지 줄은 **그 장으로** 연다. */}
      {view.searchHits.length > 0 && (
        <div data-search-hits style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-subtext)' }}>내용</span>
            <span style={{ fontSize: 12, color: 'var(--mf-faint)' }}>{view.searchHits.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {view.searchHits.map((h) => (
              <a
                key={h.key}
                href={h.href}
                data-search-hit={h.kind}
                onClick={(e) => {
                  e.preventDefault();
                  controller.openWithLoader(h.href, h.docTitle);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 11px',
                  borderRadius: 10,
                  textDecoration: 'none',
                  color: 'inherit',
                  minWidth: 0,
                }}
                className="mf-hit-row"
              >
                <span
                  style={{
                    flex: '0 0 auto',
                    height: 19,
                    padding: '0 7px',
                    borderRadius: 6,
                    background: HIT_TONE[h.kind],
                    color: 'var(--mf-subtext)',
                    fontSize: 10.5,
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {h.kind}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.snippet}</span>
                <span style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, maxWidth: '38%', minWidth: 0 }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2.5, background: h.spaceColor, flex: '0 0 auto' }} />
                  <span style={{ fontSize: 11.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.docTitle}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

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

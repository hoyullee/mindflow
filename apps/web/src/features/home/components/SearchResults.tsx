import type { HomeController } from '../useHomeController';
import type { HomeViewModel, SearchHitViewData } from '../viewModel';
import type { DocKindName } from '../viewModel';
import { FolderCard } from './FolderCard';
import { MapCard } from './MapCard';

interface Props {
  view: HomeViewModel;
  controller: HomeController;
}

const GRID_STYLE = { gap: 20 } as const;

/** 종류 칩의 바탕 — 문서 종류 색과 같은 계열로 옅게(칩이 글자를 가리지 않게). */
/** 경로 앞 점의 색 — 카드 그리드의 종류 색과 같은 토큰을 쓴다(드리프트 방지). */
const DOC_INK: Record<DocKindName, string> = {
  map: 'var(--mf-doc-map)',
  board: 'var(--mf-doc-board)',
  kanban: 'var(--mf-doc-kanban)',
  note: 'var(--mf-doc-note)',
};

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
/** 요약 줄의 가운뎃점 — 항목마다 `·`를 손으로 끼우면 줄바꿈에서 점만 남는다. */
function Dot() {
  return <span aria-hidden="true" style={{ color: 'var(--mf-faint2)' }}>·</span>;
}

/** 걸린 자리의 경로 — `스페이스 › 공책 › 페이지`(페이지가 없으면 두 칸). */
function pathOf(h: SearchHitViewData): string {
  return [h.spaceName, h.docTitle, h.pageTitle].filter(Boolean).join(' › ');
}

/**
 * 발췌에서 **질의만 형광펜으로** — 대소문자를 가리지 않고 모든 자리를 긋는다.
 *
 * `dangerouslySetInnerHTML`을 쓰지 않는 이유: 발췌는 사용자가 쓴 글이라 그대로
 * HTML로 넣으면 문서 본문이 화면을 고칠 수 있게 된다. 조각으로 잘라 `<mark>`를
 * **엘리먼트로** 끼운다.
 */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const out: JSX.Element[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(q, 0); i >= 0 && out.length < 40; i = low.indexOf(q, at)) {
    if (i > at) out.push(<span key={`${at}t`}>{text.slice(at, i)}</span>);
    out.push(
      <mark key={`${i}m`} style={{ background: 'var(--mf-mark)', color: 'inherit', fontWeight: 800, borderRadius: 3, padding: '0 1px' }}>
        {text.slice(i, i + q.length)}
      </mark>,
    );
    at = i + q.length;
  }
  if (at < text.length) out.push(<span key="tail">{text.slice(at)}</span>);
  return <>{out}</>;
}

export function SearchResults({ view, controller }: Props) {
  // 결과가 있는 스페이스들 — 요약 줄의 마지막 칸("일반 공간").
  const spaceNames = view.searchGroups.map((g) => g.spaceName).filter(Boolean).slice(0, 3).join(' · ');
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
      {/* 머리 — 돋보기 · `검색 결과` · 한 줄 요약(디자인 첫 번째 이미지).
          요약은 **셈이 갈린다**: 카드 몇 개, 내용에서 몇 줄, 어느 스페이스에서.
          "3개"만 적으면 내용에서 걸린 여덟 줄이 어디에도 세어지지 않는다. */}
      <div data-search-notice style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--mf-accent)', flex: '0 0 auto' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.5-4.5" />
          </svg>
        </span>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>검색 결과</h2>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--mf-muted)', minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: 'var(--mf-subtext)' }}>&apos;{view.searchQuery}&apos;</span>
          <Dot />
          모든 스페이스
          <Dot />
          카드 {view.searchCount}
          {view.searchHits.length > 0 && (
            <>
              <Dot />
              내용 {view.searchHits.length}
            </>
          )}
          {spaceNames && (
            <>
              <Dot />
              {spaceNames}
            </>
          )}
          {/* 다른 스페이스 본문이 아직 오는 중이면 제목으로만 걸린 상태다 — 결과가
              뒤늦게 늘어나는 것이 고장으로 보이지 않게 말해 준다. */}
          {view.searchLoading && (
            <>
              <Dot />
              내용에서 더 찾는 중…
            </>
          )}
        </span>
      </div>

      {/* 내용에서 걸린 줄들 — **카드 위**에 둔다(요청: 공책과 페이지 내용도 찾게).
          제목에 없는 낱말로 찾은 경우 "왜 이 문서가 나왔는지"가 여기서만 보이므로,
          스크롤해 내려가야 보이면 있으나 마나다. 공책의 페이지 줄은 **그 장으로** 연다.

          한 줄짜리 행이었던 것을 **카드 셋씩**으로 바꿨다(요청·디자인): 행은 발췌를
          한 줄로 잘라 질의 주변이 `…`에 먹혔고, 경로도 문서 이름 하나뿐이라 공책의
          어느 장인지 말해 주지 못했다. 카드는 두 줄을 쓰고 경로를 통째로 담는다. */}
      {view.searchHits.length > 0 && (
        <div data-search-hits style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--mf-text)', letterSpacing: '-.01em' }}>내용에서 찾은 것</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mf-accent)' }}>{view.searchHits.length}</span>
            <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>
              &apos;{view.searchQuery}&apos; · 클릭하면 그 위치로 바로 열려요
            </span>
          </div>
          <div className="mf-hit-grid">
            {view.searchHits.map((h) => (
              <a
                key={h.key}
                href={h.href}
                data-search-hit={h.kind}
                onClick={(e) => {
                  e.preventDefault();
                  controller.openWithLoader(h.href, h.docTitle);
                }}
                className="mf-hit-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: '1px solid var(--mf-border-soft)',
                  background: 'var(--mf-card)',
                  textDecoration: 'none',
                  color: 'inherit',
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
                  {/* 경로 — `스페이스 › 공책 › 페이지`. 앞의 점은 **문서 종류 색**이라
                      제목을 읽기 전에 무엇인지가 먼저 들어온다. */}
                  <span data-search-hit-path title={pathOf(h)} style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mf-muted)', overflow: 'hidden' }}>
                    <span aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 999, background: DOC_INK[h.docKind], display: 'block' }} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pathOf(h)}</span>
                  </span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
                {/* 발췌 — 두 줄까지. 질의는 **형광펜**으로 긋는다(디자인): 행이 길어도
                    눈이 먼저 그 낱말에 닿아야 "왜 걸렸는지"가 한눈에 읽힌다. */}
                <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--mf-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all' }}>
                  <Marked text={h.snippet} query={view.searchQuery} />
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

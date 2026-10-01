// 모바일 검색 결과 — 데스크톱 결과 화면(`SearchResults`)과 **같은 데이터**를 줄 목록으로 편다.
//
// 데스크톱은 카드 그리드 + 「내용에서 찾은 것」 카드 셋씩이다. 폰 폭에서는 카드 한 장이 한 줄을
// 다 먹으니 처음부터 줄로 그린다: 위에 내용에서 걸린 줄(그 자리로 바로 연다), 아래에 스페이스별
// 묶음(폴더 · 문서). 누르는 규칙은 스페이스 화면과 같다(한 번 = 열기 · 길게 = 선택).

import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel, SearchHitViewData } from '../viewModel';
import { folderCardKey } from '../viewModel';
import { MONO_FONT } from '../chrome';
import { DocRow, usePress } from './cards';
import { Chevron, KIND_META, MSectionHead, kindOfCard } from './parts';
import type { FolderCardViewData } from '../viewModel';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
}

/** 발췌에서 질의만 형광펜으로 — 사용자가 쓴 글이라 HTML로 넣지 않고 조각으로 자른다. */
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

function HitRow({ hit, query, controller }: { hit: SearchHitViewData; query: string; controller: HomeController }) {
  const path = [hit.spaceName, hit.docTitle, hit.pageTitle].filter(Boolean).join(' › ');
  return (
    <a
      href={hit.href}
      data-search-hit={hit.kind}
      className="mf-m-press"
      onClick={(e) => {
        e.preventDefault();
        controller.openWithLoader(hit.href, hit.docTitle);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 4px', margin: '0 -4px', borderBottom: '1px solid var(--mf-m-line)', textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 11.5, color: 'var(--mf-m-mut2)' }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, flex: '0 0 auto', borderRadius: 99, background: KIND_META[hit.docKind].color, display: 'block' }} />
        <span style={{ flex: '0 0 auto', fontWeight: 800, color: 'var(--mf-m-ink2)' }}>{hit.kind}</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</span>
      </span>
      <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--mf-m-ink)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all' }}>
        <Marked text={hit.snippet} query={query} />
      </span>
    </a>
  );
}

function FolderRow({ folder, state, controller }: { folder: FolderCardViewData; state: HomeState; controller: HomeController }) {
  const key = folderCardKey(folder.id);
  const press = usePress(key, state, controller, () => (folder.isDrive ? controller.openDriveFolder(folder.id) : controller.openFolder(folder.id)));
  return (
    <button
      type="button"
      data-card-key={key}
      className="btn mf-m-press"
      {...press}
      style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '0 4px', margin: '0 -4px', border: 0, borderBottom: '1px solid var(--mf-m-line)', background: folder.selected ? 'var(--mf-accent-soft)' : 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', WebkitTouchCallout: 'none', userSelect: 'none' }}
    >
      <svg width="26" height="22" viewBox="0 0 24 24" fill="var(--mf-m-folder)" stroke="var(--mf-m-folder-ink)" strokeWidth={1.4} strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder.name}</span>
      <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: 'var(--mf-m-faint)' }}>{folder.count}</span>
      <Chevron />
    </button>
  );
}

export function MobileSearchResults({ state, view, controller }: Props) {
  if (view.searchEmpty) {
    return (
      <div data-search-empty style={{ padding: '48px 28px', textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', marginBottom: 8 }}>&apos;{view.searchQuery}&apos;에 맞는 문서가 없어요</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>모든 스페이스의 제목과 내용에서 찾았어요. 다른 낱말로 찾아보세요.</div>
      </div>
    );
  }
  return (
    <div data-search-results>
      <div data-search-notice style={{ padding: '0 20px 4px', fontSize: 12, color: 'var(--mf-m-mut2)' }}>
        문서 {view.searchCount}
        {view.searchHits.length > 0 && ` · 내용 ${view.searchHits.length}`}
        {view.searchLoading && ' · 내용에서 더 찾는 중…'}
      </div>
      {view.searchHits.length > 0 && (
        <section data-search-hits>
          <MSectionHead label="내용에서 찾은 것" count={view.searchHits.length} pad="14px 20px 2px" />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
            {view.searchHits.map((h) => (
              <HitRow key={h.key} hit={h} query={view.searchQuery} controller={controller} />
            ))}
          </div>
        </section>
      )}
      {view.searchGroups.map((g) => (
        <section key={g.spaceId} data-search-group={g.spaceName}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '20px 20px 4px', fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: g.spaceColor, display: 'block' }} />
            {g.spaceName}
            <span style={{ fontFamily: MONO_FONT, fontWeight: 600, color: 'var(--mf-m-faint2)' }}>{g.cards.length + g.folders.length}</span>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
            {g.folders.map((f) => (
              <FolderRow key={f.id} folder={f} state={state} controller={controller} />
            ))}
            {g.cards.map((c) => (
              <DocRow key={c.key} card={c} state={state} controller={controller} sub={[KIND_META[kindOfCard(c)].label, c.pathLabel].filter(Boolean).join(' · ')} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

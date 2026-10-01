// 모바일 「스페이스」 탭(모바일 홈 디자인 M2) — 데스크톱의 툴바 + 카드 그리드를 대신한다.
//
// 층은 상자가 아니라 **글자 크기와 가는 선**으로 나눈다(디자인): 큰 스페이스 이름 → 옅은
// 구획 머리 → 최근 항목 띠 → 폴더 네 열 → 공책 두 열 표지 → 보드 목록. 데스크톱의 큰 카드
// (썸네일 132px)를 그대로 줄이면 한 화면에 두 장밖에 들지 않는다.
//
// **한 번 누르면 연다**(디자인). 데스크톱은 한 번 = 선택 / 두 번 = 열기인데, 그 규칙은
// 카드마다 ☰이 있어 "골라 놓고 메뉴를 쓴다"가 성립할 때의 것이다. 여기에는 카드 메뉴가 없고
// 메뉴는 **길게 눌러 고른 뒤** 선택 바의 ⋯가 맡는다(기존 모바일 선택 모드 그대로).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { folderCardKey, type CardViewData, type FolderCardViewData, type HomeViewModel } from '../viewModel';
import { formatLastEdited } from '../timeFormat';
import { SelectionBar } from '../components/Toolbar';
import { MapGrid } from '../components/MapGrid';
import { BackGlyph, Glyph, KIND_META, M_ICON, MSectionHead, coverInk, kindOfCard, noteGrid } from './parts';
import { MobileSpaceSheet } from './MobileSpaceSheet';
import { MobileCreateSheet } from './MobileCreateSheet';
import { MobileSearchResults } from './MobileSearchResults';
import { DocRow, SelectMark, openCard, usePress } from './cards';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
}

/** 폴더는 두 줄(여덟 개)까지 먼저 보이고 나머지는 `N개 더`로 편다(디자인). */
const FOLDER_PEEK = 8;

/** 최근 항목 한 장(132×86) — 스페이스를 가로지르는 바로가기라 선택 대상이 아니다. */
function RecentTile({ card, controller }: { card: CardViewData; controller: HomeController }) {
  const kind = kindOfCard(card);
  const note = kind === 'note';
  const cover = card.note?.cover || KIND_META.note.color;
  const bar = note ? cover : KIND_META[kind].color;
  const sub = [KIND_META[kind].label, card.pathLabel].filter(Boolean).join(' · ');
  return (
    <a
      href={card.href}
      data-m-recent={card.key}
      className="mf-m-press"
      onClick={(e) => {
        e.preventDefault();
        openCard(controller, card);
      }}
      aria-label={`${card.title} · ${sub}`}
      style={{
        position: 'relative',
        flex: '0 0 auto',
        width: 132,
        height: 86,
        boxSizing: 'border-box',
        padding: '10px 12px 9px 14px',
        borderRadius: 12,
        backgroundColor: 'var(--mf-m-card)',
        backgroundImage: note ? noteGrid() : 'none',
        backgroundSize: '11px 11px',
        border: '1px solid var(--mf-m-card-line)',
        overflow: 'hidden',
        scrollSnapAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span aria-hidden="true" style={{ position: 'absolute', right: -1, top: 10, width: 5, height: 20, borderRadius: '3px 0 0 3px', background: bar, display: 'block' }} />
      <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.3, color: note ? coverInk(cover) : 'var(--mf-m-ink)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all', paddingRight: 6 }}>
        {card.title}
      </span>
      <span style={{ fontSize: 11, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
    </a>
  );
}

/** 폴더 그림(56×50) — 안에 문서가 있으면 종이가 꽂힌 모양(디자인). */
function FolderArt({ full }: { full: boolean }) {
  const ink = 'var(--mf-m-folder-ink)';
  return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M5 11a3 3 0 0 1 3-3h11.2a3 3 0 0 1 2.2 1l2.8 3H48a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder)" stroke={ink} strokeWidth="1.4" />
      {full ? (
        <>
          <rect x="14" y="4" width="24" height="26" rx="2.5" fill="var(--mf-m-card)" stroke={ink} strokeWidth="1.4" />
          <path d="M19 11h14M19 15.5h14M19 20h9" stroke="var(--mf-m-faint)" strokeWidth="1.4" />
          <path d="M5 21a3 3 0 0 1 3-3h40a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder-front)" stroke={ink} strokeWidth="1.4" />
          <rect x="11" y="25" width="14" height="4" rx="2" fill="var(--mf-accent)" />
        </>
      ) : (
        <path d="M5 18a3 3 0 0 1 3-3h40a3 3 0 0 1 3 3v23a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--mf-m-folder-front)" stroke={ink} strokeWidth="1.4" />
      )}
    </svg>
  );
}

function FolderTile({ folder, state, controller }: { folder: FolderCardViewData; state: HomeState; controller: HomeController }) {
  const key = folderCardKey(folder.id);
  const press = usePress(key, state, controller, () => (folder.isDrive ? controller.openDriveFolder(folder.id) : controller.openFolder(folder.id)));
  return (
    <button
      type="button"
      data-card-key={key}
      data-m-folder={folder.id}
      className="btn mf-m-press"
      aria-label={`${folder.name} 폴더 · ${folder.count}개`}
      aria-pressed={state.selectMode ? folder.selected : undefined}
      {...press}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 4px', border: 0, borderRadius: 12, background: folder.selected ? 'var(--mf-accent-soft)' : 'transparent', fontFamily: 'inherit', cursor: 'pointer', minWidth: 0, WebkitTouchCallout: 'none', userSelect: 'none' }}
    >
      {state.selectMode && <SelectMark on={folder.selected} side="right" />}
      <FolderArt full={folder.count > 0} />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mf-m-ink)', textAlign: 'center', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all', maxWidth: '100%' }}>{folder.name}</span>
    </button>
  );
}

/** 공책 표지(두 열 · 132px) — 데스크톱 표지와 같은 모눈·책갈피·표지색. */
function NoteTile({ card, state, controller }: { card: CardViewData; state: HomeState; controller: HomeController }) {
  const press = usePress(card.key, state, controller, () => openCard(controller, card));
  const n = card.note;
  const cover = n?.cover || KIND_META.note.color;
  const when = formatLastEdited(card.updatedAt);
  return (
    <a
      href={card.href}
      data-card-key={card.key}
      data-m-note={card.key}
      className="mf-m-press"
      aria-label={`${card.title} 공책`}
      aria-pressed={state.selectMode ? card.selected : undefined}
      {...press}
      style={{
        position: 'relative',
        height: 132,
        boxSizing: 'border-box',
        padding: '12px 14px 10px',
        borderRadius: 12,
        backgroundColor: card.selected ? 'var(--mf-accent-soft)' : 'var(--mf-m-card)',
        backgroundImage: noteGrid(),
        backgroundSize: '12px 12px',
        border: card.selected ? '1.5px solid var(--mf-accent)' : '1px solid var(--mf-m-card-line)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: '0 1px 0 rgba(46,42,38,.03)',
        textDecoration: 'none',
        color: 'inherit',
        WebkitTouchCallout: 'none',
        userSelect: 'none',
      }}
    >
      {state.selectMode && <SelectMark on={card.selected} />}
      <span aria-hidden="true" style={{ position: 'absolute', right: -1, top: 12, width: 5, height: 24, borderRadius: '3px 0 0 3px', background: cover, display: 'block' }} />
      <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.3, color: coverInk(cover), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all', paddingRight: 8, paddingLeft: state.selectMode ? 22 : 0 }}>{card.title}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {(n?.pageTitles ?? []).map((t, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mf-m-ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--mf-m-ink)', display: 'block', flex: '0 0 auto' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</span>
          </span>
        ))}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11, color: 'var(--mf-m-mut)' }}>
        <span>{n ? `${n.pageCount} 페이지` : ''}</span>
        <span style={{ fontSize: 10.5, color: 'var(--mf-m-faint)', whiteSpace: 'nowrap' }}>{when}</span>
      </span>
    </a>
  );
}

function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div data-m-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 28px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--mf-m-mut)', wordBreak: 'keep-all', marginBottom: action ? 20 : 0 }}>{body}</div>
      {action}
    </div>
  );
}

function SkeletonBody() {
  return (
    <div aria-busy="true" aria-label="스페이스를 불러오는 중" style={{ padding: '6px 20px' }}>
      <div className="mf-skel" style={{ height: 11, width: 64, borderRadius: 6, margin: '0 0 12px' }} />
      <div style={{ display: 'flex', gap: 10, overflow: 'hidden', marginBottom: 28 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mf-skel" style={{ flex: '0 0 auto', width: 132, height: 86, borderRadius: 12 }} />
        ))}
      </div>
      <div className="mf-skel" style={{ height: 11, width: 48, borderRadius: 6, margin: '0 0 12px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mf-skel" style={{ height: 132, borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}

export function MobileSpaceView({ state, view, controller }: Props) {
  const [spaceSheet, setSpaceSheet] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  // 검색은 머리 자리를 입력창이 대신한다 — 질의가 남아 있으면(다른 탭에 다녀와도) 그대로 연다.
  const [searchOpen, setSearchOpen] = useState(() => !!state.searchInput.trim());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searching = searchOpen || !!state.searchInput.trim();
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  // 폴더를 옮겨 다니면 펼침은 처음으로.
  useEffect(() => setFoldersOpen(false), [state.curFolder, state.activeSpace]);

  const activeSpace = state.spaces.find((sp) => sp.id === state.activeSpace);
  const spaceColor = activeSpace?.color || 'var(--mf-accent)';
  const inFolder = !!(view.curFolder || view.driveFolder);
  const folders = view.folderCards;
  const shownFolders = foldersOpen ? folders : folders.slice(0, FOLDER_PEEK);
  const closeSearch = () => {
    controller.setSearch('');
    setSearchOpen(false);
  };

  let header: ReactNode;
  if (state.selectMode) {
    header = (
      <div style={{ flex: '0 0 auto', padding: '6px 16px 0 20px' }}>
        <SelectionBar state={state} controller={controller} />
      </div>
    );
  } else if (searching) {
    header = (
      <div data-m-search style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 12px 20px' }}>
        <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 12px', borderRadius: 12, background: 'var(--mf-m-soft)', color: 'var(--mf-m-faint)' }}>
          <Glyph d={M_ICON.search} size={17} width={2.2} />
          <input
            ref={searchRef}
            className="mf-search-input"
            value={state.searchInput}
            onChange={(e) => controller.setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                controller.flushSearch();
                (e.currentTarget as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') closeSearch();
            }}
            onBlur={controller.flushSearch}
            placeholder="모든 스페이스에서 검색"
            aria-label="모든 스페이스에서 검색"
            type="search"
            name="mf-home-search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 16, color: 'var(--mf-m-ink)' }}
          />
        </label>
        <button type="button" className="btn" onClick={closeSearch} style={{ flex: '0 0 auto', height: 42, padding: '0 2px', border: 0, background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          취소
        </button>
      </div>
    );
  } else {
    header = (
      <div data-m-space-head style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 20px 12px' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mf-m-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inFolder ? view.activeSpaceName : '스페이스'}</span>
          {!state.loaded ? (
            <span className="mf-skel" aria-label="스페이스를 불러오는 중" style={{ display: 'block', height: 28, width: 150, borderRadius: 8, margin: '2px 0' }} />
          ) : inFolder ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, marginLeft: -10 }}>
              <button type="button" className="btn mf-m-press" data-m-folder-back onClick={controller.backToSpace} aria-label={`${view.parentTile?.name ?? view.activeSpaceName}(으)로 돌아가기`} style={{ width: 36, height: 36, flex: '0 0 auto', border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-m-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
                <BackGlyph size={22} width={2.4} />
              </button>
              <h1 style={{ margin: 0, minWidth: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{view.titleLeaf}</h1>
            </span>
          ) : (
            <button
              type="button"
              className="btn"
              data-m-space-title
              onClick={() => setSpaceSheet(true)}
              aria-haspopup="dialog"
              aria-label={`${view.activeSpaceName} · 스페이스 바꾸기`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%', border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
            >
              <span aria-hidden="true" style={{ width: 10, height: 10, flex: '0 0 auto', borderRadius: 3, background: spaceColor, display: 'block' }} />
              <h1 style={{ margin: 0, minWidth: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{view.activeSpaceName}</h1>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-m-faint)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
        </span>
        <button type="button" className="btn mf-m-press" data-m-search-open aria-label="검색" title="검색" onClick={() => setSearchOpen(true)} style={{ width: 40, height: 40, flex: '0 0 auto', marginRight: -8, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
          <Glyph d={M_ICON.search} size={21} width={2.2} />
        </button>
      </div>
    );
  }

  let body: ReactNode;
  if (searching && view.searchQuery) {
    body = <MobileSearchResults state={state} view={view} controller={controller} />;
  } else if (searching) {
    body = <div style={{ padding: '28px 24px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.65, color: 'var(--mf-m-mut)', wordBreak: 'keep-all' }}>모든 스페이스의 문서 제목과 내용에서 찾아요.</div>;
  } else if (view.loading) {
    body = <SkeletonBody />;
  } else if (view.isDriveSpace) {
    // Google Drive(데모 출처)는 데스크톱 그리드를 그대로 쓴다 — 연결 안내·열 수 없는 형식 같은
    // 그쪽만의 상태가 그 부품에 있다.
    body = (
      <div style={{ padding: '0 16px' }}>
        <MapGrid view={view} controller={controller} />
      </div>
    );
  } else {
    body = (
      <>
        {view.recentSectionVisible && !inFolder && (
          <section data-m-section="최근 항목">
            <MSectionHead label="최근 항목" pad="2px 20px 8px" trailing={<span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--mf-m-faint2)', whiteSpace: 'nowrap' }}>모든 스페이스에서</span>} />
            <div className="mf-m-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 20px 4px', scrollPadding: '0 20px', scrollSnapType: 'x proximity' }}>
              {view.recentCards.map((c) => (
                <RecentTile key={c.key} card={c} controller={controller} />
              ))}
            </div>
          </section>
        )}
        {folders.length > 0 && (
          <section data-m-section="폴더">
            <MSectionHead
              label="폴더"
              count={folders.length}
              pad={view.recentSectionVisible && !inFolder ? '22px 20px 8px' : '2px 20px 8px'}
              trailing={
                folders.length > FOLDER_PEEK ? (
                  <button type="button" className="btn" data-m-folders-more onClick={() => setFoldersOpen((v) => !v)} style={{ border: 0, background: 'transparent', padding: '4px 0', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--mf-m-mut)', cursor: 'pointer' }}>
                    {foldersOpen ? '접기' : `${folders.length - FOLDER_PEEK}개 더`}
                  </button>
                ) : undefined
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '2px 6px', padding: '0 12px' }}>
              {shownFolders.map((f) => (
                <FolderTile key={f.id} folder={f} state={state} controller={controller} />
              ))}
            </div>
          </section>
        )}
        {view.noteSectionVisible && (
          <section data-m-section="공책">
            <MSectionHead label="공책" count={view.noteCards.length} pad="18px 20px 8px" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, padding: '0 20px' }}>
              {view.noteCards.map((c) => (
                <NoteTile key={c.key} card={c} state={state} controller={controller} />
              ))}
            </div>
          </section>
        )}
        {view.boardSectionVisible && (
          <section data-m-section="보드">
            <MSectionHead label="보드" count={view.boardCards.length} pad="20px 20px 4px" />
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 20px' }}>
              {view.boardCards.map((c) => (
                <DocRow key={c.key} card={c} state={state} controller={controller} />
              ))}
            </div>
          </section>
        )}
        {view.isEmpty && (
          <EmptyState
            title="이 스페이스는 비어 있어요"
            body={
              <>
                공책 · 마인드맵 · 화이트보드 · 칸반 보드 중에서 골라
                <br />첫 문서를 만들어 보세요.
              </>
            }
            action={
              <button type="button" className="btn" onClick={() => setCreateOpen(true)} style={{ height: 44, padding: '0 20px', border: 0, borderRadius: 14, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' }}>
                새로 만들기
              </button>
            }
          />
        )}
        {view.folderEmpty && (
          <EmptyState
            title="이 폴더는 비어 있어요"
            body={
              <>
                문서를 길게 눌러 고른 뒤 ⋯에서
                <br />&apos;폴더로 이동&apos;을 고르면 이리 옮겨져요.
              </>
            }
          />
        )}
      </>
    );
  }

  const fab = !state.selectMode && !searching && !view.isDriveSpace && state.loaded;

  return (
    <div data-m-space style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--mf-m-bg)' }}>
      {header}
      <div className="mf-m-scroll" data-m-space-scroll style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 96 }}>
        {body}
      </div>
      {/* 가져오기 파일 고르기 — 시트의 `가져오기`가 이 입력을 누른다(데스크톱 툴바와 같은 ref). */}
      <input type="file" accept=".json,.md,.markdown,.txt" ref={controller.setImportRef} onChange={controller.onImportFile} style={{ display: 'none' }} aria-hidden="true" />
      {fab && (
        <button
          type="button"
          className="btn"
          data-m-fab
          aria-label="새로 만들기"
          title="새로 만들기"
          onClick={() => setCreateOpen(true)}
          style={{ position: 'absolute', right: 20, bottom: 18, zIndex: 2, width: 54, height: 54, border: 0, borderRadius: 17, background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px -12px rgba(46,42,38,.55)', cursor: 'pointer', padding: 0 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      <MobileSpaceSheet open={spaceSheet} onClose={() => setSpaceSheet(false)} state={state} controller={controller} />
      <MobileCreateSheet open={createOpen} onClose={() => setCreateOpen(false)} view={view} controller={controller} />
    </div>
  );
}

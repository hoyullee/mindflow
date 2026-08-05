import { useEffect, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { SettingsPopover } from './SettingsPopover';
import { SpaceRow } from './SpaceRow';
import { HOME_THEMES, HOME_THEME_KEYS } from '../theme';

/** How long the drawer's exit slide runs before the aside unmounts. Slightly
 * longer than the CSS transition (260ms, home.css `.mf-drawer`) so the last
 * frames aren't clipped. */
const DRAWER_EXIT_MS = 280;

/**
 * Google Drive 연동 LNB 항목 임시 숨김 (2026-07 사용자 요청). 연동 자체가
 * 아직 데모 수준(가짜 OAuth 모달)이라 실사용자에게 노출하지 않는다 —
 * 컨트롤러/뷰모델/모달 코드는 전부 남겨뒀으므로, 진짜 Drive 연동을 붙일 때
 * 이 플래그만 true로 되돌리면 된다.
 */
const SHOW_DRIVE_LNB = false;

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  /** M6: below 768px the LNB becomes an off-canvas drawer instead of a
   * permanent column — `isOpen`/`onClose` are ignored (and the aside renders
   * as the classic fixed column) when `isMobile` is false. */
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

/** Home.dc.html:70-177 `<aside>` — the LNB (spaces, Google Drive, favorites, trash). */
export function Sidebar({ state, view, controller, isMobile = false, isOpen = false, onClose }: Props) {
  // Desktop: always-visible 248px column. Mobile: hamburger-triggered overlay
  // drawer with a tap-to-dismiss backdrop, animated in two phases:
  //   `mounted` — the aside exists in the DOM (kept alive through the exit
  //   slide so closing animates instead of vanishing);
  //   `entered` — the on-screen state driving the CSS transition (transform/
  //   opacity). Opening mounts off-screen first, then flips `entered` on the
  //   next frame so the enter slide actually plays.
  // 색상 테마 목록 펼침 — 순수 표현 상태라 컨트롤러(이식된 dc 상태)에 두지 않는다.
  const [themeOpen, setThemeOpen] = useState(false);
  const [mounted, setMounted] = useState(isOpen);
  const [entered, setEntered] = useState(isOpen);
  useEffect(() => {
    if (!isMobile) return;
    if (isOpen) {
      setMounted(true);
      // Double rAF: the first frame paints the off-screen position, the second
      // starts the transition — a single rAF can coalesce into one style flush
      // (no animation).
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), DRAWER_EXIT_MS);
    return () => clearTimeout(t);
  }, [isMobile, isOpen]);

  // The drawer has no ✕ button (backdrop tap / left-swipe dismiss it), but
  // both are pointer-only gestures — Escape keeps a keyboard-reachable way to
  // close, since the backdrop is deliberately aria-hidden/decorative.
  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, isOpen, onClose]);

  if (isMobile && !mounted) return null;

  const asideStyle = isMobile
    ? ({
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 'min(80vw, 280px)',
        zIndex: 41,
        boxShadow: '0 0 32px rgba(0,0,0,.22)',
        transform: entered ? 'translateX(0)' : 'translateX(-105%)',
      } as const)
    : ({ width: 248, flex: '0 0 auto' } as const);

  return (
    <>
      {isMobile && (
        // Decorative tap-to-dismiss backdrop — intentionally not a `button`
        // (unreachable via keyboard, `aria-hidden`); the keyboard-accessible
        // "close" action is the Escape handler above. Fades with the drawer;
        // pointer events off while exiting so a stray tap can't hit a dying
        // backdrop.
        <div
          aria-hidden="true"
          onClick={onClose}
          className="mf-drawer-backdrop"
          style={{ position: 'fixed', inset: 0, background: 'rgba(33,24,17,.4)', zIndex: 40, opacity: entered ? 1 : 0, pointerEvents: entered ? 'auto' : 'none' }}
        />
      )}
      <aside
        className={isMobile ? 'mf-drawer' : undefined}
        style={{
          ...asideStyle,
          background: '#fff',
          borderRight: '1px solid var(--mf-border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 12px',
          overflow: 'hidden',
        }}
      >
        <SettingsPopover state={state} controller={controller} userInitial={view.userInitial} />

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#9c8b7e', padding: '14px 10px 8px' }}>스페이스</div>

      <div className="lnb-scroll" style={{ flex: '0 1 auto', minHeight: 60, overflowY: 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px' }}>
        {/* Until the workspace loads (`state.loaded`), show skeleton rows instead
            of the seed spaces — otherwise the default 일반 스페이스 flashes before the
            user's real space list arrives (matches the map grid's skeleton). */}
        {state.loaded ? (
          state.spaces.map((sp) => <SpaceRow key={sp.id} space={sp} state={state} controller={controller} />)
        ) : (
          <div aria-busy="true" aria-label="스페이스를 불러오는 중">
            {[62, 48, 70].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' }}>
                <span className="mf-skel" style={{ width: 15, height: 15, borderRadius: 5, flexShrink: 0 }} />
                <span className="mf-skel" style={{ height: 11, width: `${w}%`, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={controller.openNewSpace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.openNewSpace();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60', flexShrink: 0 }}
      >
        <span style={{ fontSize: 15, color: '#9c8b7e' }}>＋</span> 새 스페이스
      </div>

      {SHOW_DRIVE_LNB && (
        <div
          className="nav-item"
          role="button"
          tabIndex={0}
          onClick={controller.onDriveClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') controller.onDriveClick();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            minHeight: isMobile ? 44 : undefined,
            borderRadius: 9,
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: view.isDriveSpace ? 600 : 500,
            background: view.isDriveSpace ? 'var(--mf-accent-soft)' : 'transparent',
            color: view.isDriveSpace ? 'var(--mf-accent-strong)' : '#7c6d60',
          }}
        >
          <span style={{ width: 15, height: 15, borderRadius: 3, display: 'inline-block', background: view.connected ? '#34A853' : '#c9b8a9' }} />
          <span>Google Drive</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9c8b7e' }}>{view.connected ? '연결됨' : '연결'}</span>
        </div>
      )}

      {/* 공유받음 — 스페이스와 같은 "출처" 층에 둔다(즐겨찾기·휴지통은 내 문서를
          다르게 보는 관점이고, 이건 아예 다른 사람의 문서다). 항상 보이는 고정
          항목(사용자 결정) — 비어 있으면 즐겨찾기처럼 빈 안내를 편다. 이름을
          "공유받은 맵"이 아니라 "공유받음"으로 두는 이유: 앞으로 맵이 아닌 파일을
          공유받아도 어색하지 않게(범용 명칭, 사용자 결정). */}
      {view.sharedVisible && (
        <>
          <div
            className="nav-item"
            role="button"
            tabIndex={0}
            aria-expanded={state.sharedOpen}
            onClick={controller.toggleSharedList}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.toggleSharedList();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              minHeight: isMobile ? 44 : undefined,
              borderRadius: 9,
              cursor: 'pointer',
              fontSize: 13.5,
              fontWeight: 500,
              color: '#7c6d60',
              flexShrink: 0,
            }}
          >
            <SharedGlyph size={15} /> 공유받음
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#c9b8a9' }}>{view.sharedItems.length ? String(view.sharedItems.length) : ''}</span>
          </div>
          <div
            style={{
              overflow: 'hidden',
              flexShrink: 0,
              // 행 높이 × 개수 + 여유. 모바일은 터치 타겟 44px(M6)이라 행이 더 높다 —
              // 같은 수를 쓰면 마지막 행이 잘린다.
              maxHeight: state.sharedOpen ? `${Math.max(1, view.sharedItems.length) * (isMobile ? 46 : 34) + 12}px` : '0px',
              opacity: state.sharedOpen ? 1 : 0,
              transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
            }}
          >
            <div style={{ overflow: 'hidden', minHeight: 0 }}>
              {view.sharedItems.map((m) => (
                <div
                  key={m.docId}
                  className="drive-file"
                  role="button"
                  tabIndex={0}
                  onClick={() => controller.openWithLoader(m.href, m.title, m.docId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      controller.openWithLoader(m.href, m.title, m.docId);
                    }
                  }}
                  title={m.role === 'view' ? `'${m.title}' 열기 (보기 전용)` : `'${m.title}' 열기 (함께 편집)`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '6px 10px 6px 26px',
                    minHeight: isMobile ? 44 : undefined,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    color: '#5c4f44',
                  }}
                >
                  <MapMiniGlyph />
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                  {/* 편집 권한은 기본값이라 표시하지 않는다 — 예외인 '보기'만 알린다. */}
                  {m.role === 'view' && (
                    <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: 'rgba(63,143,208,.12)', color: '#2f6f9e' }}>보기</span>
                  )}
                </div>
              ))}
              {!view.loading && view.sharedItems.length === 0 && (
                <div style={{ padding: '7px 10px 7px 30px', fontSize: 11.5, color: '#c9b8a9' }}>공유받은 항목이 없습니다</div>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '12px 4px' }} />

      <div
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={controller.toggleFavList}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.toggleFavList();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60' }}
      >
        <StarGlyph size={15} /> 즐겨찾기
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#c9b8a9' }}>{view.favCount}</span>
      </div>
      <div
        style={{
          overflow: 'hidden',
          flexShrink: 0,
          maxHeight: state.favOpen ? `${Math.max(1, view.favItems.length) * 34 + 12}px` : '0px',
          opacity: state.favOpen ? 1 : 0,
          transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {view.favItems.map((f) => (
            <div
              key={f.title}
              className="drive-file"
              role="button"
              tabIndex={0}
              onClick={() => controller.openWithLoader(f.href, f.title, f.docId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  controller.openWithLoader(f.href, f.title, f.docId);
                }
              }}
              title={`'${f.title}' 열기`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px 4px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: '#5c4f44' }}
            >
              {/* Leading star = UNFAVORITE button (the row itself opens the map).
                  stopPropagation on click AND keydown — both would otherwise
                  bubble to the row's open handlers. */}
              <button
                type="button"
                className="btn mf-fav-unstar"
                aria-label={`'${f.title}' 즐겨찾기 해제`}
                title="즐겨찾기 해제"
                onClick={(e) => {
                  e.stopPropagation();
                  controller.toggleFav(f.title, f.docId);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: 'none', borderRadius: 7, background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
              >
                <StarGlyph size={12} />
              </button>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
              {f.isDrive && (
                <span style={{ flexShrink: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: 'rgba(52,168,83,.12)', color: '#1e7a3a' }}>Drive</span>
              )}
            </div>
          ))}
          {!view.loading && view.favItems.length === 0 && <div style={{ padding: '7px 10px 7px 30px', fontSize: 11.5, color: '#c9b8a9' }}>즐겨찾기한 항목이 없습니다</div>}
        </div>
      </div>

      <div
        className="nav-item mf-trash-head"
        role="button"
        tabIndex={0}
        onClick={controller.toggleTrashList}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.toggleTrashList();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60' }}
      >
        <TrashGlyph size={15} /> 휴지통
        {/* 비우기 sits BEFORE the count so the count stays at the far right —
            exactly where the favorites count sits — keeping the two numbers
            vertically aligned. It reveals on header hover/focus (always visible
            on touch), so at rest the header shows just the aligned count. */}
        {view.trashItems.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            className="mf-trash-empty"
            onClick={(e) => {
              // The header row toggles the list — the 비우기 action must not.
              e.stopPropagation();
              controller.askEmptyTrash();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.askEmptyTrash();
              }
            }}
            style={{ marginLeft: 'auto', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
          >
            비우기
          </span>
        )}
        <span style={{ marginLeft: view.trashItems.length > 0 ? 0 : 'auto', fontSize: 11, color: '#c9b8a9' }}>{view.trashCount}</span>
      </div>
      <div
        style={{
          overflow: 'hidden',
          flexShrink: 0,
          maxHeight: state.trashOpen ? `${Math.max(1, view.trashItems.length) * 34 + 12}px` : '0px',
          opacity: state.trashOpen ? 1 : 0,
          transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {view.trashItems.map((t) => (
            // Keyed by docId when present — the trash may hold two entries with
            // the same TITLE (different docs), which a title key would collapse.
            // Row anatomy: [type glyph] [title — takes ALL free width, ellipsis]
            // [restore ↺] [purge ✕]. The actions are icon-only 26px buttons
            // (labels live on aria-label/title, same treatment as the favorites
            // unstar star) — the old "복원"/"영구 삭제" text links ate most of the
            // 248px column and left titles nearly invisible. They reveal on row
            // hover/focus (always visible on touch — see home.css .mf-trash-act).
            <div key={t.docId || t.title} className="drive-file mf-trash-row" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 4px 28px', borderRadius: 8, fontSize: 12.5, color: '#8a7a6d' }}>
              {t.isDrive ? <FolderMiniGlyph /> : <MapMiniGlyph />}
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 2px 0 3px' }}>{t.title}</span>
              {t.isDrive && (
                <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(52,168,83,.12)', color: '#1e7a3a' }}>{t.badge}</span>
              )}
              <button
                type="button"
                aria-label={`'${t.title}' 복원`}
                title="복원"
                onClick={(e) => {
                  e.stopPropagation();
                  controller.askRestore(t.title, t.docId);
                }}
                className="btn restore-link mf-trash-act"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: 'none', borderRadius: 7, background: 'transparent', color: '#2f9e63', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 4 3 10 9 10" />
                  <path d="M5.4 15a8 8 0 1 0 1.9-8.3L3 10" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`'${t.title}' 영구 삭제`}
                title="영구 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  controller.askPurge(t.title, t.docId);
                }}
                className="btn purge-link mf-trash-act"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: 'none', borderRadius: 7, background: 'transparent', color: '#d64545', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          {!view.loading && view.trashItems.length === 0 && <div style={{ padding: '7px 10px 7px 30px', fontSize: 11.5, color: '#c9b8a9' }}>휴지통이 비어 있습니다</div>}
        </div>
      </div>

      {/* 피드백 보내기 — LNB 최하단 고정(사용자 요청: 프로필 메뉴에서 이동).
          `marginTop: auto`가 남는 공간을 밀어 올려 항상 바닥에 붙는다(공간이
          모자라면 휴지통 아래로 자연히 이어진다). 색상 테마도 같은 "설정" 층이라
          바로 위에 둔다. */}
      <div style={{ marginTop: 'auto', flexShrink: 0, paddingTop: 8 }}>
        <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '0 4px 8px' }} />

        {/* 색상 테마 — 펼치면 색 점이 나오고, 누르는 즉시 화면 색이 바뀐다(적용
            버튼 없음: 고르는 것이 곧 미리보기다). 공유받음·휴지통과 같은 접이식
            항목 꼴이라 LNB 안에서 새 문법을 만들지 않는다. */}
        <div
          className="nav-item"
          role="button"
          tabIndex={0}
          aria-label="색상 테마"
          aria-expanded={themeOpen}
          onClick={() => setThemeOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setThemeOpen((v) => !v);
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60' }}
        >
          <PaletteGlyph /> 색상 테마
          {/* 지금 색을 한 점으로 알려 준다 — 펼치지 않아도 무엇이 켜져 있는지 보인다. */}
          <span aria-hidden="true" style={{ marginLeft: 'auto', width: 13, height: 13, borderRadius: '50%', background: 'var(--mf-accent)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
        </div>
        {themeOpen && (
          <div role="radiogroup" aria-label="색상 테마 선택" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 10px 8px' }}>
            {HOME_THEME_KEYS.map((key) => {
              const t = HOME_THEMES[key];
              const on = state.theme === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${t.label} 테마`}
                  title={t.label}
                  onClick={() => controller.setTheme(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // 모바일은 44px 터치 타깃(다섯 개 + 간격이 248px LNB 안에 들어간다).
                    width: isMobile ? 40 : 28,
                    height: isMobile ? 40 : 28,
                    padding: 0,
                    border: 'none',
                    borderRadius: 9,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: 17,
                      height: 17,
                      borderRadius: '50%',
                      background: t.accent,
                      // 선택된 색은 흰 테두리 + 같은 색 링으로 "지금 이것"임을 알린다.
                      boxShadow: on ? `0 0 0 2px #fff, 0 0 0 3.5px ${t.accent}` : 'inset 0 0 0 1px rgba(0,0,0,.12)',
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}

        <div
          className="nav-item"
          role="button"
          tabIndex={0}
          aria-label="피드백 보내기"
          onClick={controller.openFeedback}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              controller.openFeedback();
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>{' '}
          피드백 보내기
        </div>
      </div>
    </aside>
    </>
  );
}

/** 색상 테마 항목의 팔레트 아이콘 — 다른 LNB 아이콘과 같은 라인 스타일 SVG.
 * `currentColor`라 행의 글자색(활성/비활성)을 그대로 따른다. */
function PaletteGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 21a9 9 0 1 1 9-9c0 1.66-1.34 3-3 3h-1.6a2 2 0 0 0-1.4 3.42c.39.39.39 1.02 0 1.41-.6.6-1.5 1.17-3 1.17Z" />
      <circle cx="7.4" cy="12.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.6" cy="8.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="7.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Favorites star — a crisp filled-gold SVG in place of the ★ glyph, so it
 * renders identically across platforms and sits with the other SVG nav icons
 * instead of a font-dependent emoji. */
function StarGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#e0a53c" stroke="#e0a53c" strokeWidth={1.4} strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </svg>
  );
}

/** "공유받은 맵" 아이콘 — 사람 + 나가는 화살표(공유). 스페이스/즐겨찾기와 같은
 * 라인 스타일 SVG이고, 색만 파랑 계열로 두어 "내 것이 아닌 출처"임을 알린다. */
function SharedGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#3f8fd0" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M15 21v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 19.4V21" />
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M17.5 11.5 21 8l-3.5-3.5" />
      <path d="M21 8h-6" />
    </svg>
  );
}

/** Tiny map glyph for trash rows (SVG per design-system §10 — replaces the 🗺
 * emoji, whose rendering varied by platform): a mini node diagram. */
function MapMiniGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b6a596" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="12" r="3" />
      <line x1="9" y1="12" x2="15" y2="7" />
      <line x1="9" y1="12" x2="15" y2="17" />
      <circle cx="18" cy="7" r="2.4" />
      <circle cx="18" cy="17" r="2.4" />
    </svg>
  );
}

/** Tiny folder glyph for Drive trash rows (replaces the 📁 emoji). */
function FolderMiniGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b6a596" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Trash-can — a line-style SVG (matching the editor's delete icon and the
 * muted nav tone) replacing the 🗑 emoji. */
function TrashGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9c8b7e" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

import { useEffect, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { SettingsPopover } from './SettingsPopover';
import { SpaceRow } from './SpaceRow';

/** How long the drawer's exit slide runs before the aside unmounts. Slightly
 * longer than the CSS transition (260ms, home.css `.mf-drawer`) so the last
 * frames aren't clipped. */
const DRAWER_EXIT_MS = 280;

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
          borderRight: '1px solid #ecdfd5',
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
            of the seed spaces — otherwise the default 일반 공간 flashes before the
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
        <span style={{ fontSize: 15, color: '#9c8b7e' }}>＋</span> 새 공간
      </div>

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
          background: view.isDriveSpace ? '#fdeee7' : 'transparent',
          color: view.isDriveSpace ? '#d9542f' : '#7c6d60',
        }}
      >
        <span style={{ width: 15, height: 15, borderRadius: 3, display: 'inline-block', background: view.connected ? '#34A853' : '#c9b8a9' }} />
        <span>Google Drive</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9c8b7e' }}>{view.connected ? '연결됨' : '연결'}</span>
      </div>

      <div style={{ height: 1, background: '#f0e6dd', margin: '12px 4px' }} />

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
              onClick={() => controller.openWithLoader(f.href, f.title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  controller.openWithLoader(f.href, f.title);
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
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={controller.toggleTrashList}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.toggleTrashList();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, color: '#7c6d60' }}
      >
        <TrashGlyph size={15} /> 휴지통
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#c9b8a9' }}>{view.trashCount}</span>
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
            <div key={t.title} className="drive-file" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px 7px 30px', borderRadius: 8, fontSize: 12.5, color: '#8a7a6d' }}>
              <span style={{ fontSize: 12 }}>{t.isDrive ? '📁' : '🗺'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: t.isDrive ? 'rgba(52,168,83,.12)' : '#f0e6dd', color: t.isDrive ? '#1e7a3a' : '#9c8b7e' }}>{t.badge}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  controller.askRestore(t.title, t.docId);
                }}
                className="restore-link"
                style={{ marginLeft: 'auto', fontSize: 11, color: '#3f8fd0', cursor: 'pointer', flexShrink: 0 }}
              >
                복원
              </span>
            </div>
          ))}
          {!view.loading && view.trashItems.length === 0 && <div style={{ padding: '7px 10px 7px 30px', fontSize: 11.5, color: '#c9b8a9' }}>휴지통이 비어 있습니다</div>}
        </div>
      </div>
    </aside>
    </>
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

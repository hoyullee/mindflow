import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { SettingsPopover } from './SettingsPopover';
import { SpaceRow } from './SpaceRow';

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
  // drawer (translateX off/on-screen) with a tap-to-dismiss backdrop.
  if (isMobile && !isOpen) return null;

  const asideStyle = isMobile
    ? ({
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: 'min(80vw, 280px)',
        zIndex: 41,
        boxShadow: '0 0 32px rgba(0,0,0,.22)',
      } as const)
    : ({ width: 248, flex: '0 0 auto' } as const);

  return (
    <>
      {isMobile && (
        // Decorative tap-to-dismiss backdrop — intentionally not a `button`
        // (unreachable via keyboard, `aria-hidden`); the actual accessible
        // "close" action is the ✕ button inside the drawer below.
        <div aria-hidden="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(33,24,17,.4)', zIndex: 40 }} />
      )}
      <aside
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
        {isMobile && (
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="메뉴 닫기"
            style={{ alignSelf: 'flex-end', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: '#7c6d60', fontSize: 20, cursor: 'pointer', marginBottom: 4 }}
          >
            ✕
          </button>
        )}
        <SettingsPopover state={state} controller={controller} userInitial={view.userInitial} />

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#9c8b7e', padding: '14px 10px 8px' }}>스페이스</div>

      <div className="lnb-scroll" style={{ flex: '0 1 auto', minHeight: 60, overflowY: 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px' }}>
        {state.spaces.map((sp) => (
          <SpaceRow key={sp.id} space={sp} state={state} controller={controller} />
        ))}
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
        <span style={{ fontSize: 15, color: '#e0a53c' }}>★</span> 즐겨찾기
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
            <div key={f.title} className="drive-file" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px 7px 30px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: '#5c4f44' }}>
              <span style={{ fontSize: 12, color: '#e0a53c', flexShrink: 0 }}>★</span>
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
        <span style={{ fontSize: 15 }}>🗑</span> 휴지통
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

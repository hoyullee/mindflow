import type { MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';

interface Props {
  state: HomeState;
  view: HomeViewModel;
  controller: HomeController;
  /** M6: mobile renders a hamburger button (opens the `Sidebar` drawer via
   * `onOpenNav`) and lets the trailing action cluster wrap to a second line
   * instead of relying on a single non-wrapping row. */
  isMobile?: boolean;
  onOpenNav?: () => void;
}

/** Home.dc.html:191-207 — the "모두" toolbar above the map grid. */
export function Toolbar({ state, view, controller, isMobile = false, onOpenNav }: Props) {
  const newHref = controller.newMapHref();

  const onNewMapClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    controller.onNewMapClick(e.currentTarget.getAttribute('href') || newHref);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
      {isMobile && (
        <button
          type="button"
          className="btn"
          onClick={onOpenNav}
          title="메뉴 열기"
          aria-label="메뉴 열기"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#7c6d60', cursor: 'pointer', padding: 0, flexShrink: 0 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      )}
      {view.backVisible && (
        <button
          className="btn"
          onClick={controller.backToSpace}
          title="공간으로 돌아가기"
          aria-label="공간으로 돌아가기"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobile ? 44 : 34, height: isMobile ? 44 : 34, border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#7c6d60', cursor: 'pointer', padding: 0, flexShrink: 0 }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>{view.spaceTitle}</h2>
      <div style={{ marginLeft: isMobile ? 0 : 'auto', width: isMobile ? '100%' : undefined, order: isMobile ? 3 : undefined, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {view.isDriveSpace && view.connected && (
          <div
            onClick={controller.disconnectDrive}
            role="button"
            tabIndex={0}
            className="drive-file"
            style={{ display: 'flex', alignItems: 'center', padding: '0 12px', height: isMobile ? 44 : 38, borderRadius: 10, border: '1px solid #ecdfd5', background: '#fff', fontSize: 12.5, color: '#9c8b7e', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            연결 해제
          </div>
        )}
        {view.importVisible && (
          <button
            className="btn"
            onClick={controller.openImport}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: isMobile ? 44 : 38, padding: '0 14px', border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>{' '}
            가져오기
          </button>
        )}
        <input type="file" accept=".json,.md,.markdown,.txt" ref={controller.setImportRef} onChange={controller.onImportFile} style={{ display: 'none' }} aria-hidden="true" />
        {view.newFolderVisible && (
          <button
            className="btn"
            onClick={controller.openNewFolder}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: isMobile ? 44 : 38, padding: '0 14px', border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>{' '}
            새 폴더
          </button>
        )}
        {/* Search + "새로 만들기" share one row. On mobile the row spans the full
            width (so it sits on its own line) with the search growing and the
            button keeping its size beside it — previously the search was
            `flex:1 1 100%`, which forced the button to wrap onto a lonely line
            below it. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: isMobile ? '100%' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: isMobile ? '1 1 auto' : undefined, width: isMobile ? undefined : 260, minWidth: 0, height: isMobile ? 44 : 38, padding: '0 12px', background: '#fff', border: '1px solid #ecdfd5', borderRadius: 10, color: '#9c8b7e' }}>
            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', color: '#9c8b7e' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            </span>
            <input
              value={state.search}
              onChange={(e) => controller.setSearch(e.target.value)}
              placeholder="파일 검색"
              aria-label="파일 검색"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13, width: '100%', minWidth: 0, color: '#33281f' }}
            />
          </div>
          <a
            href={newHref}
            onClick={onNewMapClick}
            className="btn"
            style={{ height: isMobile ? 44 : 38, padding: '0 16px', borderRadius: 10, background: '#33281f', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            ＋ 새로 만들기
          </a>
        </div>
      </div>
    </div>
  );
}

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

/** Upload-arrow glyph shared by the labeled (desktop) and icon-only (mobile)
 * "가져오기" buttons. */
function ImportGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** Folder-plus glyph shared by the labeled (desktop) and icon-only (mobile)
 * "새 폴더" buttons. */
function NewFolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

// Mobile toolbar: a 44×44 icon-only secondary button (white, bordered). The
// label moves to aria-label + title so the single action row fits a 360px
// phone with the search field still getting usable width.
const MOBILE_ICON_BTN = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  border: '1px solid #ecdfd5',
  borderRadius: 10,
  background: '#fff',
  color: '#33281f',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
} as const;

/**
 * 제목 줄. 폴더 안일 때 상위 경로(스페이스명)는 `…`로 접고 현재 폴더명만 보여 준다 —
 * "스페이스 / 폴더"를 그대로 쓰면 이름이 길 때 **두 줄로 접혀** 헤더 높이가 들썩였다
 * (제보). 폴더명 자체가 길어도 한 줄을 유지하고 말줄임한다. 접히거나 잘린 부분은
 * `title`(툴팁)과 `aria-label`(스크린리더)에 전체 경로로 남는다.
 *
 * 모바일에만 적용하지 않는 이유: 조건이 화면 폭이 아니라 "폴더 안인가"라서,
 * 데스크톱에서도 이름이 충분히 길면 똑같이 접혔다.
 */
function BreadcrumbTitle({ parent, leaf, full }: { parent: string | null; leaf: string; full: string }) {
  return (
    <h2
      // 툴팁은 폴더 안이 아니어도 붙인다 — 이제 최상위의 긴 스페이스명도 잘리므로
      // 전체를 확인할 방법이 필요하다.
      title={full}
      // `aria-label`은 폴더 안에서만. `…`는 정보를 실제로 지우지만, 잘린 텍스트는
      // CSS 말줄임이라 접근성 트리에는 전체가 그대로 남아 있어서 덧붙일 게 없다.
      aria-label={parent ? full : undefined}
      // `flex: 0 1 auto` — 늘어나지는 않으므로 데스크톱 레이아웃은 그대로고, 자리가
      // 모자랄 때만 줄어들어 말줄임으로 넘어간다. `minWidth: 0`이 없으면 flex 항목의
      // 기본 최소 크기가 콘텐츠라서 절대 줄어들지 않는다(= 말줄임이 안 걸린다).
      style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-.02em', display: 'flex', alignItems: 'baseline', gap: 6, flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap' }}
    >
      {parent && (
        // 접힌 상위 경로. 클릭 대상으로 만들지 않는다 — 왼쪽 화살표 버튼이 이미
        // "공간으로 돌아가기"를 담당하므로 같은 동작의 버튼이 둘이 되지 않게.
        <span aria-hidden="true" style={{ color: '#9c8b7e', fontWeight: 700, flexShrink: 0 }}>
          … /
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{leaf}</span>
    </h2>
  );
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
      {/* ≡ · ← · 제목은 한 덩어리다. 따로 두면 제목이 길 때 flex-wrap이 제목 항목을
          통째로 다음 줄로 내려서(줄어들기 전에 줄바꿈이 먼저 일어난다) 모바일 헤더가
          "버튼 줄 / 제목 줄 / 검색 줄" 세 줄로 늘어졌다. 묶어 두면 이 덩어리가 한 줄을
          지키고 그 안에서 제목만 말줄임된다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 auto', minWidth: 0 }}>
        {isMobile && (
          // Ghost app-bar button (no border/box) so "≡ + 스페이스명" reads as ONE
          // header unit instead of a floating control pushing the title aside.
          // The negative margin lines the glyph up with the content's left edge
          // while the hit area stays a full 44px (§7).
          <button
            type="button"
            className="btn"
            onClick={onOpenNav}
            title="메뉴 열기"
            aria-label="메뉴 열기"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginLeft: -12, marginRight: -6, border: 'none', borderRadius: 10, background: 'transparent', color: '#33281f', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
        {/* Skeleton the space title until the workspace loads, so the seed
            일반 공간 name doesn't flash before the real space name arrives
            (matches the LNB space-list skeleton). */}
        {state.loaded ? (
          <BreadcrumbTitle parent={view.titleParent} leaf={view.titleLeaf} full={view.spaceTitle} />
        ) : (
          <div className="mf-skel" aria-label="스페이스를 불러오는 중" style={{ height: 24, width: 150, borderRadius: 7, margin: '3px 0' }} />
        )}
      </div>
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
        {/* Desktop keeps the labeled 가져오기/새 폴더 buttons; on mobile they move
            INTO the single action row below as 44px icon-only buttons — the
            labeled pair used to wrap onto a lonely line of its own. */}
        {!isMobile && view.importVisible && (
          <button
            className="btn"
            onClick={controller.openImport}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px', border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <ImportGlyph /> 가져오기
          </button>
        )}
        <input type="file" accept=".json,.md,.markdown,.txt" ref={controller.setImportRef} onChange={controller.onImportFile} style={{ display: 'none' }} aria-hidden="true" />
        {!isMobile && view.newFolderVisible && (
          <button
            className="btn"
            onClick={controller.openNewFolder}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px', border: '1px solid #ecdfd5', borderRadius: 10, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <NewFolderGlyph /> 새 폴더
          </button>
        )}
        {/* THE action row: search + (mobile: icon-only 가져오기/새 폴더) + 새로 만들기.
            On mobile it spans the full width on its own line; every action lives
            here so nothing wraps onto a stray second line. Icon-only buttons keep
            44px touch targets and carry their label via aria-label/title. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, width: isMobile ? '100%' : undefined }}>
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
          {isMobile && view.importVisible && (
            <button className="btn" onClick={controller.openImport} aria-label="가져오기" title="가져오기" style={MOBILE_ICON_BTN}>
              <ImportGlyph />
            </button>
          )}
          {isMobile && view.newFolderVisible && (
            <button className="btn" onClick={controller.openNewFolder} aria-label="새 폴더" title="새 폴더" style={MOBILE_ICON_BTN}>
              <NewFolderGlyph />
            </button>
          )}
          <a
            href={newHref}
            onClick={onNewMapClick}
            className="btn"
            aria-label={isMobile ? '새로 만들기' : undefined}
            title={isMobile ? '새로 만들기' : undefined}
            style={{ height: isMobile ? 44 : 38, width: isMobile ? 44 : undefined, justifyContent: 'center', padding: isMobile ? 0 : '0 16px', borderRadius: 10, background: '#33281f', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {isMobile ? (
              // Icon-only primary: the dark pill + plus reads as "create" without
              // a label, freeing the row for the search field on small phones.
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            ) : (
              '＋ 새로 만들기'
            )}
          </a>
        </div>
      </div>
    </div>
  );
}

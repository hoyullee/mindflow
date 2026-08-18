import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { HomeViewModel } from '../viewModel';
import { UNREAD_BADGE_BG } from '../theme';
import { META_MONO, pillStyle, primaryPillStyle, roundIconStyle } from '../chrome';
import { NotificationBell } from './NotificationBell';

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
      style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-.03em', display: 'flex', alignItems: 'baseline', gap: 6, flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap' }}
    >
      {parent && (
        // 접힌 상위 경로. 클릭 대상으로 만들지 않는다 — 왼쪽 화살표 버튼이 이미
        // "공간으로 돌아가기"를 담당하므로 같은 동작의 버튼이 둘이 되지 않게.
        <span aria-hidden="true" style={{ color: 'var(--mf-muted)', fontWeight: 700, flexShrink: 0 }}>
          … /
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{leaf}</span>
    </h2>
  );
}

/**
 * 모바일 선택 모드의 툴바 — 평소 툴바(제목·검색·만들기)를 **대체**한다.
 *
 * 하단 고정 바를 새로 만들지 않은 이유: 그 자리는 설치 안내·오프라인 바가 이미
 * 쓰고 있어 셋이 겹친다. 지금 무엇을 고르고 있는지는 화면 맨 위가 말하는 편이
 * 자연스럽고(파일 앱 관례), 검색·만들기는 그 시간대에 할 일이 아니다.
 */
function SelectionBar({ state, controller }: { state: HomeState; controller: HomeController }) {
  const n = state.selectedCards.length;
  const anchor = state.selectedCard ?? state.selectedCards[n - 1] ?? null;
  const btn = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    height: 44,
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: 'var(--mf-text)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '0 10px',
    flexShrink: 0,
  } as const;
  return (
    <div className="mf-sel-bar" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, minWidth: 0 }}>
      <button type="button" className="btn" onClick={controller.exitSelectMode} aria-label="선택 종료" title="선택 종료" style={{ ...btn, marginLeft: -12 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}개 선택</div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
        <button type="button" className="btn" onClick={controller.selectAllCards} style={btn}>
          전체 선택
        </button>
        {/* ⋯ — 데스크톱 우클릭과 **같은** 메뉴다(`HomeContextMenu`). 한 장만 골랐으면
            그 카드의 단일 메뉴가, 여러 장이면 일괄 메뉴가 뜬다(기존 라우팅 그대로). */}
        <button
          type="button"
          className="btn"
          data-sel-menu
          aria-label="선택한 맵 메뉴"
          title="메뉴"
          onClick={(e) => {
            if (!anchor) return;
            const r = e.currentTarget.getBoundingClientRect();
            controller.openCtxMenu(r.right - 184, r.bottom + 6, { kind: 'map', key: anchor });
          }}
          style={btn}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="19" cy="12" r="1.9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * 스페이스 헤더 줄 — 디자인 원본(`Geurio 홈 리디자인.dc.html`)의 툴바 이식.
 *
 * 왼쪽은 "여기가 어디인가"(스페이스 색 사각 + 이름 + 개수), 오른쪽은 도구 묶음이다.
 * 묶음의 순서는 디자인 원본 그대로 **알림 · 검색 · | · 가져오기 · 새 폴더 · 새로 만들기**
 * — 읽는 동작(알림·검색)이 먼저, 만드는 동작이 뒤로 가고 그 사이를 세로선이 가른다.
 * 모두 32px 높이의 알약이라 한 줄에서 눈금이 맞는다(모바일은 44px 터치 타깃 유지).
 */
export function Toolbar({ state, view, controller, isMobile = false, onOpenNav }: Props) {
  // 선택 모드(모바일 전용)에서는 툴바 자리를 선택 바가 쓴다.
  if (isMobile && state.selectMode) return <SelectionBar state={state} controller={controller} />;
  const activeSpace = state.spaces.find((sp) => sp.id === state.activeSpace);
  const spaceDot = activeSpace?.color || 'var(--mf-accent)';
  // 개수는 지금 화면에 그려지는 것과 같은 목록에서 센다(뷰모델을 손대지 않는다).
  const meta = `맵 ${view.allCards.length}개 · 폴더 ${view.folderCards.length}개`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, gap: isMobile ? 12 : 14, flexWrap: 'wrap' }}>
      {/* ≡ · 제목은 한 덩어리다. 따로 두면 제목이 길 때 flex-wrap이 제목 항목을
          통째로 다음 줄로 내려서(줄어들기 전에 줄바꿈이 먼저 일어난다) 모바일 헤더가
          "버튼 줄 / 제목 줄 / 검색 줄" 세 줄로 늘어졌다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto', minWidth: 0 }}>
        {isMobile && (
          // Ghost app-bar button (no border/box) so "≡ + 스페이스명" reads as ONE
          // header unit instead of a floating control pushing the title aside.
          <button
            type="button"
            className="btn"
            onClick={onOpenNav}
            title={view.sharedUnread > 0 ? `메뉴 열기 (새 공유 ${view.sharedUnread}개)` : '메뉴 열기'}
            aria-label={view.sharedUnread > 0 ? `메뉴 열기, 확인하지 않은 공유 ${view.sharedUnread}개` : '메뉴 열기'}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginLeft: -12, marginRight: -6, border: 'none', borderRadius: 10, background: 'transparent', color: 'var(--mf-text)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
            {/* 폰에서는 LNB가 서랍이라 그 안의 배지가 보이지 않는다 — 알림이 닫힌
                문 뒤에 있으면 알림이 아니다. 문에도 점을 찍는다. */}
            {view.sharedUnread > 0 && (
              <span
                data-unread-dot
                aria-hidden="true"
                style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: UNREAD_BADGE_BG, border: '2px solid var(--mf-bg)' }}
              />
            )}
          </button>
        )}
        {/* 스페이스 색 사각 — 사이드바 목록의 점과 같은 색이라 "지금 이 스페이스"가
            제목을 읽지 않고도 연결된다(디자인 원본). 검색 중에는 제목이 '검색'이라
            가리킬 스페이스가 없어 띄우지 않는다. */}
        {state.loaded && !view.searchQuery && (
          <span
            data-space-swatch
            aria-hidden="true"
            style={{ width: 11, height: 11, borderRadius: 4, background: spaceDot, flex: '0 0 auto', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)' }}
          />
        )}
        {/* Skeleton the space title until the workspace loads, so the seed
            일반 스페이스 name doesn't flash before the real space name arrives. */}
        {state.loaded ? (
          <BreadcrumbTitle parent={view.titleParent} leaf={view.titleLeaf} full={view.spaceTitle} />
        ) : (
          <div className="mf-skel" aria-label="스페이스를 불러오는 중" style={{ height: 24, width: 150, borderRadius: 7, margin: '3px 0' }} />
        )}
        {/* 개수 — 등폭으로 곁들인다(디자인 원본의 "8 boards · 1 folder"). 폴더 안이나
            검색 중에는 세는 대상이 달라지므로 띄우지 않는다. */}
        {!isMobile && state.loaded && !view.searchQuery && !view.curFolder && (
          <span data-space-meta style={{ ...META_MONO, fontSize: 11, paddingTop: 2, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {meta}
          </span>
        )}
        {/* 모바일 알림 센터 — 액션 줄은 이미 꽉 차 있어(검색+아이콘 3개) 제목 줄의
            오른쪽 끝에 둔다(앱 바 관례). 데스크톱 벨은 아래 묶음의 맨 앞에 있다. */}
        {isMobile && (
          <div style={{ marginLeft: 'auto' }}>
            <NotificationBell isMobile />
          </div>
        )}
      </div>
      <div style={{ marginLeft: isMobile ? 0 : 'auto', width: isMobile ? '100%' : undefined, order: isMobile ? 3 : undefined, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* 알림 센터(종) — 읽는 동작이라 검색과 나란히 묶음의 맨 앞에 선다. */}
        {!isMobile && <NotificationBell />}
        {view.isDriveSpace && view.connected && (
          <div
            onClick={controller.disconnectDrive}
            role="button"
            tabIndex={0}
            className="drive-file"
            style={{ ...pillStyle(isMobile), color: 'var(--mf-muted)', fontWeight: 600 }}
          >
            연결 해제
          </div>
        )}
        <input type="file" accept=".json,.md,.markdown,.txt" ref={controller.setImportRef} onChange={controller.onImportFile} style={{ display: 'none' }} aria-hidden="true" />
        {/* 검색 → | → 가져오기 → 새 폴더 → 새로 만들기.
            모바일에서는 이 묶음이 한 줄을 통째로 쓰고, 가져오기·새 폴더는 라벨을
            떼어 44px 아이콘 버튼이 된다(좁은 폭에서 검색이 쓸 폭을 남긴다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: isMobile ? '100%' : undefined }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              flex: isMobile ? '1 1 auto' : undefined,
              width: isMobile ? undefined : 200,
              minWidth: 0,
              height: isMobile ? 44 : 32,
              padding: '0 12px',
              background: 'var(--mf-panel)',
              border: '1px solid var(--mf-border)',
              borderRadius: 999,
              color: 'var(--mf-muted)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--mf-faint)', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.5" y2="16.5" />
              </svg>
            </span>
            <input
              // 보여 주는 값은 즉시값(`searchInput`) — 적용은 잠깐 뒤에 된다
              // (`setSearch`의 디바운스). Enter/포커스 아웃은 기다리지 않는다.
              value={state.searchInput}
              onChange={(e) => controller.setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') controller.flushSearch();
                if (e.key === 'Escape') controller.setSearch('');
              }}
              onBlur={controller.flushSearch}
              // 범위는 전 스페이스다 — 자리가 말해 주지 못하는 것을 문구가 말한다
              // (결과 화면의 헤더와 스페이스별 묶음이 그것을 다시 확인해 준다).
              placeholder="모든 스페이스에서 검색"
              aria-label="모든 스페이스에서 검색"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 12.5, width: '100%', minWidth: 0, color: 'var(--mf-text)' }}
            />
            {!!state.searchInput.trim() && (
              <button
                type="button"
                className="btn"
                data-search-clear
                aria-label="검색 지우기"
                title="검색 지우기 (Esc)"
                onClick={() => controller.setSearch('')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          {/* 읽는 동작과 만드는 동작을 가르는 세로선(디자인 원본). 좁은 화면에서는
              묶음이 접히므로 선이 뜻을 잃어 띄우지 않는다. */}
          {!isMobile && <span data-toolbar-divider aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--mf-border)', display: 'block', flexShrink: 0, margin: '0 2px' }} />}
          {view.importVisible && (
            // 가져오기는 데스크톱에서도 **아이콘만**이다(디자인 원본) — 자주 쓰는
            // 동작이 아니라 라벨 자리를 검색·만들기에 내준다.
            <button className="btn" onClick={controller.openImport} aria-label="가져오기" title="가져오기" style={roundIconStyle(isMobile)}>
              <ImportGlyph />
            </button>
          )}
          {view.newFolderVisible &&
            (isMobile ? (
              <button className="btn" onClick={controller.openNewFolder} aria-label="새 폴더" title="새 폴더" style={roundIconStyle(true)}>
                <NewFolderGlyph />
              </button>
            ) : (
              <button className="btn" onClick={controller.openNewFolder} style={pillStyle(false)}>
                <NewFolderGlyph /> 새 폴더
              </button>
            ))}
          {/* 링크가 아니라 버튼이다 — 누르면 템플릿 갤러리가 열리고, 어떤 맵을 만들지는
              거기서 정해진다(주소를 미리 알 수 없다). */}
          <button
            type="button"
            onClick={controller.openTemplates}
            className="btn"
            aria-label={isMobile ? '새로 만들기' : undefined}
            title={isMobile ? '새로 만들기' : undefined}
            style={primaryPillStyle(isMobile)}
          >
            <svg width={isMobile ? 18 : 14} height={isMobile ? 18 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {!isMobile && '새로 만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}

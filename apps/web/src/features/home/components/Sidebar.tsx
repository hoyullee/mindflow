import { useEffect, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { DocKindName, HomeViewModel } from '../viewModel';
import { UNREAD_BADGE_BG, UNREAD_BADGE_INK } from '../theme';
import { SettingsPopover } from './SettingsPopover';
import { DashboardSection, ReorderToggle } from './DashboardSection';
import { SpaceRow } from './SpaceRow';
import { META_MONO, SECTION_LABEL } from '../chrome';

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

/** LNB 구획 구분선 — 세 줄(스페이스↔즐겨찾기 / 공유받음↔휴지통 / 피드백 위)이
 * **같은 값**을 쓴다. 굵기가 달라 보인다는 제보의 원인은 `flexShrink`였다: 기본값
 * 1이면 세로 공간이 빠듯할 때 1px 선이 0.x px로 눌려 더 옅게 그려진다(사이드바는
 * flex 열이다). 눌리지 않게 0으로 못박는다 — 선은 줄어들 수 있는 여백이 아니다. */
const LNB_DIVIDER = { height: 1, background: 'var(--mf-border-soft)', flexShrink: 0 } as const;

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
    : // 디자인 원본의 250은 content-box(+패딩 24 +테두리 1 = 실측 274)다 — 우리는
      // border-box라 같은 겉폭이 되도록 274로 둔다(요청: LNB를 디자인 폭으로).
      ({ width: 274, flex: '0 0 auto' } as const);

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
        // LNB 우클릭: 메뉴가 있는 건 **스페이스 행 하나**뿐이고(그 행이 직접 처리하고
        // 전파를 끊는다), 나머지(즐겨찾기·휴지통·공유받음·피드백)에는 항목 단위
        // 동작이 없다. 그래서 여기서는 브라우저 기본 메뉴만 막는다 — 본문(`main`)이
        // 이미 우클릭을 앱 메뉴로 쓰고 있어서, LNB만 브라우저 메뉴가 뜨면 같은 화면
        // 안에서 우클릭의 뜻이 갈린다(사용자 요청).
        onContextMenu={(e) => {
          const t = e.target as HTMLElement;
          // 입력창 위에서는 붙여넣기 등 기본 메뉴가 맞다(지금은 없지만 앞으로를 위해).
          if (t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
          e.preventDefault();
        }}
        style={{
          ...asideStyle,
          // 디자인 원본의 aside 배경 #FFFDFB = 카드 면(--mf-card) — 순백(--mf-panel)이
          // 아니라 본문 카드와 같은 따뜻한 면이다(요청 ②).
          background: 'var(--mf-card)',
          borderRight: '1px solid var(--mf-border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 12px 12px',
          overflow: 'hidden',
        }}
      >
        <SettingsPopover state={state} controller={controller} userInitial={view.userInitial} />

      {/* 대시보드 구획 — 스페이스 위(디자인 원본의 순서). 요청 범위: 기존 홈 디자인에
          더하는 것은 이 구획과 스페이스 정렬 토글뿐이다. */}
      <DashboardSection state={state} controller={controller} isMobile={isMobile} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 9px 7px' }}>
        <span style={SECTION_LABEL}>스페이스</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {state.spaceReorder && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--mf-accent-strong)', whiteSpace: 'nowrap' }}>끌어서 이동</span>}
          <ReorderToggle on={state.spaceReorder} label="스페이스 순서 바꾸기" onClick={controller.toggleSpaceReorder} />
        </span>
      </div>

      {/* 목록 높이는 **내용이 정한다** — 예전에는 `minHeight: 60`이라 스페이스가
          하나일 때(행 ~40px) 남는 20px이 '새 스페이스'와의 빈칸으로 보였다(제보:
          둘일 때보다 간격이 넓다). 넘칠 때 스크롤되는 것은 그대로다. */}
      <div className="lnb-scroll" style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', margin: '0 -4px', padding: '0 4px' }}>
        {/* Until the workspace loads (`state.loaded`), show skeleton rows instead
            of the seed spaces — otherwise the default 일반 스페이스 flashes before the
            user's real space list arrives (matches the map grid's skeleton). */}
        {state.loaded ? (
          state.spaces.map((sp, idx) => <SpaceRow key={sp.id} space={sp} state={state} controller={controller} index={idx} total={state.spaces.length} />)
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
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', marginTop: 2, minHeight: isMobile ? 44 : undefined, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--mf-muted)', flexShrink: 0 }}
      >
        {/* 글리프(＋)는 글자가 아니라 선 아이콘으로 — 사이드바의 다른 항목들과 같은
            언어를 쓴다(디자인 원본). */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M12 5v14M5 12h14" />
        </svg>
        새 스페이스
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
            color: view.isDriveSpace ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
          }}
        >
          <span style={{ width: 15, height: 15, borderRadius: 3, display: 'inline-block', background: view.connected ? '#34A853' : 'var(--mf-faint2)' }} />
          <span>Google Drive</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mf-muted)' }}>{view.connected ? '연결됨' : '연결'}</span>
        </div>
      )}

      <div data-lnb-divider style={{ ...LNB_DIVIDER, margin: '12px 4px' }} />

      <div
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={controller.toggleFavList}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.toggleFavList();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', minHeight: isMobile ? 44 : undefined, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--mf-subtext)' }}
      >
        <StarGlyph size={15} /> 즐겨찾기
        <span style={{ ...META_MONO, marginLeft: 'auto' }}>{view.favCount}</span>
        <ChevronGlyph open={state.favOpen} />
      </div>
      <div
        style={{
          overflow: 'hidden',
          flexShrink: 0,
          maxHeight: state.favOpen ? `${Math.max(1, view.favItems.length) * (isMobile ? 46 : 38) + 30}px` : '0px',
          opacity: state.favOpen ? 1 : 0,
          transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
        }}
      >
        {/* 펼친 목록은 **가라앉은 판** 안에 든다(디자인 원본의 리스트 패널 —
            #FBF6F1 ≈ --mf-bg, 테두리 #F2E8DE ≈ --mf-hairline). */}
        <div style={{ overflow: 'hidden', minHeight: 0, margin: '2px 2px 4px', padding: '6px 6px 5px', borderRadius: 12, background: 'var(--mf-bg)', border: '1px solid var(--mf-hairline)' }}>
          {view.favItems.map((f) => (
            <div
              key={f.title}
              className="drive-file mf-trash-row"
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
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, color: 'var(--mf-subtext)' }}
            >
              {/* 종류 아이콘(맵·보드·칸반) — 홈 카드 배지의 점 색과 같은 토큰이라
                  배지·아이콘이 같은 색으로 같은 종류를 가리킨다(요청 ⑥). 해제(★)는
                  트래시 행의 동작처럼 hover에서 오른쪽에 드러난다. */}
              <KindMiniGlyph kind={f.kind} />
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
              {f.isDrive && (
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: 'rgba(52,168,83,.12)', color: 'var(--mf-success-ink)' }}>Drive</span>
              )}
              <button
                type="button"
                className="btn mf-fav-unstar mf-trash-act"
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
            </div>
          ))}
          {!view.loading && view.favItems.length === 0 && <div style={{ padding: '6px 7px', fontSize: 11.5, color: 'var(--mf-faint2)' }}>즐겨찾기한 항목이 없습니다</div>}
        </div>
      </div>

      {/* 공유받음 — **즐겨찾기 아래**에 둔다(요청). 셋(즐겨찾기·공유받음·휴지통)이
          같은 꼴의 접이식 목록이라 한자리에 모이는 편이 읽기 쉽다. 이름을 "공유받은
          맵"이 아니라 "공유받음"으로 두는 이유: 앞으로 맵이 아닌 파일을 공유받아도
          어색하지 않게(범용 명칭, 사용자 결정). */}
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
              // 디자인 원본의 사이드바 행 — 8/9 패딩 · r10 · 13px.
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 9px',
              minHeight: isMobile ? 44 : undefined,
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--mf-subtext)',
              flexShrink: 0,
            }}
          >
            <SharedGlyph size={15} /> 공유받음
            {/* 아직 확인하지 않은 초대가 있으면 **알림 배지**(강조색 알약), 없으면
                지금까지처럼 총 개수. 숫자를 두 개 보여 주면 무엇이 새것인지 흐려진다. */}
            {view.sharedUnread > 0 ? (
              <span
                aria-label={`확인하지 않은 공유 ${view.sharedUnread}개`}
                style={{
                  marginLeft: 'auto',
                  minWidth: 18,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: UNREAD_BADGE_BG,
                  color: UNREAD_BADGE_INK,
                  fontSize: 10.5,
                  fontWeight: 800,
                  textAlign: 'center',
                }}
              >
                {view.sharedUnread}
              </span>
            ) : (
              <span style={{ ...META_MONO, marginLeft: 'auto' }}>{view.sharedItems.length ? String(view.sharedItems.length) : ''}</span>
            )}
            <ChevronGlyph open={state.sharedOpen} />
          </div>
          <div
            style={{
              overflow: 'hidden',
              flexShrink: 0,
              // 행 높이 × 개수 + 판 여백. 모바일은 터치 타겟 44px(M6)이라 행이 더 높다 —
              // 같은 수를 쓰면 마지막 행이 잘린다.
              maxHeight: state.sharedOpen ? `${Math.max(1, view.sharedItems.length) * (isMobile ? 46 : 38) + 30}px` : '0px',
              opacity: state.sharedOpen ? 1 : 0,
              transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
            }}
          >
            {/* 즐겨찾기·휴지통과 같은 가라앉은 판(요청) — 같은 종류의 목록이므로
                같은 옷을 입힌다. */}
            <div style={{ overflow: 'hidden', minHeight: 0, margin: '2px 2px 4px', padding: '6px 6px 5px', borderRadius: 12, background: 'var(--mf-bg)', border: '1px solid var(--mf-hairline)' }}>
              {view.sharedItems.map((m) => (
                <div
                  key={m.docId}
                  className="drive-file mf-trash-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => controller.openSharedMap(m.href, m.title, m.docId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      controller.openSharedMap(m.href, m.title, m.docId);
                    }
                  }}
                  title={m.role === 'view' ? `'${m.title}' 열기 (보기 전용)` : `'${m.title}' 열기 (함께 편집)`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 7px',
                    minHeight: isMobile ? 44 : undefined,
                    borderRadius: 9,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    color: 'var(--mf-subtext)',
                  }}
                >
                  <KindMiniGlyph kind={m.kind} />
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: m.isNew ? 700 : undefined, color: m.isNew ? 'var(--mf-text)' : undefined }}>{m.title}</span>
                  {/* 아직 안 열어 본 초대 — 어느 것이 새것인지 점으로 짚어 준다
                      (헤더 배지는 개수만 말한다). 열면 사라진다. */}
                  {m.isNew && <span aria-label="새로 공유됨" title="아직 열어 보지 않은 공유" style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: UNREAD_BADGE_BG }} />}
                  {/* 편집 권한은 기본값이라 표시하지 않는다 — 예외인 '보기'만 알린다. */}
                  {m.role === 'view' && (
                    <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: 'rgba(63,143,208,.12)', color: 'var(--mf-info)' }}>보기</span>
                  )}
                </div>
              ))}
              {!view.loading && view.sharedItems.length === 0 && (
                <div style={{ padding: '6px 7px', fontSize: 11.5, color: 'var(--mf-faint2)' }}>공유받은 항목이 없습니다</div>
              )}
            </div>
          </div>
        </>
      )}


      {/* 공유받음(남의 문서)과 휴지통(지운 내 문서)은 성격이 다른 묶음이라 선으로 가른다(요청). */}
      <div data-lnb-divider style={{ ...LNB_DIVIDER, margin: '12px 4px' }} />

      <div
        className="nav-item mf-trash-head"
        role="button"
        tabIndex={0}
        onClick={controller.toggleTrashList}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.toggleTrashList();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', minHeight: isMobile ? 44 : undefined, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--mf-subtext)' }}
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
        <span style={{ ...META_MONO, marginLeft: view.trashItems.length > 0 ? 0 : 'auto' }}>{view.trashCount}</span>
        <ChevronGlyph open={state.trashOpen} />
      </div>
      <div
        style={{
          overflow: 'hidden',
          flexShrink: 0,
          maxHeight: state.trashOpen ? `${Math.max(1, view.trashItems.length) * (isMobile ? 46 : 38) + 30}px` : '0px',
          opacity: state.trashOpen ? 1 : 0,
          transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .24s ease',
        }}
      >
        {/* 즐겨찾기와 같은 가라앉은 판. 디자인 원본의 "30일 후 영구 삭제" 헤더는
            넣지 않는다 — 실제 30일 자동 삭제가 없어서 그 문구는 거짓 약속이 된다. */}
        <div style={{ overflow: 'hidden', minHeight: 0, margin: '2px 2px 4px', padding: '6px 6px 5px', borderRadius: 12, background: 'var(--mf-bg)', border: '1px solid var(--mf-hairline)' }}>
          {view.trashItems.map((t) => (
            // Keyed by docId when present — the trash may hold two entries with
            // the same TITLE (different docs), which a title key would collapse.
            // Row anatomy: [kind glyph] [title — takes ALL free width, ellipsis]
            // [restore ↺] [purge ✕]. The actions are icon-only 26px buttons
            // (labels live on aria-label/title, same treatment as the favorites
            // unstar star) — the old "복원"/"영구 삭제" text links ate most of the
            // 248px column and left titles nearly invisible. They reveal on row
            // hover/focus (always visible on touch — see home.css .mf-trash-act).
            <div key={t.docId || t.title} className="drive-file mf-trash-row" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 7px', minHeight: isMobile ? 44 : undefined, borderRadius: 9, fontSize: 12.5, color: 'var(--mf-subtext)' }}>
              {t.isDrive ? <FolderMiniGlyph /> : <KindMiniGlyph kind={t.kind} />}
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 2px 0 4px' }}>{t.title}</span>
              {t.isDrive && (
                <span style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(52,168,83,.12)', color: 'var(--mf-success-ink)' }}>{t.badge}</span>
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
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: 'none', borderRadius: 7, background: 'transparent', color: 'var(--mf-success)', cursor: 'pointer', flexShrink: 0 }}
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
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, border: 'none', borderRadius: 7, background: 'transparent', color: 'var(--mf-danger)', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          {!view.loading && view.trashItems.length === 0 && <div style={{ padding: '6px 7px', fontSize: 11.5, color: 'var(--mf-faint2)' }}>휴지통이 비어 있습니다</div>}
        </div>
      </div>

      {/* 피드백 보내기 — LNB 최하단 고정(사용자 요청: 프로필 메뉴에서 이동).
          `marginTop: auto`가 남는 공간을 밀어 올려 항상 바닥에 붙는다(공간이
          모자라면 휴지통 아래로 자연히 이어진다). 색상 테마는 여기 있다가
          사용자 요청으로 설정 모달(`AccountSettingsModal`)로 옮겼다. */}
      <div style={{ marginTop: 'auto', flexShrink: 0, paddingTop: 8 }}>
        <div data-lnb-divider style={{ ...LNB_DIVIDER, margin: '0 4px 8px' }} />

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
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', minHeight: isMobile ? 44 : undefined, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--mf-subtext)' }}
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

/** Favorites star — a crisp filled-gold SVG in place of the ★ glyph, so it
 * renders identically across platforms and sits with the other SVG nav icons
 * instead of a font-dependent emoji. */
function StarGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--mf-star)" stroke="var(--mf-star)" strokeWidth={1.4} strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </svg>
  );
}

/** "공유받은 맵" 아이콘 — 사람 + 나가는 화살표(공유). 스페이스/즐겨찾기와 같은
 * 라인 스타일 SVG이고, 색만 파랑 계열로 두어 "내 것이 아닌 출처"임을 알린다. */
function SharedGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--mf-info)" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M15 21v-1.6a3.4 3.4 0 0 0-3.4-3.4H6.4A3.4 3.4 0 0 0 3 19.4V21" />
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M17.5 11.5 21 8l-3.5-3.5" />
      <path d="M21 8h-6" />
    </svg>
  );
}

/** LNB 리스트 행(공유받음·즐겨찾기·휴지통)의 **종류 아이콘**(요청 ⑥ — 첨부 이미지의
 * 문법). 색은 홈 카드 배지의 점과 같은 종류색 토큰(--mf-doc-*)이라, 배지·아이콘이
 * 같은 색으로 같은 종류를 가리킨다. 모양: 맵=가지 다이어그램(기존 미니 글리프),
 * 보드=종이에 긋는 펜, 칸반=두 열. */
function KindMiniGlyph({ kind }: { kind: DocKindName }) {
  if (kind === 'kanban') {
    // 두 개의 **채운 세로 막대**(왼쪽이 김) — 첨부 이미지의 문법. 예전의 "틀 안
    // 가는 선 둘"은 13px에서 보드·맵과 구별이 흐렸다(제보).
    return (
      <svg data-kind-icon="kanban" width="13" height="13" viewBox="0 0 24 24" fill="var(--mf-doc-kanban)" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="4" y="3.5" width="6.8" height="17" rx="2.2" />
        <rect x="13.2" y="3.5" width="6.8" height="11" rx="2.2" />
      </svg>
    );
  }
  if (kind === 'board') {
    // 보드 = 틀 안의 펜 획(그리기 도구의 어휘). 대각선+꺾쇠 꼴은 13px에서
    // "새 탭에서 열기(↗)"로 읽혀서 피한다.
    return (
      <svg data-kind-icon="board" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-doc-board)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="3.5" y="4" width="17" height="16" rx="3" />
        <path d="M7.2 14.6c1.8-3.6 3.4-3.6 4.5-1.3s2.7 2.1 5.1-3" />
      </svg>
    );
  }
  return (
    <svg data-kind-icon="map" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mf-doc-map)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="12" r="3" />
      <line x1="9" y1="12" x2="15" y2="7" />
      <line x1="9" y1="12" x2="15" y2="17" />
      <circle cx="18" cy="7" r="2.4" />
      <circle cx="18" cy="17" r="2.4" />
    </svg>
  );
}

/** 접이식 구획 머리의 회전 셰브론 — 닫힘=오른쪽(›), 열림=아래(⌄). 디자인 원본의
 * 휴지통 머리와 같은 문법(첨부 이미지의 즐겨찾기·휴지통 ⌄). */
function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint2)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .16s ease' }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Tiny folder glyph for Drive trash rows (replaces the 📁 emoji). */
function FolderMiniGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mf-faint)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Trash-can — a line-style SVG (matching the editor's delete icon and the
 * muted nav tone) replacing the 🗑 emoji. */
function TrashGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--mf-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

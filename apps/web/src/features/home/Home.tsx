import { useEffect, useMemo, useRef, useState } from 'react';
import './home.css';
import { LoadingOverlay } from '../auth/LoadingOverlay';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { MapGrid } from './components/MapGrid';
import { SearchResults } from './components/SearchResults';
import { RecentStrip, RecentStripSkeleton } from './components/RecentStrip';
import { DashboardView } from './components/DashboardView';
import { DashboardSkeleton } from './components/DashboardSkeleton';
import { DashboardPicker } from './components/modals/DashboardPicker';
import { DashboardModal } from './components/modals/DashboardModal';
import { AuthModal } from './components/modals/AuthModal';
import { ToastModal } from './components/modals/ToastModal';
import { NewSpaceModal } from './components/modals/NewSpaceModal';
import { FolderModal } from './components/modals/FolderModal';
import { MapRenameModal } from './components/modals/MapRenameModal';
import { HomeContextMenu } from './components/HomeContextMenu';
import { Modals } from './components/modals/Modals';
import { AccountSettingsModal } from './components/modals/AccountSettingsModal';
import { DeleteAccountModal } from './components/modals/DeleteAccountModal';
import { FeedbackModal } from '../../components/FeedbackModal';
import { ShareModal } from '../../components/ShareModal';
import { ChangePasswordModal } from './components/modals/ChangePasswordModal';
import { SetPasswordModal } from './components/modals/SetPasswordModal';
import { ProfileNameModal } from './components/modals/ProfileNameModal';
import { TemplateGallery } from './components/modals/TemplateGallery';
import { useHomeController } from './useHomeController';
import { deriveHomeView } from './viewModel';
import { predictLanding } from './storage';
import { homeModalTheme } from './theme';
import { homeUpdateRisk } from './updateRisk';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useDrawerSwipe } from '../../hooks/useDrawerSwipe';
import { useUpdateGuard } from '../../pwa/updateGate';
import { InstallHint } from '../../pwa/InstallHint';
import { useInstallHint } from '../../pwa/installHint';
import { OfflineBar } from '../../components/OfflineBar';
import { useOnline } from '../../hooks/useOnline';
import { useMarqueeSelect } from './marquee';

/**
 * React port of Home.dc.html — the map dashboard. State/behavior lives in
 * {@link useHomeController} (1:1 with the original `class Component extends
 * DCLogic`); {@link deriveHomeView} mirrors `renderVals()`'s derived data.
 *
 * M6 (mobile web): below 768px the fixed 248px LNB (`Sidebar`) becomes a
 * hamburger-triggered overlay drawer instead of a permanent column — purely
 * a presentation-layer concern, so it's local `useState` here rather than
 * something threaded through `useHomeController`'s ported state.
 */
export function Home() {
  const controller = useHomeController();
  const { state } = controller;
  // Derive the view (card metadata + `realPreview` sketches) only when the ported
  // state actually changes — not on every Home re-render (e.g. the mobile drawer
  // toggle below). `realPreview` is memoized too (see mapPreview), so unchanged
  // cards return the same element reference and React skips their SVG subtrees.
  const view = useMemo(() => deriveHomeView(state), [state]);
  // 에디터와 함께 쓰는 모달(공유·피드백)은 CSS 변수를 스스로 읽지 않으므로
  // 지금 테마의 색을 만들어 넘긴다 — 다크에서도 홈과 같은 면·글자색이 된다.
  const modalTheme = useMemo(() => homeModalTheme(state.theme), [state.theme]);
  const isMobile = useIsMobile();
  // 빈 자리에서 끌어 카드를 한 번에 고른다(요청) — 마우스에서만. 터치에는 길게
  // 누르기(선택 모드)가 이미 있고, 손가락 드래그는 목록 스크롤이다.
  const marquee = useMarqueeSelect({
    onSelect: controller.marqueeSelect,
    currentSelection: () => controller.state.selectedCards,
    disabled: isMobile,
  });
  const installHint = useInstallHint(isMobile);
  // 예상은 **마운트 때 한 번** 잡는다 — 착지하면서 힌트가 갱신되므로 매 렌더 읽으면
  // 로딩 중에 모양이 바뀔 수 있다.
  const landingGuess = useRef<'dash' | 'space'>(predictLanding());
  const online = useOnline();
  const [navOpen, setNavOpen] = useState(false);
  // 로딩 스켈레톤의 모양 — 아직 착지 화면을 모르는 첫 프레임에 쓴다(`predictLanding`:
  // 이 탭이 기억한 화면 → 이 기기의 힌트). 대시보드로 갈 예정이면 대시보드 껍데기를
  // 그린다(제보: 스페이스 스켈레톤이 떴다가 통째로 갈아 끼워졌다).
  const dashSkeleton = view.loading && landingGuess.current === 'dash';
  // 새 배포 자동 적용 게이트: 목록은 리로드해도 그대로 다시 그려지니 기본은 조용히
  // 적용하고, 입력 중인 팝업·확인 다이얼로그·검색어가 있을 때만 물어본다.
  useUpdateGuard(homeUpdateRisk(state));

  // Closing the drawer when the layout crosses back to desktop keeps it from
  // lingering "open" (and blocking the backdrop) after a resize/rotation.
  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  // One-thumb drawer gestures: left-edge swipe-right opens, swipe-left (while
  // open) closes — the hamburger stays as the visible affordance.
  useDrawerSwipe(
    isMobile,
    navOpen,
    () => setNavOpen(true),
    () => setNavOpen(false),
  );

  // 루트는 `100dvh`(에디터와 동일, M6) — 모바일에서 `100vh`는 주소창을 무시한
  // **큰** 뷰포트라 루트가 화면보다 길어지고, 그 차이만큼 **페이지 스크롤이 하나
  // 더** 생겨 안쪽 목록(main) 스크롤과 이중이 됐다(제보: 최상단↔최하단 이동 시
  // 두 스크롤이 따로 움직임). 데스크톱에서는 100vh와 같다.
  return (
    <div className="mf-home" style={{ display: 'flex', height: '100dvh', width: '100%', background: 'var(--mf-bg)', fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif", color: 'var(--mf-text)', overflow: 'hidden' }}>
      {/* `instant`: Home의 로더는 뒤 배경을 함께 바꾸는 동작(새로 만들기=카드 추가,
          로그아웃/탈퇴=목록 정리)에 쓰이므로, 페이드인 중 반투명 구간으로 그 변화가
          비쳐 깜빡이지 않도록 첫 프레임부터 화면을 덮는다. */}
      {state.creatingMap && <LoadingOverlay message={state.loaderMsg || '새 마인드맵을 준비하고 있어요'} instant veil="var(--mf-overlay-veil)" ink="var(--mf-text)" subInk="var(--mf-muted)" />}

      <Sidebar state={state} view={view} controller={controller} isMobile={isMobile} isOpen={navOpen} onClose={() => setNavOpen(false)} />

      <ToastModal state={state} controller={controller} />

      {/* "홈 화면에 추가" 안내(모바일). iOS에는 설치 배너가 없어 공유 시트의 절차를
          사용자가 스스로 찾아야 하고, 안드로이드는 버튼 한 번으로 끝난다 —
          `useInstallHint`가 그 차이를 판단하고 여기서는 띄우기만 한다. 홈에만
          두는 이유: 로그인·랜딩은 아직 "쓰기로 한" 화면이 아니다. */}
      {/* 오프라인이면 설치 안내 대신 연결 상태를 말한다 — 지금 급한 정보가 그쪽이고,
          같은 자리를 두 카드가 다투지도 않는다. */}
      <OfflineBar visible={!online} />
      <InstallHint mode={online ? installHint.mode : null} onInstall={installHint.install} onDismiss={installHint.dismiss} isMobile={isMobile} />

      {/* `scrollbarGutter: 'stable'` reserves the vertical scrollbar's width
          whether or not it's showing, so crossing from "few maps" (no scroll) to
          "many maps" (scroll appears) doesn't shrink the content box and shift the
          whole grid/toolbar left on devices with classic (space-taking) scrollbars.
          It's a no-op with overlay scrollbars (mobile), where there's no shift anyway. */}
      <main
        onPointerDown={marquee.onPointerDown}
        onContextMenu={(e) => {
          // 빈 자리 우클릭 = "새로 만들기 · 새 폴더 · 가져오기 · 설정"(요청).
          // 카드·폴더는 자기 메뉴를 열고 전파를 끊으므로 여기까지 오지 않고,
          // 입력창·검색어 위에서는 브라우저 기본 메뉴(붙여넣기 등)를 지킨다.
          const t = e.target as HTMLElement;
          if (t.closest && t.closest('input, textarea, [contenteditable="true"], .mf-home-ctx')) return;
          e.preventDefault();
          controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'bg' });
        }}
        // 첫 진입에 살짝 떠오르며 나타난다(디자인 원본의 `ghFade`) — 마운트 때 한 번만
        // 돌고, 움직임을 줄이라고 한 사용자에게는 home.css가 끈다.
        className="mf-home-main"
        // 본문 패딩은 디자인 원본(24/32/44). 모바일은 좁은 폭에 맞춰 줄인다.
        style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarGutter: 'stable', padding: isMobile ? '16px 14px 32px' : '24px 32px 44px', minWidth: 0 }}
      >
        {/* Cross-space "최근 항목" strip sits ABOVE the space toolbar so it reads as a
            global "recently opened" bar, not part of the current space's maps.
            로딩 중엔(저장된 최근 기록이 있을 때) 같은 footprint의 스켈레톤을 미리
            깔아, 로드 완료 시 트레이가 끼어들며 툴바가 아래로 튀는 점프를 막는다. */}
        {/* 검색 중에는 최근 항목을 감춘다 — 질의로 걸러지지 않는 목록이 결과 위에
            남아 있으면 무엇이 결과인지 흐려진다. */}
        {/* 대시보드 보기 — 화면은 언제나 한쪽만 그린다(대시보드 ↔ 스페이스). 최근
            항목·툴바·그리드는 스페이스의 것이라 함께 접는다. */}
        {state.activeDash ? (
          <DashboardView state={state} view={view} controller={controller} isMobile={isMobile} onOpenNav={() => setNavOpen(true)} />
        ) : dashSkeleton ? (
          /* 로딩 중이고 이번 진입이 대시보드로 착지할 예정 — 스페이스 스켈레톤(최근
             항목 띠 + 카드 격자)을 띄우면 곧 통째로 갈아 끼워진다(제보). */
          <DashboardSkeleton isMobile={isMobile} />
        ) : (
          <>
            {view.loading && state.recent.length > 0 && !view.searchQuery && <RecentStripSkeleton count={state.recent.length} />}
            {view.recentSectionVisible && <RecentStrip cards={view.recentCards} controller={controller} />}
            {/* 툴바(검색창이 그 안에 있다)는 검색 중에도 남는다 — 검색창이 사라지면
                글자를 고칠 수도, 지울 수도 없다. 스페이스 제목은 "지금 어디에 있는가",
                즉 검색을 지웠을 때 돌아갈 자리를 계속 가리킨다. */}
            <Toolbar state={state} view={view} controller={controller} isMobile={isMobile} onOpenNav={() => setNavOpen(true)} />
            {view.searchQuery ? <SearchResults view={view} controller={controller} /> : <MapGrid view={view} controller={controller} />}
          </>
        )}
      </main>

      {/* 마퀴 — 화면 좌표라 `position: fixed`. 포인터를 가로채면 그 아래 카드가
          hover·drop 대상을 잃으므로 `pointer-events: none`. */}
      {marquee.rect && (
        <div
          data-marquee
          style={{
            position: 'fixed',
            left: marquee.rect.x,
            top: marquee.rect.y,
            width: marquee.rect.w,
            height: marquee.rect.h,
            border: '1px solid var(--mf-accent)',
            background: 'rgba(var(--mf-accent-rgb), .10)',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 60,
          }}
        />
      )}

      <AuthModal state={state} controller={controller} />
      <AccountSettingsModal state={state} controller={controller} />
      <ProfileNameModal state={state} controller={controller} />
      <ChangePasswordModal state={state} controller={controller} />
      <SetPasswordModal state={state} controller={controller} />
      <DeleteAccountModal state={state} controller={controller} />
      {/* 피드백(사용자 의견 수집) — LNB 최하단에서 연다. */}
      <FeedbackModal open={state.feedbackOpen} onClose={controller.closeFeedback} page="home" theme={modalTheme} />
      {/* 공유 — 카드 메뉴에서 연다(요청). 에디터와 **같은 모달**이고 색만 홈 테마다.
          그리드의 카드는 언제나 내 맵이라 보기 전용이 아니다(공유받은 맵은 LNB에만). */}
      <ShareModal open={!!state.shareDocId} docId={state.shareDocId ?? ''} onClose={controller.closeShare} theme={modalTheme} />
      <TemplateGallery state={state} controller={controller} />
      <DashboardPicker state={state} view={view} controller={controller} isMobile={isMobile} />
      <DashboardModal state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
      <MapRenameModal state={state} controller={controller} />

      {/* 홈의 단 하나뿐인 메뉴 — 카드 ☰·카드 우클릭·빈 자리 우클릭이 모두 이걸 연다. */}
      <HomeContextMenu state={state} view={view} controller={controller} />
    </div>
  );
}

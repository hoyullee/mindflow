import { useEffect, useMemo, useState } from 'react';
import './home.css';
import { LoadingOverlay } from '../auth/LoadingOverlay';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { MapGrid } from './components/MapGrid';
import { SearchResults } from './components/SearchResults';
import { RecentStrip, RecentStripSkeleton } from './components/RecentStrip';
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
import { ProfileNameModal } from './components/modals/ProfileNameModal';
import { TemplateGallery } from './components/modals/TemplateGallery';
import { useHomeController } from './useHomeController';
import { deriveHomeView } from './viewModel';
import { homeModalTheme } from './theme';
import { homeUpdateRisk } from './updateRisk';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useDrawerSwipe } from '../../hooks/useDrawerSwipe';
import { useUpdateGuard } from '../../pwa/updateGate';
import { InstallHint } from '../../pwa/InstallHint';
import { useInstallHint } from '../../pwa/installHint';
import { OfflineBar } from '../../components/OfflineBar';
import { useOnline } from '../../hooks/useOnline';

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
  const installHint = useInstallHint(isMobile);
  const online = useOnline();
  const [navOpen, setNavOpen] = useState(false);
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

  return (
    <div className="mf-home" style={{ display: 'flex', height: '100vh', width: '100%', background: 'var(--mf-bg)', fontFamily: "Pretendard, 'Pretendard-fallback', system-ui, sans-serif", color: 'var(--mf-text)', overflow: 'hidden' }}>
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
        onContextMenu={(e) => {
          // 빈 자리 우클릭 = "새로 만들기 · 새 폴더 · 가져오기 · 설정"(요청).
          // 카드·폴더는 자기 메뉴를 열고 전파를 끊으므로 여기까지 오지 않고,
          // 입력창·검색어 위에서는 브라우저 기본 메뉴(붙여넣기 등)를 지킨다.
          const t = e.target as HTMLElement;
          if (t.closest && t.closest('input, textarea, [contenteditable="true"], .mf-home-ctx')) return;
          e.preventDefault();
          controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'bg' });
        }}
        style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarGutter: 'stable', padding: isMobile ? '16px 14px 32px' : '26px 32px 40px', minWidth: 0 }}
      >
        {/* Cross-space "최근 항목" strip sits ABOVE the space toolbar so it reads as a
            global "recently opened" bar, not part of the current space's maps.
            로딩 중엔(저장된 최근 기록이 있을 때) 같은 footprint의 스켈레톤을 미리
            깔아, 로드 완료 시 트레이가 끼어들며 툴바가 아래로 튀는 점프를 막는다. */}
        {/* 검색 중에는 최근 항목을 감춘다 — 질의로 걸러지지 않는 목록이 결과 위에
            남아 있으면 무엇이 결과인지 흐려진다. */}
        {view.loading && state.recent.length > 0 && !view.searchQuery && <RecentStripSkeleton count={state.recent.length} />}
        {view.recentSectionVisible && <RecentStrip cards={view.recentCards} controller={controller} />}
        {/* 툴바(검색창이 그 안에 있다)는 검색 중에도 남는다 — 검색창이 사라지면
            글자를 고칠 수도, 지울 수도 없다. 스페이스 제목은 "지금 어디에 있는가",
            즉 검색을 지웠을 때 돌아갈 자리를 계속 가리킨다. */}
        <Toolbar state={state} view={view} controller={controller} isMobile={isMobile} onOpenNav={() => setNavOpen(true)} />
        {view.searchQuery ? <SearchResults view={view} controller={controller} /> : <MapGrid view={view} controller={controller} />}
      </main>

      <AuthModal state={state} controller={controller} />
      <AccountSettingsModal state={state} controller={controller} />
      <ProfileNameModal state={state} controller={controller} />
      <DeleteAccountModal state={state} controller={controller} />
      {/* 피드백(사용자 의견 수집) — LNB 최하단에서 연다. */}
      <FeedbackModal open={state.feedbackOpen} onClose={controller.closeFeedback} page="home" theme={modalTheme} />
      {/* 공유 — 카드 메뉴에서 연다(요청). 에디터와 **같은 모달**이고 색만 홈 테마다.
          그리드의 카드는 언제나 내 맵이라 보기 전용이 아니다(공유받은 맵은 LNB에만). */}
      <ShareModal open={!!state.shareDocId} docId={state.shareDocId ?? ''} onClose={controller.closeShare} theme={modalTheme} />
      <TemplateGallery state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
      <MapRenameModal state={state} controller={controller} />

      {/* 홈의 단 하나뿐인 메뉴 — 카드 ☰·카드 우클릭·빈 자리 우클릭이 모두 이걸 연다. */}
      <HomeContextMenu state={state} view={view} controller={controller} />
    </div>
  );
}

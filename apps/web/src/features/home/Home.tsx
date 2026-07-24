import { useEffect, useMemo, useState } from 'react';
import './home.css';
import { LoadingOverlay } from '../auth/LoadingOverlay';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { MapGrid } from './components/MapGrid';
import { RecentStrip, RecentStripSkeleton } from './components/RecentStrip';
import { AuthModal } from './components/modals/AuthModal';
import { ToastModal } from './components/modals/ToastModal';
import { NewSpaceModal } from './components/modals/NewSpaceModal';
import { FolderModal } from './components/modals/FolderModal';
import { Modals } from './components/modals/Modals';
import { AccountSettingsModal } from './components/modals/AccountSettingsModal';
import { DeleteAccountModal } from './components/modals/DeleteAccountModal';
import { ProfileNameModal } from './components/modals/ProfileNameModal';
import { useHomeController } from './useHomeController';
import { deriveHomeView } from './viewModel';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useDrawerSwipe } from '../../hooks/useDrawerSwipe';

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
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

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
    <div className="mf-home" style={{ display: 'flex', height: '100vh', width: '100%', background: '#fbf6f2', fontFamily: 'Pretendard, system-ui, sans-serif', color: '#33281f', overflow: 'hidden' }}>
      {state.creatingMap && <LoadingOverlay message={state.loaderMsg || '새 마인드맵을 준비하고 있어요'} />}

      <Sidebar state={state} view={view} controller={controller} isMobile={isMobile} isOpen={navOpen} onClose={() => setNavOpen(false)} />

      <ToastModal state={state} controller={controller} />

      {/* `scrollbarGutter: 'stable'` reserves the vertical scrollbar's width
          whether or not it's showing, so crossing from "few maps" (no scroll) to
          "many maps" (scroll appears) doesn't shrink the content box and shift the
          whole grid/toolbar left on devices with classic (space-taking) scrollbars.
          It's a no-op with overlay scrollbars (mobile), where there's no shift anyway. */}
      <main style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarGutter: 'stable', padding: isMobile ? '16px 14px 32px' : '26px 32px 40px', minWidth: 0 }}>
        {/* Cross-space "최근 항목" strip sits ABOVE the space toolbar so it reads as a
            global "recently opened" bar, not part of the current space's maps.
            로딩 중엔(저장된 최근 기록이 있을 때) 같은 footprint의 스켈레톤을 미리
            깔아, 로드 완료 시 트레이가 끼어들며 툴바가 아래로 튀는 점프를 막는다. */}
        {view.loading && state.recent.length > 0 && <RecentStripSkeleton count={state.recent.length} />}
        {view.recentSectionVisible && <RecentStrip cards={view.recentCards} controller={controller} />}
        <Toolbar state={state} view={view} controller={controller} isMobile={isMobile} onOpenNav={() => setNavOpen(true)} />
        <MapGrid view={view} controller={controller} />
      </main>

      <AuthModal state={state} controller={controller} />
      <AccountSettingsModal state={state} controller={controller} />
      <ProfileNameModal state={state} controller={controller} />
      <DeleteAccountModal state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
    </div>
  );
}

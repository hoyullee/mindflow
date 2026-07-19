import { useEffect, useState } from 'react';
import './home.css';
import { LoadingOverlay } from '../auth/LoadingOverlay';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { MapGrid } from './components/MapGrid';
import { AuthModal } from './components/modals/AuthModal';
import { ToastModal } from './components/modals/ToastModal';
import { NewSpaceModal } from './components/modals/NewSpaceModal';
import { FolderModal } from './components/modals/FolderModal';
import { Modals } from './components/modals/Modals';
import { AccountSettingsModal } from './components/modals/AccountSettingsModal';
import { DeleteAccountModal } from './components/modals/DeleteAccountModal';
import { useHomeController } from './useHomeController';
import { deriveHomeView } from './viewModel';
import { useIsMobile } from '../../hooks/useMediaQuery';

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
  const view = deriveHomeView(controller.state);
  const { state } = controller;
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  // Closing the drawer when the layout crosses back to desktop keeps it from
  // lingering "open" (and blocking the backdrop) after a resize/rotation.
  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  return (
    <div className="mf-home" style={{ display: 'flex', height: '100vh', width: '100%', background: '#fbf6f2', fontFamily: 'Pretendard, system-ui, sans-serif', color: '#33281f', overflow: 'hidden' }}>
      {state.creatingMap && <LoadingOverlay message={state.loaderMsg || '새 마인드맵을 준비하고 있어요'} />}

      <Sidebar state={state} view={view} controller={controller} isMobile={isMobile} isOpen={navOpen} onClose={() => setNavOpen(false)} />

      <ToastModal state={state} controller={controller} />

      <main style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: isMobile ? '16px 14px 32px' : '26px 32px 40px', minWidth: 0 }}>
        <Toolbar state={state} view={view} controller={controller} isMobile={isMobile} onOpenNav={() => setNavOpen(true)} />
        <MapGrid view={view} controller={controller} />
      </main>

      <AuthModal state={state} controller={controller} />
      <AccountSettingsModal state={state} controller={controller} />
      <DeleteAccountModal state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
    </div>
  );
}

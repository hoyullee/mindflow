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
import { useHomeController } from './useHomeController';
import { deriveHomeView } from './viewModel';

/**
 * React port of Home.dc.html — the map dashboard. State/behavior lives in
 * {@link useHomeController} (1:1 with the original `class Component extends
 * DCLogic`); {@link deriveHomeView} mirrors `renderVals()`'s derived data.
 */
export function Home() {
  const controller = useHomeController();
  const view = deriveHomeView(controller.state);
  const { state } = controller;

  return (
    <div className="mf-home" style={{ display: 'flex', height: '100vh', width: '100%', background: '#fbf6f2', fontFamily: 'Pretendard, system-ui, sans-serif', color: '#33281f', overflow: 'hidden' }}>
      {state.creatingMap && <LoadingOverlay message={state.loaderMsg || '새 마인드맵을 준비하고 있어요'} />}

      <Sidebar state={state} view={view} controller={controller} />

      <ToastModal state={state} controller={controller} />

      <main style={{ flex: '1 1 auto', overflowY: 'auto', padding: '26px 32px 40px' }}>
        <Toolbar state={state} view={view} controller={controller} />
        <MapGrid view={view} controller={controller} />
      </main>

      <AuthModal state={state} controller={controller} />
      <Modals state={state} controller={controller} />
      <NewSpaceModal state={state} controller={controller} />
      <FolderModal state={state} controller={controller} />
    </div>
  );
}

import type { HomeController } from '../../useHomeController';
import type { HomeState } from '../../types';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:179-188 — import success/failure and restore-with-space-reattach toast. */
export function ToastModal({ state, controller }: Props) {
  const visible = !!(state.toast || state.importDone || state.importError);
  const title = state.importError ? '가져오기 실패' : state.importDone ? '가져오기 완료' : '복원 완료';
  const msg = state.importError || (state.importDone ? `"${state.importDone}" 맵을 현재 공간에 추가했어요` : state.toast || '');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 220, animation: 'mf-fade .18s ease-out' }}>
      <div style={{ width: 340, background: '#fff', borderRadius: 16, boxShadow: '0 22px 60px rgba(0,0,0,.28)', padding: '26px 24px', textAlign: 'center', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 15, background: '#e9f4ee', fontSize: 24, margin: '0 auto 14px', color: '#2f9e63' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#7c6d60', lineHeight: 1.6, marginBottom: 20 }}>{msg}</div>
        <button className="btn" onClick={controller.closeToast} style={{ width: '100%', height: 42, border: 'none', borderRadius: 11, background: '#f0663f', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          확인
        </button>
      </div>
    </div>
  );
}

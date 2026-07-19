import type { HomeController } from '../../useHomeController';
import type { HomeState } from '../../types';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** 설정 (account settings) modal — opened from the profile popover's "설정" row.
 * Shows the signed-in account and hosts the destructive "회원 탈퇴" entry, kept
 * in its own bottom "위험 구역" section so it never sits next to routine actions. */
export function AccountSettingsModal({ state, controller }: Props) {
  const visible = state.accountSettingsOpen;
  const initial = (state.userName || 'M').trim().charAt(0).toUpperCase() || 'M';

  return (
    <div
      onClick={controller.closeAccountSettings}
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
    >
      <div
        role="dialog"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'mf-fade .2s ease' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid #f2e9e1' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>설정</div>
          <button
            className="btn"
            aria-label="닫기"
            onClick={controller.closeAccountSettings}
            style={{ marginLeft: 'auto', width: 32, height: 32, border: 'none', borderRadius: 9, background: '#f5efe9', color: '#8a7365', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {/* account */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b6a596', letterSpacing: '.02em', marginBottom: 10 }}>계정</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 13, background: '#faf5f0', marginBottom: 22 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: '#f0663f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, flexShrink: 0 }}>
              {initial}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userName}</div>
              {state.userEmail && <div style={{ fontSize: 12, color: '#9c8b7e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.userEmail}</div>}
            </div>
          </div>

          {/* danger zone */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#d64545', letterSpacing: '.02em', marginBottom: 10 }}>위험 구역</div>
          <div
            className="menu-row"
            role="button"
            tabIndex={0}
            onClick={controller.askDeleteAccount}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.askDeleteAccount();
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 13, border: '1px solid #f3d9d4', background: '#fdf4f2', cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fdecec', color: '#d64545', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#c53c3c' }}>회원 탈퇴</div>
              <div style={{ fontSize: 12, color: '#a98' }}>계정과 모든 맵·스페이스가 영구 삭제돼요</div>
            </div>
            <div style={{ marginLeft: 'auto', color: '#d8a9a0', fontSize: 16, flexShrink: 0 }}>›</div>
          </div>
        </div>
      </div>
    </div>
  );
}

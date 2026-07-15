import type { HomeController } from '../../useHomeController';
import type { HomeState } from '../../types';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:332-365 — the fake Google Drive OAuth modal. */
export function AuthModal({ state, controller }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: state.auth ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={controller.closeAuth}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 400, background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', overflow: 'hidden', animation: 'mf-fade .2s ease' }}>
        <div style={{ padding: '22px 26px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>
            <span style={{ color: '#4285F4' }}>G</span>
            <span style={{ color: '#EA4335' }}>o</span>
            <span style={{ color: '#FBBC05' }}>o</span>
            <span style={{ color: '#4285F4' }}>g</span>
            <span style={{ color: '#34A853' }}>l</span>
            <span style={{ color: '#EA4335' }}>e</span>
          </span>
          <span style={{ fontSize: 14, color: '#5f6368' }}>계정으로 로그인</span>
        </div>

        {state.auth === 'choose' && (
          <div style={{ padding: '20px 26px 24px' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#202124', marginBottom: 4 }}>계정 선택</div>
            <div style={{ fontSize: 13, color: '#5f6368', marginBottom: 18 }}>MindFlow(으)로 계속하기</div>
            <div onClick={controller.chooseAccount} role="button" tabIndex={0} className="drive-file" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #eee', borderRadius: 10, cursor: 'pointer', marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#f0663f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>M</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#202124' }}>mine 사용자</div>
                <div style={{ fontSize: 12, color: '#5f6368' }}>mine@gmail.com</div>
              </div>
            </div>
            <div className="drive-file" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, cursor: 'pointer', color: '#5f6368' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>＋</div>
              <div style={{ fontSize: 13.5 }}>다른 계정 사용</div>
            </div>
          </div>
        )}

        {state.auth === 'connecting' && (
          <div style={{ padding: '44px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 36, height: 36, border: '3px solid #eee', borderTopColor: '#4285F4', borderRadius: '50%', animation: 'mf-spin .8s linear infinite' }} />
            <div style={{ fontSize: 13.5, color: '#5f6368' }}>Google Drive에 연결 중…</div>
          </div>
        )}
      </div>
    </div>
  );
}

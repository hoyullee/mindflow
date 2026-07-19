import type { HomeController } from '../../useHomeController';
import type { HomeState } from '../../types';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** 회원 탈퇴 confirmation — a deliberately high-friction dialog for an
 * irreversible action: it spells out what's deleted and arms the destructive
 * button only once the user types the exact phrase ("탈퇴"). */
export function DeleteAccountModal({ state, controller }: Props) {
  const visible = state.confirmDeleteAccount;
  const armed = state.deleteAccountText.trim() === '탈퇴';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 160 }}>
      <div role="dialog" aria-label="회원 탈퇴" onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fdecec', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#d64545' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>정말 탈퇴하시겠어요?</div>
        <div style={{ fontSize: 13, color: '#8a7365', lineHeight: 1.6, marginBottom: 14 }}>
          탈퇴하면 <b style={{ color: '#33281f' }}>모든 맵·스페이스·폴더와 계정 정보</b>가 영구적으로 삭제되며, <b style={{ color: '#33281f' }}>되돌릴 수 없어요</b>.
          {state.userEmail && <> ({state.userEmail})</>}
        </div>

        <label style={{ display: 'block', fontSize: 12, color: '#8a7365', marginBottom: 7 }}>
          계속하려면 아래에 <b style={{ color: '#d64545' }}>탈퇴</b>를 입력해 주세요.
        </label>
        <input
          value={state.deleteAccountText}
          onChange={(e) => controller.onDeleteAccountInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && armed) controller.confirmDeleteAccountYes();
            if (e.key === 'Escape') controller.cancelDeleteAccount();
          }}
          ref={(el) => {
            if (el && visible && document.activeElement !== el) el.focus();
          }}
          placeholder="탈퇴"
          aria-label="탈퇴 확인 입력"
          autoComplete="off"
          style={{ width: '100%', height: 42, border: `1px solid ${armed ? '#d64545' : '#ecdfd5'}`, borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, padding: '0 12px', outline: 'none', boxSizing: 'border-box', marginBottom: state.deleteAccountError ? 8 : 20 }}
        />

        {state.deleteAccountError && (
          <div style={{ fontSize: 12, color: '#d64545', marginBottom: 16 }}>{state.deleteAccountError}</div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.cancelDeleteAccount} style={{ flex: 1, height: 42, border: '1px solid #ecdfd5', borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.confirmDeleteAccountYes}
            disabled={!armed}
            style={{ flex: 1, height: 42, border: 'none', borderRadius: 11, background: armed ? '#d64545' : '#e7b9b3', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: armed ? 'pointer' : 'not-allowed' }}
          >
            회원 탈퇴
          </button>
        </div>
      </div>
    </div>
  );
}

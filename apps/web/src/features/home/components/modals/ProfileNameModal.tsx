import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** "프로필명 변경" popup — same shape as the "공간 이름 변경" dialog (NewSpaceModal),
 * name-only. Opened from the profile popover; commits on 변경, discards on 취소. */
export function ProfileNameModal({ state, controller }: Props) {
  const canSubmit = state.profileNameDraft.trim().length > 0;
  return (
    <div
      // No backdrop-click-to-close: a dim click must not discard the edit (matches
      // the "공간 이름 변경" popup). Use 취소 or 변경 to dismiss.
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: state.profileNameOpen ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 160 }}
    >
      <div role="dialog" aria-label="프로필명 변경" onClick={(e) => e.stopPropagation()} style={{ width: 380, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>프로필명 변경</div>
        <div style={{ fontSize: 13, color: '#9c8b7e', lineHeight: 1.6, marginBottom: 20 }}>프로필에 표시될 이름을 변경해요.</div>

        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>프로필명</div>
        <input
          className="ns-input"
          value={state.profileNameDraft}
          onInput={(e) => controller.onProfileNameInput((e.target as HTMLInputElement).value)}
          onKeyDown={controller.onProfileNameKey}
          onMouseDown={(e) => e.stopPropagation()}
          ref={(el) => {
            if (el && state.profileNameOpen && document.activeElement !== el) {
              el.focus();
              el.select();
            }
          }}
          maxLength={20}
          placeholder="예: 홍길동 (최대 20자)"
          aria-label="프로필명"
          style={{ width: '100%', height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#faf3ee', color: '#33281f', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: 24 }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.cancelProfileName} style={{ flex: 1, height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.submitProfileName}
            style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canSubmit ? '#f0663f' : '#e7d6ca', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}
          >
            변경
          </button>
        </div>
      </div>
    </div>
  );
}

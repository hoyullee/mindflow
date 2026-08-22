import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';
import { Modal, MODAL_DIM, modalCard } from '../../../../components/Modal';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** "프로필명 변경" popup — same shape as the "공간 이름 변경" dialog (NewSpaceModal),
 * name-only. Opened from the profile popover; commits on 변경, discards on 취소. */
export function ProfileNameModal({ state, controller }: Props) {
  const canSubmit = state.profileNameDraft.trim().length > 0;
  return (
    // 막을 눌러도 닫히지 않는다: 편집 중인 이름이 실수로 버려지면 안 된다("공간
    // 이름 변경" 팝업과 같은 규칙). 취소·변경으로만 닫는다.
    <Modal
      open={state.profileNameOpen}
      onClose={controller.cancelProfileName}
      label="프로필명 변경"
      dim={{ ...MODAL_DIM, zIndex: 160 }}
      card={modalCard(380)}
      dismissOnBackdrop={false}
    >
      <>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>프로필명 변경</div>
        <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 20 }}>프로필에 표시될 이름을 변경해요.</div>

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
          style={{ width: '100%', height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel2)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: 24 }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.cancelProfileName} style={{ flex: 1, height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.submitProfileName}
            style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canSubmit ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}
          >
            변경
          </button>
        </div>
      </>
    </Modal>
  );
}

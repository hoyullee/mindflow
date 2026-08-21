import type { ReactNode } from 'react';
import { Modal, MODAL_DIM, modalCard } from '../../../../components/Modal';

interface Props {
  visible: boolean;
  zIndex: number;
  iconBg: string;
  icon: ReactNode;
  heading: string;
  body: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  confirmColor: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Shared shell for Home.dc.html's five near-identical confirm dialogs
 * (delete map, restore map, delete folder, delete space, logout). */
export function ConfirmModal({ visible, zIndex, iconBg, icon, heading, body, cancelLabel, confirmLabel, confirmColor, onCancel, onConfirm }: Props) {
  return (
    // 확인창은 **Escape로 닫히고 막 클릭으로는 닫히지 않는다**: 취소는 명시적으로
    // 누르는 것이고, 파괴적 동작 위에서 막을 잘못 눌러 사라지면 다시 찾아와야 한다.
    <Modal
      open={visible}
      onClose={onCancel}
      label={heading}
      dim={{ ...MODAL_DIM, zIndex }}
      card={modalCard(360)}
      dismissOnBackdrop={false}
    >
      <>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{heading}</div>
        <div style={{ fontSize: 13, color: 'var(--mf-subtext)', lineHeight: 1.6, marginBottom: 22 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onCancel} style={{ flex: 1, height: 42, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {cancelLabel}
          </button>
          <button className="btn" onClick={onConfirm} style={{ flex: 1, height: 42, border: 'none', borderRadius: 11, background: confirmColor, color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </>
    </Modal>
  );
}

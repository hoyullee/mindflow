import type { ReactNode } from 'react';

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
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: visible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 360, background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{heading}</div>
        <div style={{ fontSize: 13, color: '#8a7365', lineHeight: 1.6, marginBottom: 22 }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onCancel} style={{ flex: 1, height: 42, border: '1px solid #ecdfd5', borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {cancelLabel}
          </button>
          <button className="btn" onClick={onConfirm} style={{ flex: 1, height: 42, border: 'none', borderRadius: 11, background: confirmColor, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

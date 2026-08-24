import { Modal, MODAL_DIM, modalCard } from '../../../../components/Modal';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** "대시보드 이름 변경" — LNB 행 우클릭 메뉴에서 연다. 폴더 이름 변경과 같은 꼴이고,
 * 저장은 워크스페이스 블롭 한 줄이라 즉시 끝난다. */
export function DashRenameModal({ state, controller }: Props) {
  const r = state.dashRename;
  const canSave = !!r && r.name.trim().length > 0;
  return (
    <Modal open={!!r} onClose={controller.cancelDashRename} label="대시보드 이름 변경" dim={{ ...MODAL_DIM, zIndex: 140 }} card={modalCard(380)} cardAttrs={{ 'data-dash-rename': '' }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>대시보드 이름 변경</div>
      <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 20 }}>사이드바와 대시보드 화면에 함께 보여요.</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>대시보드 이름</div>
      <input
        className="ns-input"
        value={r?.name || ''}
        onInput={(e) => controller.onDashRenameInput((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') controller.submitDashRename();
        }}
        maxLength={30}
        placeholder="예: 이번 주 (최대 30자)"
        aria-label="대시보드 이름"
        style={{ width: '100%', height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel2)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: 24 }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" onClick={controller.cancelDashRename} style={{ flex: 1, height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          취소
        </button>
        <button
          className="btn"
          onClick={controller.submitDashRename}
          style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canSave ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}
        >
          변경
        </button>
      </div>
    </Modal>
  );
}

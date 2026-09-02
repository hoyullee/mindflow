/**
 * 삭제 확인 팝업(요청) — 일정 상세·칸반 카드 상세가 **같은 것**을 쓴다.
 *
 * 삭제는 되돌릴 수 없다(일정은 버전 기록에 남지 않고, 칸반 카드도 홈에서는 실행
 * 취소가 없다) — 그래서 머리의 버튼 하나가 곧 실행이면 잘못 눌린다. 한 번 묻고,
 * **끝날 때까지 이 팝업이 남아** 스피너로 진행을 보여 준다.
 *
 * 규칙 셋(열 삭제 확인창과 같다): 초점은 **취소**에(파괴적 버튼이 기본 초점이면
 * Enter 한 번에 지워진다) · 막 클릭으로는 닫지 않는다 · 지우는 중에는 두 버튼을
 * 잠근다(같은 삭제가 두 번 나가지 않게).
 */

import { Modal, MODAL_DIM } from '../../../components/Modal';

export function DeleteConfirm({
  title,
  body,
  isMobile,
  deleting,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  isMobile: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      onClose={() => (deleting ? undefined : onCancel())}
      label={title}
      dismissOnBackdrop={false}
      initialFocusSelector="[data-confirm-cancel]"
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 340 }}
      card={{
        width: 340,
        maxWidth: 'calc(100vw - 32px)',
        boxSizing: 'border-box',
        borderRadius: 18,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        padding: '20px 20px 16px',
        animation: 'mf-fade .2s ease',
      }}
      cardAttrs={{ 'data-delete-confirm': '1' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>{title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--mf-muted)', lineHeight: 1.6 }}>{body}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {deleting && <DeletingNote />}
          <button
            type="button"
            data-confirm-cancel
            disabled={deleting}
            onClick={onCancel}
            className="mf-ctl"
            style={{ height: isMobile ? 44 : 34, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1 }}
          >
            취소
          </button>
          <button
            type="button"
            data-confirm-delete
            disabled={deleting}
            onClick={onConfirm}
            className="mf-ctl"
            style={{ height: isMobile ? 44 : 34, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-danger-line)', background: 'var(--mf-danger-bg)', color: 'var(--mf-danger)', font: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1 }}
          >
            삭제
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 지우는 중 — 스피너 + 한 마디(확인·범위 팝업이 함께 쓴다). */
export function DeletingNote() {
  return (
    <span data-deleting style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginRight: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--mf-muted)' }}>
      <span aria-hidden="true" style={{ width: 14, height: 14, border: '2px solid var(--mf-hairline)', borderTopColor: 'var(--mf-accent)', borderRadius: 999, animation: 'mf-spin .7s linear infinite', display: 'block' }} />
      삭제 중…
    </span>
  );
}

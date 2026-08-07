import { useEffect, useRef } from 'react';
import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/**
 * "맵 이름 변경" — 카드 메뉴에서 연다(요청).
 *
 * 폴더 이름 변경(`FolderModal`)과 같은 꼴이지만 저장이 즉시 끝나지 않는다: 목록의
 * 메타 제목과 **문서 본문의 루트 글자**를 함께 고쳐야 해서 왕복이 있다
 * (`useHomeController`의 `applyMapTitle`). 그래서 저장 중에는 버튼을 잠그고,
 * 실패하면 팝업을 닫지 않고 사유를 보여 준 채 다시 시도할 수 있게 둔다.
 */
export function MapRenameModal({ state, controller }: Props) {
  const rm = state.renameMap;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = !!rm;
  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [open]);

  const canSave = !!rm && rm.name.trim().length > 0 && !rm.saving;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: rm ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 130 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 380, background: 'var(--mf-panel)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>맵 이름 변경</div>
        <div style={{ fontSize: 13, color: 'var(--mf-muted)', lineHeight: 1.6, marginBottom: 20 }}>맵을 열었을 때 보이는 가운데 주제도 함께 바뀌어요.</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>맵 이름</div>
        <input
          ref={inputRef}
          className="ns-input"
          value={rm?.name || ''}
          onInput={(e) => controller.onRenameMapName((e.target as HTMLInputElement).value)}
          onKeyDown={controller.onRenameMapKey}
          onMouseDown={(e) => e.stopPropagation()}
          maxLength={40}
          placeholder="예: 주간 회의 (최대 40자)"
          aria-label="맵 이름"
          style={{ width: '100%', height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel2)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: rm?.error ? 10 : 24 }}
        />
        {rm?.error && (
          <div role="alert" style={{ fontSize: 12.5, color: 'var(--mf-danger)', lineHeight: 1.5, marginBottom: 18 }}>
            {rm.error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.closeRenameMap} style={{ flex: 1, height: 44, border: '1px solid var(--mf-border)', borderRadius: 11, background: 'var(--mf-panel)', color: 'var(--mf-text)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.saveRenameMap}
            style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canSave ? 'var(--mf-accent)' : 'var(--mf-accent-mute)', color: 'var(--mf-accent-ink)', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}
          >
            {rm?.saving ? '변경 중…' : '변경'}
          </button>
        </div>
      </div>
    </div>
  );
}

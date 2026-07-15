import type { HomeState } from '../../types';
import type { HomeController } from '../../useHomeController';

interface Props {
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:416-427 — "새 폴더 만들기" / "폴더 이름 변경" modal (shared by mode). */
export function FolderModal({ state, controller }: Props) {
  const fm = state.folderModal;
  const isRename = fm?.mode === 'rename';
  const canSave = !!fm && fm.name.trim().length > 0;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,14,.42)', backdropFilter: 'blur(2px)', display: fm ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 130 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 380, background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.28)', padding: 26, animation: 'mf-fade .2s ease' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{isRename ? '폴더 이름 변경' : '새 폴더 만들기'}</div>
        <div style={{ fontSize: 13, color: '#9c8b7e', lineHeight: 1.6, marginBottom: 20 }}>폴더로 공간 안의 맵을 정리해요.</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>폴더 이름</div>
        <input
          className="ns-input"
          value={fm?.name || ''}
          onInput={(e) => controller.onFolderModalName((e.target as HTMLInputElement).value)}
          onKeyDown={controller.onFolderModalKey}
          onMouseDown={(e) => e.stopPropagation()}
          maxLength={10}
          placeholder="예: 기획 (최대 10자)"
          aria-label="폴더 이름"
          style={{ width: '100%', height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#faf3ee', color: '#33281f', fontFamily: 'inherit', fontSize: 14, padding: '0 13px', outline: 'none', boxSizing: 'border-box', marginBottom: 24 }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={controller.closeFolderModal} style={{ flex: 1, height: 44, border: '1px solid #ecdfd5', borderRadius: 11, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            취소
          </button>
          <button
            className="btn"
            onClick={controller.saveFolderModal}
            style={{ flex: 1, height: 44, border: 'none', borderRadius: 11, background: canSave ? '#f0663f' : '#f2c4b3', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}
          >
            {isRename ? '변경' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}

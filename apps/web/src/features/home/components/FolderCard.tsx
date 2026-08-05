import type { DragEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { FolderCardViewData } from '../viewModel';

interface Props {
  folder: FolderCardViewData;
  controller: HomeController;
}

/** Home.dc.html:229-243 / driveFolderCards — a folder tile (local space or Google Drive). */
export function FolderCard({ folder, controller }: Props) {
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    controller.setDragOverFolder(folder.id);
  };
  const onDragLeave = () => controller.setDragOverFolder(null);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = controller.state.draggingMap || e.dataTransfer.getData('text/plain');
    if (t) controller.moveMapToFolder(t, folder.id);
    controller.clearDrag();
  };
  const onOpen = () => (folder.isDrive ? controller.openDriveFolder(folder.id) : controller.openFolder(folder.id));

  return (
    <div
      className="map-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        border: folder.dragOver ? '2px dashed var(--mf-accent)' : '1px solid var(--mf-border)',
        borderRadius: 14,
        background: folder.dragOver ? 'var(--mf-accent-soft)' : 'var(--mf-panel)',
        cursor: 'pointer',
        transition: 'border-color .14s, box-shadow .14s, background .14s',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: folder.dragOver ? '17px 17px' : '18px 18px',
        boxShadow: folder.dragOver ? '0 6px 18px rgba(var(--mf-accent-rgb),.18)' : 'none',
      }}
    >
      <div
        className="menu-btn"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          controller.toggleMenu('folder:' + folder.id);
        }}
        title="메뉴"
        aria-label="메뉴"
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 4, width: 28, height: 28, borderRadius: 8, background: 'var(--mf-panel-veil)', border: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, color: 'var(--mf-subtext)', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,.12)', opacity: folder.menuOpen ? 1 : 0, transition: 'opacity .15s' }}
      >
        ☰
      </div>
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{ position: 'absolute', top: 44, right: 10, zIndex: 20, width: 150, background: 'var(--mf-panel)', border: '1px solid var(--mf-border)', borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)', padding: '5px 0', display: folder.menuOpen ? 'block' : 'none' }}
      >
        <div
          className="menu-row"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (folder.isDrive) controller.startRenameDriveFolder(folder.id);
            else controller.startRenameFolder(folder.id);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: 'var(--mf-text)' }}
        >
          <span style={{ display: 'flex', color: 'var(--mf-subtext)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </span>{' '}
          이름 변경
        </div>
        <div style={{ height: 1, background: 'var(--mf-border-soft)', margin: '2px 0' }} />
        <div
          className="menu-row"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            controller.askDeleteFolder(folder.id);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: folder.canDelete ? 'pointer' : 'not-allowed', color: folder.canDelete ? 'var(--mf-danger)' : 'var(--mf-faint2)' }}
        >
          <span style={{ display: 'flex' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </span>{' '}
          폴더 삭제
        </div>
      </div>

      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fillOpacity=".18" />
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</div>
        <div style={{ fontSize: 12, color: 'var(--mf-muted)', marginTop: 3 }}>맵 {folder.count}개</div>
      </div>
    </div>
  );
}

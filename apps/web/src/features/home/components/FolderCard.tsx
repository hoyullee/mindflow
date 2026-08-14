import type { DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { FolderCardViewData } from '../viewModel';
import { folderCardKey } from '../viewModel';
import { useCardActivation } from './useCardActivation';

interface Props {
  folder: FolderCardViewData;
  controller: HomeController;
}

/** Home.dc.html:229-243 / driveFolderCards — a folder tile (local space or Google Drive). */
export function FolderCard({ folder, controller }: Props) {
  // 맵 카드와 같은 규칙 — 한 번 = 선택 / 두 번 = 진입(사용자 요청). 폴더만 한 번에
  // 들어가면 같은 그리드 안에서 카드마다 클릭의 뜻이 달라진다.
  const activation = useCardActivation();
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    controller.setDragOverFolder(folder.id);
  };
  const onDragLeave = () => controller.setDragOverFolder(null);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = controller.state.draggingMap || e.dataTransfer.getData('text/plain');
    // 선택 전체를 끌고 있으면 함께 옮긴다(잡은 카드가 선택 밖이면 그 한 장).
    if (t) controller.moveMapsToFolder(controller.dragKeys(t), folder.id);
    controller.clearDrag();
  };
  const enter = () => (folder.isDrive ? controller.openDriveFolder(folder.id) : controller.openFolder(folder.id));
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest && target.closest('.menu-btn,.menu-row')) return;
    if (activation.click() === 'activate') {
      enter();
      return;
    }
    controller.selectCard(folderCardKey(folder.id)); // 선택 → ☰ 메뉴가 이 폴더의 것으로 드러난다
  };
  // 우클릭 = ☰과 같은 메뉴, 커서 자리에(요청).
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    controller.selectCard(folderCardKey(folder.id));
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'folder', id: folder.id });
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest && target.closest('.menu-btn,.menu-row')) return;
    if (!activation.acceptDoubleClick()) return;
    enter();
  };

  return (
    <div
      className="map-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        // 키보드는 Enter/Space 한 번으로 진입한다 — 포인터의 "두 번"에 대응하는
        // 관용구가 없고, 접근성 관점에서도 활성화 키는 곧 실행이다.
        if (e.key === 'Enter' || e.key === ' ') enter();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        border: folder.dragOver ? '2px dashed var(--mf-accent)' : folder.selected ? '2px solid var(--mf-accent)' : '1px solid var(--mf-border)',
        borderRadius: 14,
        background: folder.dragOver ? 'var(--mf-accent-soft)' : 'var(--mf-panel)',
        cursor: 'pointer',
        transition: 'border-color .14s, box-shadow .14s, background .14s',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        // 2px 테두리가 되는 상태(드롭 대기·선택)에서도 **안쪽 좌표계가 흔들리지 않게**
        // 패딩은 그대로 두고 **음수 마진**으로 늘어난 1px을 상쇄한다(맵 카드와 같은 방식).
        //
        // 예전엔 패딩을 18→17로 줄여 크기를 맞췄는데, 그러면 카드 겉면은 그대로여도
        // **패딩 박스**가 1px 안쪽으로 들어간다. ☰ 버튼은 `position: absolute`의
        // `top/right`로 그 패딩 박스에 붙어 있어서, 폴더를 선택하는 순간 버튼만
        // (-1, +1)px 움직였다(제보 — 실측으로 확인). 마진으로 상쇄하면 테두리가
        // 두꺼워진 만큼 바깥으로 나가므로 패딩 박스 위치가 그대로다.
        padding: '18px 18px',
        margin: folder.dragOver || folder.selected ? -1 : 0,
        boxShadow: folder.dragOver ? '0 6px 18px rgba(var(--mf-accent-rgb),.18)' : folder.selected ? '0 0 0 3px rgba(var(--mf-accent-rgb),.18)' : 'none',
      }}
    >
      <div
        className="menu-btn"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          controller.openCtxMenu(r.right - 184, r.bottom + 6, { kind: 'folder', id: folder.id });
        }}
        title="메뉴"
        aria-label="메뉴"
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 4, width: 28, height: 28, borderRadius: 8, background: 'var(--mf-panel-veil)', border: '1px solid var(--mf-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, lineHeight: 1, color: 'var(--mf-subtext)', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,.12)', opacity: folder.menuOpen ? 1 : 0, transition: 'opacity .15s' }}
      >
        ☰
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

import type { DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { ParentTileViewData } from '../viewModel';
import { PARENT_DROP_ID } from '../viewModel';
import { useCardActivation } from './useCardActivation';

interface Props {
  tile: ParentTileViewData;
  controller: HomeController;
}

/**
 * 폴더 안에서 그리드 맨 앞에 서는 **상위 폴더 타일**(`..`) — 뒤로 가는 길이자
 * **드롭 대상**이다(요청).
 *
 * 왜 만들었나: 아래로는 폴더 카드에 끌어다 놓으면 되는데 위로 꺼내려면 우클릭
 * 메뉴의 "폴더에서 꺼내기"뿐이었다(제보) — 같은 조작이 방향에 따라 다른 도구를
 * 요구했다. 파일 탐색기의 `..` 관례를 그대로 쓴다: 목록 안에 있으니 눈에 띄고,
 * 끌어다 놓을 자리가 화면에 실제로 존재한다.
 *
 * 클릭 규칙: **폴더 카드와 같다 — 두 번 눌러야 올라간다**(제보). 한 번에 올라가게
 * 했더니 폴더를 더블클릭해 들어오는 순간, 두 번째 클릭이 그 자리에 새로 그려진 이
 * 타일에 떨어져 글자가 통째로 선택된 것처럼 보였다. 같은 그리드 안에서 카드마다
 * 클릭의 뜻이 다른 것도 이상하다. `useCardActivation`을 그대로 쓰므로 **다른 것을
 * 누른 뒤 이 타일에 떨어지는 dblclick은 무시된다**(#317의 문지기) — 폴더 진입 직후
 * 곧바로 한 계층 더 올라가 버리는 일이 없다.
 */
export function ParentFolderCard({ tile, controller }: Props) {
  const activation = useCardActivation();
  const onClick = () => {
    // 모바일은 두 번째 탭에서 'activate'가 온다(dblclick을 못 믿는다).
    if (activation.click() === 'activate') controller.backToSpace();
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); // 더블클릭이 남기는 텍스트 선택을 지운다
    if (!activation.acceptDoubleClick()) return;
    controller.backToSpace();
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    controller.setDragOverFolder(PARENT_DROP_ID);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const key = controller.state.draggingMap || e.dataTransfer.getData('text/plain');
    // 선택 전체를 끌고 있으면 함께 꺼낸다(폴더 카드 드롭과 같은 규칙).
    if (key) controller.dragKeys(key).forEach((k) => controller.moveMapUp(k));
    controller.clearDrag();
  };

  return (
    <div
      data-parent-tile
      className="map-card"
      role="button"
      tabIndex={0}
      title={`${tile.name}(으)로 올라가기(두 번 클릭) · 맵을 끌어다 놓으면 옮겨져요`}
      aria-label={`상위 폴더 ${tile.name}(으)로 이동`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') controller.backToSpace();
      }}
      onDragOver={onDragOver}
      onDragLeave={() => controller.setDragOverFolder(null)}
      onDrop={onDrop}
      style={{
        // 폴더 카드와 같은 골격(같은 줄에 서므로) — 다만 점선 테두리로 "내용이 아니라
        // 길"임을 알린다. 드롭 대기 상태의 표시는 폴더 카드와 똑같다.
        border: tile.dragOver ? '2px dashed var(--mf-accent)' : '1px dashed var(--mf-border)',
        borderRadius: 14,
        background: tile.dragOver ? 'var(--mf-accent-soft)' : 'var(--mf-sunken)',
        cursor: 'pointer',
        transition: 'border-color .14s, box-shadow .14s, background .14s',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '18px 18px',
        // 두 번 클릭이 글자를 선택하지 않게(제보) — 이 타일은 읽을 글이 아니라 버튼이다.
        userSelect: 'none',
        margin: tile.dragOver ? -1 : 0,
        boxShadow: tile.dragOver ? '0 6px 18px rgba(var(--mf-accent-rgb),.18)' : 'none',
      }}
    >
      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--mf-panel)', color: 'var(--mf-subtext)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--mf-border-soft)' }}>
        {/* 폴더 + 위쪽 화살표 — "이 폴더 밖(위)으로" */}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <path d="M12 17v-6" />
          <path d="M9.2 13.4 12 10.6l2.8 2.8" />
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>상위 폴더</div>
        <div style={{ fontSize: 12, color: 'var(--mf-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tile.name}</div>
      </div>
    </div>
  );
}

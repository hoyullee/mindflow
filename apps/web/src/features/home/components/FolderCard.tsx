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
  // 모바일 선택 모드에서는 폴더가 **반응하지 않는다**(흐리게 표시). 폴더는 다중 선택
  // 대상이 아니라서, 여기서 `selectCard`가 돌면 맵 선택이 비워진 채 모드만 남아
  // "0개 선택" 바가 뜬다. 진입도 마찬가지 — 고른 맵을 두고 다른 목록으로 넘어가면
  // 무엇을 고르고 있었는지 흐려진다. 먼저 선택을 끝내고(또는 ✕) 폴더로 간다.
  const selectMode = controller.state.selectMode;
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
    if (selectMode) return;
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
    if (selectMode) return;
    controller.selectCard(folderCardKey(folder.id));
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'folder', id: folder.id });
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (selectMode) return;
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
        if (selectMode) return;
        if (e.key === 'Enter' || e.key === ' ') enter();
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        // 드롭 대기만 테두리가 바뀐다(점선 = "여기에 넣는다") — 선택은 outline 링
        // (디자인 원본, 맵 카드와 같은 문법)이라 테두리·패딩 박스가 흔들리지 않는다.
        border: folder.dragOver ? '2px dashed var(--mf-accent)' : '1px solid var(--mf-border)',
        outline: folder.selected && !folder.dragOver ? '2px solid var(--mf-accent)' : '2px solid transparent',
        outlineOffset: 2,
        borderRadius: 16,
        background: folder.dragOver ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
        cursor: selectMode ? 'default' : 'pointer',
        opacity: selectMode ? 0.45 : 1,
        // transition은 home.css의 `.map-card` 규칙이 정한다(transform 포함 — 인라인로
        // 덮으면 hover 떠오름이 전이 없이 툭 바뀐다).
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '14px',
        margin: folder.dragOver ? -1 : 0,
        // 맵 카드와 같은 그늘 — 폴더도 면 위에 떠 있다(디자인 원본).
        boxShadow: folder.dragOver ? '0 6px 18px rgba(var(--mf-accent-rgb),.18)' : 'var(--mf-card-shadow)',
      }}
    >

      {/* 아이콘 타일 — 옅은 세로 그라디언트 + 선 아이콘(디자인 원본). 강조색을 쓰지
          않는 이유: 폴더는 강조 대상이 아니라 담는 그릇이고, 강조색은 지금 "선택"과
          1차 버튼이 쓴다. */}
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: 'linear-gradient(180deg, var(--mf-accent-soft), var(--mf-panel2))',
          border: '1px solid var(--mf-border)',
          color: 'var(--mf-accent-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h5l2 2h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        </svg>
      </div>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--mf-muted)' }}>파일 {folder.count}개</div>
      </div>
      {/* ⋯ 메뉴 — 오른쪽 **세로 중앙**(요청). 예전에는 우상단 absolute였는데 hover의
          진입 셰브론과 겹쳤다 — 셰브론을 없애고 이 자리 하나만 남긴다(들어가는 길은
          더블클릭·Enter가 이미 말한다). 면·테두리 없는 점 셋(요청 4). */}
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
        style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 9, background: 'transparent', border: 'none', display: selectMode ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mf-subtext)', cursor: 'pointer', opacity: folder.menuOpen ? 1 : 0, transform: folder.menuOpen ? 'translateY(0)' : 'translateY(2px)', transition: 'opacity .18s ease, transform .18s ease, background .15s ease' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </div>
    </div>
  );
}

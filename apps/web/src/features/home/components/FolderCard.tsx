import type { DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { FolderCardViewData } from '../viewModel';
import { folderCardKey } from '../viewModel';
import { useCardActivation } from './useCardActivation';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { useLongPressSelect } from './useLongPressSelect';

interface Props {
  folder: FolderCardViewData;
  controller: HomeController;
}

/** Home.dc.html:229-243 / driveFolderCards — a folder tile (local space or Google Drive). */
export function FolderCard({ folder, controller }: Props) {
  // 맵 카드와 같은 규칙 — 한 번 = 선택 / 두 번 = 진입(사용자 요청). 폴더만 한 번에
  // 들어가면 같은 그리드 안에서 카드마다 클릭의 뜻이 달라진다.
  const activation = useCardActivation();
  // **모바일 선택 모드에서도 폴더를 고른다**(요청: 폴더도 다중 선택). 예전에는 폴더가
  // 다중 선택 대상이 아니라서 모드 안에서는 흐리게 죽여 뒀다 — 그 이유가 사라졌다.
  // 모드 안의 탭은 맵과 똑같이 **체크 토글**이고, 진입(더블탭)은 그대로 꺼진다:
  // 고른 것을 두고 다른 목록으로 넘어가면 무엇을 고르고 있었는지 흐려진다.
  const selectMode = controller.state.selectMode;
  const key = folderCardKey(folder.id);
  // 선택 모드는 **모바일 레이아웃에서만** 켠다 — 선택 바가 모바일 툴바 자리를 쓰기
  // 때문이다(맵 카드와 같은 판단·같은 기계).
  const isMobile = useIsMobile();
  const hold = useLongPressSelect({
    cardKey: key,
    armed: isMobile && !selectMode,
    active: selectMode,
    onEnter: controller.enterSelectMode,
    skip: '.menu-btn,.menu-row',
  });
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
    // 길게 누르기로 방금 모드에 들어왔다 — 손을 떼며 따라오는 이 클릭은 토글이 아니다.
    if (hold.swallowClick.current) {
      hold.swallowClick.current = false;
      return;
    }
    // 선택 모드 안의 탭 = 체크 토글(맵 카드와 같은 규칙).
    if (selectMode) {
      controller.toggleCardSelected(key);
      return;
    }
    // 수정 키를 쥔 클릭은 **선택을 고치는 동작**이지 여는 동작이 아니다(맵 카드와
    // 같은 규칙) — 여기서 활성화 판정을 태우면 Ctrl+클릭 두 번이 폴더를 열어 버린다.
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      controller.selectCard(key, { additive, range });
      return;
    }
    if (activation.click() === 'activate') {
      enter();
      return;
    }
    controller.selectCard(key); // 선택 → ☰ 메뉴가 이 폴더의 것으로 드러난다
  };
  // 우클릭 = ☰과 같은 메뉴, 커서 자리에(요청).
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // 터치의 `contextmenu`는 곧 **길게 누르기**다 — 그 뜻은 선택 모드 진입이고,
    // 폴더 메뉴는 ⋯이 맡는다(맵 카드와 같은 규칙).
    if (hold.wasTouch.current && isMobile) {
      hold.begin();
      return;
    }
    if (selectMode) return;
    // 여러 개를 골라 두고 그중 하나를 우클릭하면 **선택을 그대로 두고** 일괄 메뉴를
    // 연다(맵 카드와 같은 규칙) — 선택 밖에서 왔으면 그 폴더 하나로 바꾼다.
    if (!controller.state.selectedCards.includes(key)) controller.selectCard(key);
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
      // 마퀴(드래그 사각형)·Shift 범위·Ctrl+A가 **화면에 그려진 순서**를 이 표식으로
      // 읽는다(맵 카드와 같은 이름) — 폴더가 다중 선택에 끼려면 여기 있어야 한다.
      data-card-key={key}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerDown={hold.onPointerDown}
      onPointerMove={hold.onPointerMove}
      onPointerUp={hold.onPointerUp}
      onPointerCancel={hold.onPointerCancel}
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
        cursor: 'pointer',
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

      {/* 선택 모드의 체크 표시 — 맵 카드와 같은 동그라미·같은 자리(왼쪽 위).
          카드 전체가 이미 터치 타깃이라 이것은 누르는 버튼이 아니라 **상태 표시**다. */}
      {selectMode && (
        <div
          data-select-check
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 4,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: folder.selected ? 'var(--mf-accent)' : 'var(--mf-panel-veil)',
            border: `1.5px solid ${folder.selected ? 'var(--mf-accent)' : 'var(--mf-border)'}`,
            color: 'var(--mf-accent-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,.12)',
          }}
        >
          {folder.selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

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

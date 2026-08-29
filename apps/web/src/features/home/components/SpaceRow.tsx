import type { DragEvent, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState, SpaceData } from '../types';
import { ArrowPair } from './DashboardSection';
import { isSpaceView } from '../viewModel';

interface Props {
  space: SpaceData;
  state: HomeState;
  controller: HomeController;
  /** 순서 바꾸기(끌기·↑/↓)용 위치 — 목록에서의 내 자리와 전체 수. */
  index: number;
  total: number;
}

/** 스페이스 행 드래그의 출발 인덱스 — 행들이 하나의 목록을 이루므로 모듈 공유로 충분하다. */
const spaceDragFrom: { current: number | null } = { current: null };

/** Home.dc.html:104-127 `<sc-for list="{{ spaceList }}">` — one row in the sidebar space list. */
export function SpaceRow({ space, state, controller, index, total }: Props) {
  // 활성 표시는 **지금 스페이스 화면일 때만** — 일정·대시보드를 보고 있으면
  // 어느 스페이스도 켜지지 않는다(고른 항목 하나에만 포커스가 있어야 한다).
  const active = space.id === state.activeSpace && isSpaceView(state);
  const reorder = state.spaceReorder;
  const menuOpen = state.ctxMenu?.target.kind === 'space' && state.ctxMenu.target.id === space.id;

  // ⋮ 버튼과 우클릭이 같은 메뉴를 연다 — 홈의 카드·폴더와 같은 규칙(공용
  // `HomeContextMenu`). 버튼은 그 아래, 우클릭은 커서 자리에.
  const onMenuClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    controller.openCtxMenu(r.right - 184, r.bottom + 6, { kind: 'space', id: space.id });
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation(); // LNB의 나머지 우클릭 차단(Sidebar)까지 가지 않게
    controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'space', id: space.id });
  };

  return (
    <div
      className="space-row"
      onContextMenu={onContextMenu}
      style={{ position: 'relative' }}
      draggable={reorder}
      onDragStart={(e: DragEvent) => {
        spaceDragFrom.current = index;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        spaceDragFrom.current = null;
      }}
      onDragOver={(e: DragEvent) => {
        if (reorder && spaceDragFrom.current !== null) e.preventDefault();
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        if (spaceDragFrom.current !== null && spaceDragFrom.current !== index) controller.reorderSpace(spaceDragFrom.current, index);
        spaceDragFrom.current = null;
      }}
    >
      <div
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={() => controller.setActiveSpace(space.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            controller.setActiveSpace(space.id);
          }
        }}
        style={{
          // 디자인 원본: 8/9 패딩 · r10 · 13px. 활성 행만 옅은 강조색 면과 굵은 글씨.
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 9px',
          borderRadius: 10,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          letterSpacing: '-.01em',
          background: active ? 'var(--mf-accent-soft)' : 'transparent',
          color: active ? 'var(--mf-text)' : 'var(--mf-subtext)',
          transition: 'background .14s ease',
        }}
      >
        {/* Every space (including the home "일반 스페이스") shows the same colored dot;
            the home space's default color is the coral accent (#f0663f) — 테마가 아니라
            스페이스에 저장된 **데이터** 색이므로 변수로 바꾸지 않는다.
            디자인 원본은 이 표식을 **작은 사각**(9px, r3)으로 둔다 — 툴바 제목 앞의
            사각과 같은 꼴이라 "지금 이 스페이스"가 두 자리에서 같은 표식으로 읽힌다. */}
        <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: space.color || '#f0663f', display: 'block' }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
        {reorder && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, marginLeft: 'auto', flexShrink: 0 }}>
            <ArrowPair
              upDisabled={index === 0}
              downDisabled={index === total - 1}
              onUp={(e) => {
                e.stopPropagation();
                controller.reorderSpace(index, index - 1);
              }}
              onDown={(e) => {
                e.stopPropagation();
                controller.reorderSpace(index, index + 1);
              }}
            />
          </span>
        )}
        <span
          className="space-dot"
          role="button"
          tabIndex={0}
          aria-label="스페이스 메뉴"
          onClick={onMenuClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onMenuClick(e as unknown as MouseEvent<HTMLSpanElement>);
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, marginLeft: 'auto', flexShrink: 0, color: 'var(--mf-muted)', cursor: 'pointer', opacity: menuOpen ? 1 : 0, transition: 'opacity .15s' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </span>
      </div>

    </div>
  );
}

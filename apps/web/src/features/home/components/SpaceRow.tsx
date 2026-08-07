import type { MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState, SpaceData } from '../types';

interface Props {
  space: SpaceData;
  state: HomeState;
  controller: HomeController;
}

/** Home.dc.html:104-127 `<sc-for list="{{ spaceList }}">` — one row in the sidebar space list. */
export function SpaceRow({ space, state, controller }: Props) {
  const active = space.id === state.activeSpace;
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
    <div className="space-row" onContextMenu={onContextMenu} style={{ position: 'relative' }}>
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
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 10px',
          borderRadius: 9,
          cursor: 'pointer',
          fontSize: 13.5,
          fontWeight: active ? 600 : 500,
          background: active ? 'var(--mf-accent-soft)' : 'transparent',
          color: active ? 'var(--mf-accent-strong)' : 'var(--mf-subtext)',
        }}
      >
        {/* Every space (including the home "일반 스페이스") shows the same colored dot;
            the home space's default color is the coral accent (#f0663f) — 테마가 아니라
            스페이스에 저장된 **데이터** 색이므로 변수로 바꾸지 않는다. */}
        <span style={{ width: 15, height: 15, borderRadius: 5, flexShrink: 0, background: space.color || '#f0663f', display: 'inline-block' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
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

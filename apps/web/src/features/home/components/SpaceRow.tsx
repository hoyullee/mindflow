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
  const menuOpen = state.spaceMenu === space.id;
  const editing = state.editingSpace === space.id;
  const hasMaps = Array.isArray(space.maps) && space.maps.some((m) => !state.deleted[m.title]);
  const isLastSpace = state.spaces.length <= 1;
  const anchor = controller.spaceMenuAnchor.current;

  const onMenuClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    controller.setSpaceMenuAnchor({ top: r.bottom + 6, left: Math.max(8, r.right - 168) });
    controller.toggleSpaceMenu(space.id);
  };

  return (
    <div className="space-row" style={{ position: 'relative' }}>
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
          background: active ? '#fdeee7' : 'transparent',
          color: active ? '#d9542f' : '#7c6d60',
        }}
      >
        <span style={space.home ? { fontSize: 15, width: 15, textAlign: 'center', flexShrink: 0 } : { width: 15, height: 15, borderRadius: 5, flexShrink: 0, background: space.color, display: 'inline-block' }}>
          {space.home ? '⌂' : ''}
        </span>
        {editing ? (
          <input
            value={state.editingSpaceName}
            onInput={(e) => controller.onRenameSpaceInput((e.target as HTMLInputElement).value)}
            onKeyDown={controller.onRenameSpaceKey}
            onBlur={controller.commitRenameSpace}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            maxLength={10}
            aria-label="공간 이름"
            style={{ flex: 1, minWidth: 0, height: 24, border: '1px solid #f0663f', borderRadius: 6, background: '#fff', color: '#33281f', fontFamily: 'inherit', fontSize: 13, padding: '0 7px', outline: 'none' }}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
        )}
        <span
          className="space-dot"
          role="button"
          tabIndex={0}
          aria-label="공간 메뉴"
          onClick={onMenuClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onMenuClick(e as unknown as MouseEvent<HTMLSpanElement>);
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, marginLeft: 'auto', flexShrink: 0, color: '#9c8b7e', cursor: 'pointer', opacity: menuOpen ? 1 : 0, transition: 'opacity .15s' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </span>
      </div>

      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          position: 'fixed',
          top: menuOpen && anchor ? anchor.top : -9999,
          left: menuOpen && anchor ? anchor.left : -9999,
          zIndex: 60,
          width: 168,
          background: '#fff',
          border: '1px solid #ecdfd5',
          borderRadius: 10,
          boxShadow: '0 10px 28px rgba(0,0,0,.16)',
          padding: '5px 0',
          display: menuOpen ? 'block' : 'none',
        }}
      >
        <div
          className="menu-row"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            controller.startRenameSpace(space.id);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: 'pointer', color: '#33281f' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>{' '}
          이름 변경
        </div>
        <div style={{ height: 1, background: '#f0e6dd', margin: '2px 0' }} />
        <div
          className="menu-row"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            controller.askDeleteSpace(space.id);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', fontSize: 13, cursor: hasMaps || isLastSpace ? 'not-allowed' : 'pointer', color: hasMaps || isLastSpace ? '#c9b8a9' : '#d64545' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>{' '}
          공간 삭제
        </div>
        {(hasMaps || isLastSpace) && <div style={{ padding: '2px 13px 8px', fontSize: 11, color: '#c9b8a9', lineHeight: 1.4 }}>{hasMaps ? '맵이 없는 공간만 삭제할 수 있어요' : '마지막 공간은 삭제할 수 없어요'}</div>}
      </div>
    </div>
  );
}

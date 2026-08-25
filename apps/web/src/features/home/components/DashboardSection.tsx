import { useRef, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { META_MONO, SECTION_LABEL } from '../chrome';

/**
 * LNB 대시보드 구획 — 디자인 원본 `Geurio 홈 대시보드.dc.html`의 dashList.
 *
 * 행 하나 = 대시보드 하나. 맨 위가 **기본**(배지)이고, 헤더의 ⠿ 토글로 순서
 * 바꾸기 모드에 들어가면 행을 끌거나 ↑/↓ 버튼으로 옮긴다(둘 다 디자인 원본).
 * 행 우클릭은 공용 `HomeContextMenu`(이름 변경·삭제 — 스페이스 행과 같은 문법).
 */
export function DashboardSection({ state, controller, isMobile = false }: { state: HomeState; controller: HomeController; isMobile?: boolean }) {
  const dragFrom = useRef<number | null>(null);
  const reorder = state.dashReorder;

  const rowDrag = (idx: number) => ({
    draggable: reorder,
    onDragStart: (e: DragEvent) => {
      dragFrom.current = idx;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      dragFrom.current = null;
    },
    onDragOver: (e: DragEvent) => {
      if (reorder && dragFrom.current !== null) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragFrom.current !== null && dragFrom.current !== idx) controller.reorderDash(dragFrom.current, idx);
      dragFrom.current = null;
    },
  });

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 9px 7px' }}>
        <span style={SECTION_LABEL}>대시보드</span>
        {/* 정렬 모드 힌트 문구는 두지 않는다(제보: 시끄럽다) — ↑/↓ 버튼과 grab 커서가
            이미 "옮길 수 있다"를 말하고, 맨 위 행의 '기본' 배지가 순서의 뜻을 말한다. */}
        <ReorderToggle on={reorder} label="대시보드 순서 바꾸기" onClick={controller.toggleDashReorder} />
      </div>

      {state.dashboards.map((d, idx) => {
        const active = state.activeDash === d.id;
        return (
          <div
            key={d.id}
            className="nav-item"
            role="button"
            tabIndex={0}
            {...rowDrag(idx)}
            onClick={() => controller.selectDash(d.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                controller.selectDash(d.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              controller.openCtxMenuAt(e.clientX, e.clientY, { kind: 'dash', id: d.id });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 9px',
              minHeight: isMobile ? 44 : 34,
              borderRadius: 10,
              cursor: reorder ? 'grab' : 'pointer',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              letterSpacing: '-.01em',
              background: active ? 'var(--mf-accent-soft)' : 'transparent',
              color: active ? 'var(--mf-text)' : 'var(--mf-subtext)',
              transition: 'background .14s ease',
            }}
          >
            {/* 격자 글리프(디자인 원본) — 스페이스의 색 점과 구별되는 이 구획의 표식. */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--mf-accent)' : 'currentColor'} strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="1.6" />
              <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.6" />
              <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.6" />
              <rect x="13" y="11" width="7.5" height="9.5" rx="1.6" />
            </svg>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <span style={{ flexShrink: 0, minWidth: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
              {/* 맨 위 = 기본(디자인) — 앞으로 "첫 화면을 대시보드로" 같은 결정의 기준이 된다. */}
              {idx === 0 && (
                <span style={{ height: 16, padding: '0 6px', borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-strong)', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', letterSpacing: '.02em' }}>기본</span>
              )}
              {reorder ? (
                <ArrowPair
                  upDisabled={idx === 0}
                  downDisabled={idx === state.dashboards.length - 1}
                  onUp={(e) => {
                    e.stopPropagation();
                    controller.reorderDash(idx, idx - 1);
                  }}
                  onDown={(e) => {
                    e.stopPropagation();
                    controller.reorderDash(idx, idx + 1);
                  }}
                />
              ) : (
                <span style={META_MONO}>{d.items.length || ''}</span>
              )}
            </span>
          </div>
        );
      })}

      <div
        className="nav-item"
        role="button"
        tabIndex={0}
        onClick={controller.createDash}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') controller.createDash();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', marginTop: 2, minHeight: isMobile ? 44 : undefined, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--mf-muted)' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M12 5v14M5 12h14" />
        </svg>
        새 대시보드
      </div>
    </div>
  );
}

/** ⠿ 순서 바꾸기 토글 — 대시보드·스페이스 두 구획이 같은 것을 쓴다(디자인). */
export function ReorderToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn"
      title="순서 바꾸기"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        border: 0,
        borderRadius: 7,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: on ? 'var(--mf-accent-strong)' : 'var(--mf-faint)',
        background: on ? 'var(--mf-accent-soft)' : 'transparent',
        cursor: 'pointer',
        transition: 'background .13s ease',
        padding: 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
        <circle cx="9" cy="5" r="1.7" />
        <circle cx="15" cy="5" r="1.7" />
        <circle cx="9" cy="12" r="1.7" />
        <circle cx="15" cy="12" r="1.7" />
        <circle cx="9" cy="19" r="1.7" />
        <circle cx="15" cy="19" r="1.7" />
      </svg>
    </button>
  );
}

/** 순서 바꾸기 모드의 ↑/↓ 쌍 — 드래그의 키보드/정밀 대체 수단(디자인 원본). */
export function ArrowPair({ upDisabled, downDisabled, onUp, onDown }: { upDisabled: boolean; downDisabled: boolean; onUp: (e: MouseEvent) => void; onDown: (e: MouseEvent) => void }) {
  const btn = (disabled: boolean): CSSProperties => ({
    width: 18,
    height: 18,
    border: 0,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: disabled ? 'var(--mf-faint2)' : 'var(--mf-subtext)',
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
  });
  return (
    <>
      <button type="button" className="btn" aria-label="위로" title="위로" disabled={upDisabled} onClick={onUp} style={btn(upDisabled)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
      <button type="button" className="btn" aria-label="아래로" title="아래로" disabled={downDisabled} onClick={onDown} style={btn(downDisabled)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </>
  );
}

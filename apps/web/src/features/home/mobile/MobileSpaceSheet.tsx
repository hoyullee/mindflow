// 스페이스 고르기 시트(모바일 홈 디자인 M2의 시트) — 스페이스 이름을 누르면 바닥에서 올라온다.
//
// LNB의 스페이스 목록을 대신한다: 고르기 · 순서 편집 · 새 스페이스. 이름·색·삭제는 LNB와 **같은
// 메뉴**(`HomeContextMenu`의 스페이스 메뉴)를 순서 편집의 ⋯로 연다 — 메뉴를 두 벌 두면 한쪽에만
// 새 항목이 생긴다. 메뉴를 열기 전에 시트를 닫는 이유: 메뉴의 항목(이름 바꾸기 …)이 또 다른 팝업을
// 띄우는데, 시트가 남아 있으면 그 팝업이 시트 **아래**에 깔린다.

import { useEffect, useState } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import { MONO_FONT } from '../chrome';
import { MobileSheet } from './parts';

interface Props {
  open: boolean;
  onClose: () => void;
  state: HomeState;
  controller: HomeController;
  /** 처음부터 순서 편집으로 연다(전체 › 스페이스 순서). */
  startInReorder?: boolean;
}

function Arrow({ up, disabled, onClick, label }: { up: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="btn mf-m-press"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: 36, height: 36, flex: '0 0 auto', border: 0, borderRadius: 10, background: 'transparent', color: disabled ? 'var(--mf-m-line)' : 'var(--mf-m-mut)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: disabled ? 'default' : 'pointer' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
      </svg>
    </button>
  );
}

export function MobileSpaceSheet({ open, onClose, state, controller, startInReorder = false }: Props) {
  const [reorder, setReorder] = useState(startInReorder);
  useEffect(() => {
    if (open) setReorder(startInReorder);
  }, [open, startInReorder]);
  const spaces = state.spaces;
  return (
    <MobileSheet open={open} onClose={onClose} label="스페이스" attrs={{ 'data-m-space-sheet': '' }}>
      <span style={{ display: 'flex', alignItems: 'baseline', padding: '18px 24px 6px', flex: '0 0 auto' }}>
        <span style={{ flex: 1, fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-m-ink)' }}>스페이스</span>
        <button
          type="button"
          className="btn"
          data-m-space-reorder
          aria-pressed={reorder}
          onClick={() => setReorder((v) => !v)}
          style={{ border: 0, background: 'transparent', padding: '4px 0', color: reorder ? 'var(--mf-accent)' : 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          {reorder ? '완료' : '순서 편집'}
        </button>
      </span>
      <div className="mf-m-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {spaces.map((sp, i) => {
          const on = sp.id === state.activeSpace;
          const dot = sp.color || 'var(--mf-accent)';
          const count = sp.maps.length;
          if (reorder) {
            return (
              <div key={sp.id} data-m-space-row={sp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 52, padding: '0 14px 0 24px' }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 4, background: dot, display: 'block', marginRight: 6 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: on ? 800 : 600, color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.name}</span>
                <Arrow up disabled={i === 0} onClick={() => controller.reorderSpace(i, i - 1)} label={`'${sp.name}' 위로`} />
                <Arrow up={false} disabled={i === spaces.length - 1} onClick={() => controller.reorderSpace(i, i + 1)} label={`'${sp.name}' 아래로`} />
                <button
                  type="button"
                  className="btn mf-m-press"
                  aria-label={`'${sp.name}' 메뉴`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onClose();
                    // 시트가 닫힌 **다음** 프레임에 연다 — 같은 프레임이면 시트의 닫힘(초점 복귀)이
                    // 막 뜬 메뉴를 바깥 누름으로 보고 닫는다.
                    window.setTimeout(() => controller.openCtxMenuAt(r.right - 184, Math.max(16, r.top - 8), { kind: 'space', id: sp.id }), 0);
                  }}
                  style={{ width: 36, height: 36, flex: '0 0 auto', border: 0, borderRadius: 10, background: 'transparent', color: 'var(--mf-m-faint)', fontSize: 18, fontWeight: 800, padding: 0, cursor: 'pointer' }}
                >
                  ⋯
                </button>
              </div>
            );
          }
          return (
            <button
              key={sp.id}
              type="button"
              className="btn mf-m-press"
              data-m-space-row={sp.id}
              aria-current={on ? 'true' : undefined}
              onClick={() => {
                if (!on) controller.setActiveSpace(sp.id);
                onClose();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 52, flex: '0 0 auto', padding: '0 24px', border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <span aria-hidden="true" style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 4, background: dot, display: 'block' }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: on ? 800 : 600, color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.name}</span>
              <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: 'var(--mf-m-faint)' }}>{count}</span>
              <span style={{ width: 18, flex: '0 0 auto', display: 'inline-flex' }}>
                {on && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mf-accent)" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 13 4.5 4.5L19 7" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn"
        data-m-space-new
        onClick={() => {
          onClose();
          controller.openNewSpace();
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '0 0 auto', height: 52, margin: '6px 24px 0', padding: 0, border: 0, borderTop: '1px solid var(--mf-m-line)', background: 'transparent', color: 'var(--mf-m-mut)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, textAlign: 'left', cursor: 'pointer' }}
      >
        <span aria-hidden="true" style={{ width: 12, textAlign: 'center', fontSize: 18, lineHeight: 1 }}>
          +
        </span>
        새 스페이스
      </button>
    </MobileSheet>
  );
}

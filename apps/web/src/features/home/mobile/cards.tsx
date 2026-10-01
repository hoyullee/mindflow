// 모바일 홈 카드 공통 — 누름(한 번 = 열기 · 길게 = 선택), 선택 표식, 보드 종류 그림.
// 스페이스 화면과 검색 결과가 같은 것을 쓴다(한쪽만 고쳐지지 않게).

import type { CSSProperties, MouseEvent } from 'react';
import type { HomeController } from '../useHomeController';
import type { HomeState } from '../types';
import type { CardViewData } from '../viewModel';
import { formatLastEdited } from '../timeFormat';
import { useLongPressSelect } from '../components/useLongPressSelect';
import { Chevron, KIND_META, kindOfCard, noteGrid } from './parts';

/** 카드 한 장의 누름 — 한 번 = 열기, 길게 = 선택 모드, 선택 모드 안에서는 체크 토글. */
export function usePress(key: string, state: HomeState, controller: HomeController, open: () => void) {
  const hold = useLongPressSelect({ cardKey: key, armed: !state.selectMode, active: state.selectMode, onEnter: controller.enterSelectMode });
  return {
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      // 길게 누르기로 방금 모드에 들어왔다 — 손을 떼며 따라오는 클릭은 토글이 아니다.
      if (hold.swallowClick.current) {
        hold.swallowClick.current = false;
        return;
      }
      if (state.selectMode) controller.toggleCardSelected(key);
      else open();
    },
    onContextMenu: (e: MouseEvent) => {
      // 터치의 `contextmenu`는 곧 길게 누르기다 — 브라우저 메뉴 대신 선택 모드로.
      e.preventDefault();
      if (hold.wasTouch.current) hold.begin();
    },
    onPointerDown: hold.onPointerDown,
    onPointerMove: hold.onPointerMove,
    onPointerUp: hold.onPointerUp,
    onPointerCancel: hold.onPointerCancel,
  };
}

/** 고른 카드의 표식 — 오른쪽 위 체크 원(선택 모드에서만). */
export function SelectMark({ on, side = 'left' }: { on: boolean; side?: 'left' | 'right' }) {
  return (
    <span
      data-m-select={on ? 'on' : 'off'}
      aria-hidden="true"
      style={{
        position: 'absolute',
        ...(side === 'left' ? { left: 8 } : { right: 4 }),
        top: side === 'left' ? 8 : 4,
        zIndex: 1,
        width: 20,
        height: 20,
        borderRadius: 99,
        boxSizing: 'border-box',
        border: on ? 0 : '1.5px solid var(--mf-m-faint2)',
        background: on ? 'var(--mf-accent)' : 'var(--mf-m-card)',
        color: 'var(--mf-accent-ink)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4.5 4.5L19 7" />
        </svg>
      )}
    </span>
  );
}

/** 보드 종류의 작은 그림(58×42) — 썸네일이 아니라 **무엇인지**를 말하는 표식(디자인). */
export function BoardThumb({ kind }: { kind: 'map' | 'board' | 'kanban' }) {
  const box: CSSProperties = { position: 'relative', width: 58, height: 42, flex: '0 0 auto', borderRadius: 8, background: 'var(--mf-m-thumb)', overflow: 'hidden', display: 'block' };
  const paper = 'var(--mf-m-card)';
  if (kind === 'kanban') {
    const col = (head: string, cards: number) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ height: 4, borderRadius: 2, background: head, display: 'block' }} />
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} style={{ flex: 1, borderRadius: 2, background: i < cards ? paper : 'transparent', display: 'block' }} />
        ))}
      </span>
    );
    return (
      <span aria-hidden="true" style={box}>
        <span style={{ position: 'absolute', inset: 5, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
          {col('var(--mf-doc-map)', 2)}
          {col('#d8a24f', 1)}
          {col('var(--mf-doc-board)', 2)}
        </span>
      </span>
    );
  }
  if (kind === 'map') {
    return (
      <span aria-hidden="true" style={box}>
        <svg viewBox="0 0 58 42" width="58" height="42" style={{ position: 'absolute', inset: 0, display: 'block' }} fill="none" stroke="var(--mf-m-faint2)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M20 21h6c4 0 4-9 8-9h6M26 21h14M26 21c4 0 4 9 8 9h6" />
          <rect x="6" y="16" width="14" height="10" rx="3" fill="var(--mf-doc-map)" stroke="none" />
          <rect x="40" y="8" width="12" height="7" rx="2" fill={paper} stroke="none" />
          <rect x="40" y="17.5" width="12" height="7" rx="2" fill={paper} stroke="none" />
          <rect x="40" y="27" width="12" height="7" rx="2" fill={paper} stroke="none" />
        </svg>
      </span>
    );
  }
  const sticky = (left: number, top: number, w: number, h: number, bg: string, rot: number) => (
    <span style={{ position: 'absolute', left, top, width: w, height: h, borderRadius: 2, background: bg, transform: `rotate(${rot}deg)`, display: 'block' }} />
  );
  return (
    <span aria-hidden="true" style={box}>
      <span style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(var(--mf-dot-grid) .8px, transparent .8px)', backgroundSize: '6px 6px', display: 'block' }} />
      {sticky(8, 8, 16, 14, '#fceba8', -4)}
      {sticky(26, 12, 16, 14, '#f7d9c8', 3)}
      {sticky(14, 25, 16, 12, '#dcebd9', -2)}
      <span style={{ position: 'absolute', left: 38, top: 26, width: 12, height: 10, borderRadius: 99, border: '1px solid var(--mf-m-faint2)', display: 'block' }} />
    </span>
  );
}

/** 줄 안에 서는 체크 원(보드 목록용 — 겹쳐 놓을 자리가 없다). */
export function SelectMarkInline({ on }: { on: boolean }) {
  return (
    <span
      data-m-select={on ? 'on' : 'off'}
      aria-hidden="true"
      style={{ width: 20, height: 20, flex: '0 0 auto', borderRadius: 99, boxSizing: 'border-box', border: on ? 0 : '1.5px solid var(--mf-m-faint2)', background: on ? 'var(--mf-accent)' : 'var(--mf-m-card)', color: 'var(--mf-accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {on && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4.5 4.5L19 7" />
        </svg>
      )}
    </span>
  );
}


export function openCard(controller: HomeController, c: CardViewData) {
  if (c.openable === false) return;
  controller.openWithLoader(c.href, c.title, c.docId);
}

/** 공책 줄의 작은 표지(58×42) — 모눈 + 책갈피 + 제목 막대. */
function NoteThumb({ color }: { color: string }) {
  return (
    <span aria-hidden="true" style={{ position: 'relative', width: 58, height: 42, flex: '0 0 auto', boxSizing: 'border-box', borderRadius: 8, backgroundColor: 'var(--mf-m-card)', backgroundImage: noteGrid(), backgroundSize: '7px 7px', border: '1px solid var(--mf-m-card-line)', overflow: 'hidden', display: 'block' }}>
      <span style={{ position: 'absolute', right: -1, top: 6, width: 4, height: 12, borderRadius: '2px 0 0 2px', background: color, display: 'block' }} />
      <span style={{ position: 'absolute', left: 7, top: 8, width: 26, height: 4, borderRadius: 99, background: color, display: 'block' }} />
      <span style={{ position: 'absolute', left: 7, top: 17, width: 34, height: 2.5, borderRadius: 99, background: 'var(--mf-m-faint2)', display: 'block' }} />
      <span style={{ position: 'absolute', left: 7, top: 23, width: 24, height: 2.5, borderRadius: 99, background: 'var(--mf-m-faint2)', display: 'block' }} />
    </span>
  );
}

/** 문서 한 줄(64px) — 종류 그림 · 제목 · `종류 · 언제`(또는 `sub`) · ›. 스페이스의 보드 목록과 검색 결과. */
export function DocRow({ card, state, controller, sub }: { card: CardViewData; state: HomeState; controller: HomeController; sub?: string }) {
  const press = usePress(card.key, state, controller, () => openCard(controller, card));
  const kind = kindOfCard(card);
  const when = formatLastEdited(card.updatedAt) || card.when;
  return (
    <a
      href={card.href}
      data-card-key={card.key}
      data-m-board={card.key}
      className="mf-m-press"
      aria-label={`${card.title} ${KIND_META[kind].label}`}
      aria-pressed={state.selectMode ? card.selected : undefined}
      {...press}
      style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 64, padding: '0 4px', margin: '0 -4px', borderBottom: '1px solid var(--mf-m-line)', background: card.selected ? 'var(--mf-accent-soft)' : 'transparent', textDecoration: 'none', color: 'inherit', WebkitTouchCallout: 'none', userSelect: 'none' }}
    >
      {state.selectMode && <SelectMarkInline on={card.selected} />}
      {kind === 'note' ? <NoteThumb color={card.note?.cover || KIND_META.note.color} /> : <BoardThumb kind={kind} />}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.title}</span>
        <span style={{ fontSize: 12, color: 'var(--mf-m-mut2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub ?? [KIND_META[kind].label, when].filter(Boolean).join(' · ')}</span>
      </span>
      {!state.selectMode && <Chevron />}
    </a>
  );
}


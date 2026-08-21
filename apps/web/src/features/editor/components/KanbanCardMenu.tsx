// 칸반 카드의 **우클릭 메뉴**와 그 메뉴에서 여는 **빠른 댓글 팝업**(시안 2장).
//
// 카드에 대고 할 수 있는 일이 상세 모달 안에만 있어서, 상태를 한 칸 옮기거나 한
// 마디 남기려면 모달을 열고 닫아야 했다. 메뉴는 그 지름길이다 — 항목은 전부
// 이미 있는 동작이고(열기·댓글·상태·긴급·복제·삭제) 새로 만든 것은 복제뿐이다.
//
// 메뉴는 `position: fixed`다: 카드는 세로로 스크롤되는 열 안에 있어 흐름에 두면
// 잘린다(열 메뉴·카드 색 판과 같은 이유). 바깥을 누르거나 Esc로 닫힌다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { KanbanCard, KanbanColumn } from '@mindflow/mindmap-core';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import { columnColor } from '../kanbanMeta';
import { MenuDivider } from './ToolbarMenus';

/** 긴급·삭제의 경고색 — 보드 카드와 같은 값(테마와 무관하게 "위험"으로 읽힌다). */
const URGENT = '#d9534f';

const MENU_W = 280;
const SUB_W = 152;

/** 화면 안으로 당겨 놓는다 — 오른쪽·아래가 좁으면 안쪽으로(위로 뒤집는다). */
function clampPos(x: number, y: number, w: number, h: number): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  return {
    left: Math.max(8, Math.min(x, vw - w - 8)),
    top: Math.max(8, Math.min(y, vh - h - 8)),
  };
}

export function CardMenu({
  card,
  columns,
  theme: th,
  at,
  isMobile,
  canComment,
  readOnly,
  onOpen,
  onComment,
  onMove,
  onToggleFlag,
  onCopy,
  onCut,
  onDuplicate,
  onDelete,
  onClose,
}: {
  card: KanbanCard;
  columns: KanbanColumn[];
  theme: Theme;
  at: { x: number; y: number };
  isMobile: boolean;
  canComment: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onComment: () => void;
  onMove: (colId: string) => void;
  onToggleFlag: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [sub, setSub] = useState(false);
  /** 실측 높이로 자리를 잡는다 — 항목 수가 권한·기능에 따라 달라지므로 어림값을
   *  쓰면 아래쪽 카드에서 메뉴가 화면을 넘는다. 페인트 전에 재서 자리가 안 튄다. */
  const [pos, setPos] = useState(() => clampPos(at.x, at.y, MENU_W, 300));
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 300;
    setPos(clampPos(at.x, at.y, MENU_W, h));
  }, [at.x, at.y]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const colIndex = columns.findIndex((c) => c.id === card.col);
  const col = columns[colIndex];
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    minHeight: isMobile ? 44 : 38,
    padding: '0 11px',
    border: 0,
    borderRadius: 9,
    background: 'transparent',
    color: th.text,
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    boxSizing: 'border-box',
  };
  const glyph: CSSProperties = { display: 'flex', width: 17, justifyContent: 'center', flex: '0 0 auto', color: 'inherit' };
  /** 단축키 — 오른쪽에 등폭으로. 메뉴에 적은 것은 **실제로 듣는 키**뿐이다. */
  const key: CSSProperties = { flex: '0 0 auto', fontSize: 11.5, color: hexA(th.subtext, 0.85), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

  return (
    <div
      ref={ref}
      data-card-menu={card.id}
      role="menu"
      aria-label="카드 메뉴"
      className="mf-kb-pop"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: MENU_W,
        boxSizing: 'border-box',
        padding: 6,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 14,
        boxShadow: '0 24px 54px -22px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.06)',
        zIndex: 330,
        transformOrigin: 'top left',
        // 행 hover 색 — 인라인 스타일은 클래스 규칙을 이기므로 값만 변수로 내려
        // 주고 칠하기는 CSS(`.mf-kb-menu-row:hover`)에 맡긴다.
        ['--mf-kb-hover' as string]: hexA(th.accent, 0.1),
        ['--mf-kb-hover-ink' as string]: th.accent,
        ['--mf-kb-danger-soft' as string]: hexA(URGENT, 0.1),
        ['--mf-kb-danger' as string]: URGENT,
      } as CSSProperties}
    >
      {/* 머리 — 어느 카드의 메뉴인지(열 색 점 + 제목 첫 줄). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 9px', minWidth: 0 }}>
        <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, background: col ? columnColor(col, colIndex, th.palette) : th.border }} />
        <span data-card-menu-title style={{ fontSize: 12.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(card.text || '빈 카드').split('\n')[0]}
        </span>
      </div>

      <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-open onClick={onOpen} style={row}>
        <span style={glyph}>
          <OpenGlyph />
        </span>
        <span style={{ flex: '1 1 auto' }}>카드 열기</span>
        <span style={key}>Enter</span>
      </button>

      {canComment && (
        <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-comment onClick={onComment} style={row}>
          <span style={glyph}>
            <BubbleGlyph />
          </span>
          <span style={{ flex: '1 1 auto' }}>댓글 달기</span>
        </button>
      )}

      {!readOnly && (
        <>
          <MenuDivider theme={th} />
          {/* 상태 이동 — 옆으로 뻗는 플라이아웃. hover로 열리고, 터치를 위해
              클릭으로도 **열기만** 한다(토글로 두면 이미 열린 뒤의 클릭이 닫아
              아무 일도 안 하는 것처럼 보인다 — 홈 메뉴에서 겪은 함정). */}
          <div style={{ position: 'relative' }} onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
            <button
              type="button"
              role="menuitem"
              className="mf-kb-menu-row"
              data-card-menu-move
              data-active={sub ? '1' : undefined}
              aria-expanded={sub}
              onClick={() => setSub(true)}
              style={row}
            >
              <span style={glyph}>
                <MoveGlyph />
              </span>
              <span style={{ flex: '1 1 auto' }}>상태 이동</span>
              <span style={{ ...glyph, width: 14 }}>
                <ChevronGlyph />
              </span>
            </button>
            {sub && (
              <div
                data-card-menu-move-sub
                role="menu"
                aria-label="상태 이동"
                className="mf-kb-fly"
                style={{
                  position: 'absolute',
                  // 오른쪽이 좁으면 왼쪽으로 뻗는다.
                  left: pos.left + MENU_W + SUB_W + 12 < (typeof window === 'undefined' ? 1280 : window.innerWidth) ? '100%' : undefined,
                  right: pos.left + MENU_W + SUB_W + 12 < (typeof window === 'undefined' ? 1280 : window.innerWidth) ? undefined : '100%',
                  top: -6,
                  marginLeft: 6,
                  marginRight: 6,
                  width: SUB_W,
                  padding: 6,
                  boxSizing: 'border-box',
                  background: th.panel,
                  border: `1px solid ${th.border}`,
                  borderRadius: 14,
                  boxShadow: '0 24px 54px -22px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.06)',
                  zIndex: 1,
                  transformOrigin: 'left top',
                }}
              >
                {columns.map((c, i) => {
                  const on = c.id === card.col;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className="mf-kb-menu-row"
                      data-card-menu-col={c.id}
                      data-current={on ? '1' : undefined}
                      onClick={() => onMove(c.id)}
                      style={{ ...row, gap: 9, background: on ? th.panel2 : 'transparent', fontWeight: on ? 700 : 500 }}
                    >
                      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, background: columnColor(c, i, th.palette) }} />
                      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-flag onClick={onToggleFlag} style={row}>
            <span style={glyph}>
              <FlagGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>{card.flagged ? '긴급 해제' : '긴급으로 표시'}</span>
          </button>

          <MenuDivider theme={th} />
          {/* 복사·잘라내기 — 배경 메뉴의 '붙여넣기'가 쓸 **원천**이다(요청 시안의
              배경 메뉴에 붙여넣기가 있는데, 담을 방법이 없으면 그 행은 죽은 항목이
              된다). 클립보드는 캔버스와 따로인 **카드 전용**이다. */}
          <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-copy onClick={onCopy} style={row}>
            <span style={glyph}>
              <CopyGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>복사</span>
            <span style={key}>{mac ? '⌘C' : 'Ctrl+C'}</span>
          </button>
          <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-cut onClick={onCut} style={row}>
            <span style={glyph}>
              <CutGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>잘라내기</span>
            <span style={key}>{mac ? '⌘X' : 'Ctrl+X'}</span>
          </button>
          <button type="button" role="menuitem" className="mf-kb-menu-row" data-card-menu-duplicate onClick={onDuplicate} style={row}>
            <span style={glyph}>
              <DupeGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>복제</span>
            <span style={key}>{mac ? '⌘D' : 'Ctrl+D'}</span>
          </button>

          <MenuDivider theme={th} />
          <button type="button" role="menuitem" className="mf-kb-menu-row is-danger" data-card-menu-delete onClick={onDelete} style={{ ...row, color: URGENT }}>
            <span style={glyph}>
              <TrashGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>카드 삭제</span>
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 빠른 댓글 팝업(시안) — 우클릭 메뉴의 `댓글 달기`가 여는 자리.
 *
 * 저장되는 곳은 **카드 상세의 그 댓글**이다(0020의 같은 표, 대상 = 카드 id) —
 * 여기서 남긴 글이 상세·패널에서 그대로 보인다. 두 벌로 두지 않는다.
 *
 * 등록은 `⌘/Ctrl + Enter`다(시안의 안내 문구) — Enter를 등록으로 쓰면 폰에서
 * 줄바꿈을 넣을 방법이 사라진다(소프트 키보드에는 Shift가 없다).
 */
export function QuickComment({
  card,
  theme: th,
  at,
  isMobile,
  onSubmit,
  onClose,
}: {
  card: KanbanCard;
  theme: Theme;
  at: { x: number; y: number };
  isMobile: boolean;
  onSubmit: (body: string) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const W = isMobile ? Math.min(340, (typeof window === 'undefined' ? 360 : window.innerWidth) - 24) : 340;
  const [pos, setPos] = useState(() => clampPos(at.x, at.y, W, 230));
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 230;
    setPos(clampPos(at.x, at.y, W, h));
  }, [at.x, at.y, W]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const submit = (): void => {
    const body = val.trim();
    if (!body || busy) return;
    setBusy(true);
    void onSubmit(body).then((res) => {
      setBusy(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const pill = (primary: boolean): CSSProperties => ({
    height: isMobile ? 40 : 32,
    padding: '0 15px',
    borderRadius: 999,
    border: primary ? 0 : `1px solid ${th.border}`,
    background: primary ? th.accent : th.panel,
    color: primary ? '#fff' : th.subtext,
    fontSize: 12.5,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  });

  return (
    <div
      ref={ref}
      data-quick-comment={card.id}
      role="dialog"
      aria-label="댓글 달기"
      className="mf-kb-pop"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: W,
        boxSizing: 'border-box',
        padding: 14,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 16,
        boxShadow: '0 24px 54px -22px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.06)',
        zIndex: 335,
        transformOrigin: 'top left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: th.accent, flex: '0 0 auto' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: th.subtext }}>댓글 달기</span>
          </div>
          <div data-quick-comment-title style={{ marginTop: 3, fontSize: 13.5, fontWeight: 800, color: th.text, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(card.text || '빈 카드').split('\n')[0]}
          </div>
        </div>
        <button
          type="button"
          className="mf-ed-btn"
          data-quick-comment-close
          aria-label="닫기"
          title="닫기"
          onClick={onClose}
          style={{ flex: '0 0 auto', width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 0, background: 'transparent', color: th.subtext, cursor: 'pointer', padding: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <textarea
        ref={inputRef}
        className="mf-edit"
        data-quick-comment-input
        aria-label="댓글 입력"
        value={val}
        rows={3}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        style={{
          width: '100%',
          marginTop: 11,
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 12,
          border: `1.5px solid ${hexA(th.accent, 0.55)}`,
          background: th.panel,
          color: th.text,
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          resize: 'none',
          outline: 'none',
        }}
      />

      {error && (
        <div data-quick-comment-error style={{ marginTop: 7, fontSize: 12, color: URGENT }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 11 }}>
        <span style={{ fontSize: 11, color: hexA(th.subtext, 0.85), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>⌘↵ 등록 · Esc 닫기</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button type="button" className="mf-ed-btn" data-quick-comment-cancel onClick={onClose} style={pill(false)}>
            취소
          </button>
          <button type="button" className="mf-ed-btn" data-quick-comment-submit disabled={!val.trim() || busy} onClick={submit} style={{ ...pill(true), opacity: val.trim() && !busy ? 1 : 0.5, cursor: val.trim() && !busy ? 'pointer' : 'default' }}>
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

function OpenGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function BubbleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.6-.4L3 21l1.6-4.6A8 8 0 0 1 3.6 11 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </svg>
  );
}

/** 상태 이동 — 되돌아 꺾이는 화살표(시안). */
function MoveGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FlagGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4h9l-1 3h6l-1.5 4.5L18 16h-7l-1-3H5" />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

function CutGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8 16 18 4M16 16 6 4" />
    </svg>
  );
}

/** 복제 — 겹쳐 놓인 같은 모양 둘("그 자리에 하나 더"). 복사와 갈라 보이게. */
function DupeGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="2.5" />
      <path d="M8 20h10a2 2 0 0 0 2-2V8" />
    </svg>
  );
}

/** 배경 메뉴 — 카드도 열도 없는 자리에서 여는 **보드 전체**에 대한 메뉴(시안).
 *
 * 카드 메뉴와 같은 카드·행·단축키 문법을 쓴다(같은 보드에서 두 메뉴가 다른 물건처럼
 * 보이지 않게). 단축키 표기는 세 환경 규칙을 그대로 따른다 — Mac은 기호, Windows는
 * 낱말, **모바일은 적지 않는다**(누를 수 없는 키가 자리만 차지한다).
 */
export function BoardMenu({
  theme: th,
  at,
  isMobile,
  readOnly,
  columnCount,
  clipboardCount,
  doneCount,
  urgentOnly,
  onAddColumn,
  onPaste,
  onSortByDue,
  onToggleUrgent,
  onClearDone,
  onClose,
}: {
  theme: Theme;
  at: { x: number; y: number };
  isMobile: boolean;
  readOnly: boolean;
  columnCount: number;
  clipboardCount: number;
  /** 마지막(완료) 열의 카드 수 — 0이면 '모두 비우기'는 비활성이다. */
  doneCount: number;
  urgentOnly: boolean;
  onAddColumn: () => void;
  onPaste: () => void;
  onSortByDue: () => void;
  onToggleUrgent: () => void;
  onClearDone: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(() => clampPos(at.x, at.y, MENU_W, 280));
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 280;
    setPos(clampPos(at.x, at.y, MENU_W, h));
  }, [at.x, at.y]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    minHeight: isMobile ? 44 : 38,
    padding: '0 11px',
    border: 0,
    borderRadius: 9,
    background: 'transparent',
    color: th.text,
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    boxSizing: 'border-box',
  };
  const glyph: CSSProperties = { display: 'flex', width: 17, justifyContent: 'center', flex: '0 0 auto', color: 'inherit' };
  const key: CSSProperties = { flex: '0 0 auto', fontSize: 11.5, color: hexA(th.subtext, 0.85), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

  return (
    <div
      ref={ref}
      data-board-menu
      role="menu"
      aria-label="보드 메뉴"
      className="mf-kb-pop"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: MENU_W,
        boxSizing: 'border-box',
        padding: 6,
        background: th.panel,
        border: `1px solid ${th.border}`,
        borderRadius: 14,
        boxShadow: '0 24px 54px -22px rgba(46,42,38,.5), 0 2px 6px rgba(46,42,38,.06)',
        zIndex: 330,
        transformOrigin: 'top left',
        ['--mf-kb-hover' as string]: hexA(th.accent, 0.1),
        ['--mf-kb-hover-ink' as string]: th.accent,
        ['--mf-kb-danger-soft' as string]: hexA(URGENT, 0.1),
        ['--mf-kb-danger' as string]: URGENT,
      } as CSSProperties}
    >
      {/* 머리 — 무엇에 대한 메뉴인지(시안: `보드 · 4개 열`). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 9px', minWidth: 0 }}>
        <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, background: th.border }} />
        <span data-board-menu-title style={{ fontSize: 12.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          보드 · {columnCount}개 열
        </span>
      </div>

      {!readOnly && (
        <>
          <button type="button" role="menuitem" className="mf-kb-menu-row" data-board-add-column onClick={onAddColumn} style={row}>
            <span style={glyph}>
              <PlusGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>열 추가</span>
            {!isMobile && <span style={key}>N</span>}
          </button>

          {/* 붙여넣기 — 담아 둔 카드가 없으면 아예 내지 않는다(눌러도 아무 일 없는
              항목을 두지 않는다는 기존 규칙). */}
          {clipboardCount > 0 && (
            <button type="button" role="menuitem" className="mf-kb-menu-row" data-board-paste onClick={onPaste} style={row}>
              <span style={glyph}>
                <PasteGlyph />
              </span>
              <span style={{ flex: '1 1 auto' }}>{clipboardCount > 1 ? `붙여넣기 (${clipboardCount}장)` : '붙여넣기'}</span>
              {!isMobile && <span style={key}>{mac ? '⌘V' : 'Ctrl+V'}</span>}
            </button>
          )}

          <MenuDivider theme={th} />
          <button type="button" role="menuitem" className="mf-kb-menu-row" data-board-sort-due onClick={onSortByDue} style={row}>
            <span style={glyph}>
              <SortGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>전체 기한순 정렬</span>
          </button>
        </>
      )}

      {/* 긴급만 보기 — 필터는 **보는 사람의 상태**라 보기 전용에서도 쓸 수 있다
          (문서를 바꾸지 않는다). 켜져 있으면 체크로 알린다. */}
      <button type="button" role="menuitem" className="mf-kb-menu-row" data-board-urgent-only data-on={urgentOnly ? '1' : undefined} aria-pressed={urgentOnly} onClick={onToggleUrgent} style={{ ...row, color: urgentOnly ? th.accent : th.text }}>
        <span style={glyph}>
          <FlagGlyph />
        </span>
        <span style={{ flex: '1 1 auto' }}>긴급만 보기</span>
        {urgentOnly && (
          <span style={{ ...glyph, width: 14, color: th.accent }}>
            <CheckGlyph />
          </span>
        )}
      </button>

      {!readOnly && (
        <>
          <MenuDivider theme={th} />
          {/* 완료 카드 비우기 — 마지막 열이 '완료'다(진행률·기한 톤도 그 규칙을 쓴다).
              비어 있으면 비활성으로 남긴다: 항목이 사라지면 메뉴 높이가 들썩인다. */}
          <button
            type="button"
            role="menuitem"
            className="mf-kb-menu-row is-danger"
            data-board-clear-done
            disabled={doneCount === 0}
            title={doneCount === 0 ? '완료 열에 카드가 없어요' : `카드 ${doneCount}장을 지웁니다`}
            onClick={onClearDone}
            style={{ ...row, color: URGENT, opacity: doneCount === 0 ? 0.45 : 1, cursor: doneCount === 0 ? 'default' : 'pointer' }}
          >
            <span style={glyph}>
              <ClearGlyph />
            </span>
            <span style={{ flex: '1 1 auto' }}>완료 카드 모두 비우기</span>
            {doneCount > 0 && <span style={{ ...key, color: hexA(URGENT, 0.75) }}>{doneCount}장</span>}
          </button>
        </>
      )}
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PasteGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="4" width="10" height="16" rx="2" />
      <path d="M10 4h4v2h-4z" />
    </svg>
  );
}

/** 기한순 정렬 — 위아래 화살표 + 짧아지는 줄(정렬의 관용 기호). */
function SortGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4v16M6 20l-3-3M6 20l3-3" />
      <path d="M12 6h9M12 12h6M12 18h3" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** 비우기 — 쓸어 내는 붓(시안). 삭제(휴지통)와 갈라 보이게 다른 그림을 쓴다. */
function ClearGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 4 9 14" />
      <path d="M13 8l3 3" />
      <path d="M9 14l-4 6h6l2-3z" />
    </svg>
  );
}

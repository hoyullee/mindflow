// 폰의 공책 크롬(모바일 공책 디자인 E0·E2) — 머리 한 줄 · 바닥 독 · ⋯ 시트.
//
// 데스크톱 상단 바는 [뒤로 · 이름 · 저장] · [경로] · [공유 + 얼굴 | 일정 · 댓글 · 기록]을 한 줄에 세운다.
// 폰 폭(390)에 그대로 접으면 아이콘이 여덟 개 붙어 이름이 서너 글자에서 잘렸다(실측). 그래서 폰은
// 셋으로 나눈다: 머리는 **어디에 있나**(뒤로 · 표지 띠 + 이름 · 저장 상태 · 페이지 N), 바닥 독은
// **무엇을 펼까**(일정 · 댓글 · 기록 — 손가락이 닿는 자리), ⋯ 시트는 드물게 쓰는 것(공유 · 지금 저장).

import { useEffect, useState, type ReactNode, type Ref } from 'react';
import type { EditorController } from '../useEditorState';
import { noteCoverColor } from '@mindflow/mindmap-core';
import { NoteBookTitle } from './NoteBookTitle';
import { PresenceAvatars } from './PresenceAvatars';
import { MobileSheet } from '../../home/mobile/parts';
import { useKeyboardInset } from '../../../hooks/useKeyboardInset';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** 공책 본문·서식 도구·그 팝오버 — 이 안에 초점이 있으면 "쓰는 중"이다. */
const TYPING_ZONE = '[data-note-page], [data-note-toolbar], [data-radix-popper-content-wrapper], [data-note-slash]';

/**
 * **쓰는 중인가**(모바일 공책 디자인 E1) — 서식 도구가 키보드 위로 올라오고 바닥 독이 비키는 조건.
 *
 * 초점이 **들어오는 순간**(`focusin`)만 본다: 서식 단추는 누를 때 초점을 빼앗지 않고(본문에 남긴다),
 * 드롭다운은 팝오버로 초점을 옮기는데 그것도 같은 구역이다. 나가는 쪽(`focusout`)을 보면 드롭다운을
 * 여는 순간 도구가 사라져 팝오버가 기댈 자리를 잃는다. 터치 기기에서는 **키보드가 떠 있을 때만**
 * (화면 빈 곳을 눌러 키보드를 내리면 곧바로 읽기 화면으로), 키보드가 없는 좁은 창에서는 초점만으로.
 */
export function useNoteTyping(): { typing: boolean; inset: number } {
  const inset = useKeyboardInset();
  const touch = useIsTouchDevice();
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null;
      setFocused(!!t?.closest?.(TYPING_ZONE));
    };
    document.addEventListener('focusin', onIn);
    return () => document.removeEventListener('focusin', onIn);
  }, []);
  return { typing: focused && (inset > 0 || !touch), inset };
}

/** 폰 머리(E0) — `‹ · ▌이름 / 저장 상태 · [≡ 페이지 N] · 얼굴 · ⋯`. */
export function NoteMobileTopBar({ controller, pagesOpen, onTogglePages }: { controller: EditorController; pagesOpen: boolean; onTogglePages?: () => void }) {
  const [menu, setMenu] = useState(false);
  const readOnly = controller.readOnly;
  const saving = controller.saveState;
  const saveLabel = readOnly ? '보기 전용' : saving === 'saved' ? '저장됨' : saving === 'saving' ? '저장 중…' : saving === 'unsaved' ? '저장 전' : '변경됨';
  const calm = saving === 'saved' || readOnly;
  const cover = noteCoverColor(controller.doc.cover);
  const pages = controller.notePages.length;
  const iconBtn = { width: 40, height: 40, flex: '0 0 auto', border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 } as const;

  return (
    <div data-note-topbar data-note-topbar-mobile style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4, height: 52, padding: '0 8px 0 4px', background: 'var(--mf-card)', borderBottom: '1px solid var(--mf-border-soft)', minWidth: 0 }}>
      <button type="button" className="mf-note-tb" onClick={controller.goBack} aria-label="홈으로" title="홈으로" style={iconBtn}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, padding: '0 4px' }}>
        <span aria-hidden="true" style={{ width: 3, height: 26, flex: '0 0 auto', borderRadius: 99, background: cover, display: 'block' }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <NoteBookTitle controller={controller} fontSize={14.5} />
          {/* 충돌은 저장 상태보다 먼저 말한다(데스크톱 바와 같은 규칙 — 공책에는 이 자리가 유일한 알림 자리다). */}
          {controller.saveConflict ? (
            <button
              type="button"
              data-note-save-conflict
              onClick={controller.dismissSaveConflict}
              title="다른 기기에서 먼저 저장했습니다. 그 판은 `기록`에 남겨 뒀어요. (눌러서 닫기)"
              style={{ padding: 0, border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, color: 'var(--mf-danger)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}
            >
              ⚠ 다른 기기에서 먼저 저장됨
            </button>
          ) : (
            <span data-note-save-state style={{ fontSize: 11.5, color: 'var(--mf-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: calm ? 'var(--mf-success-ink, #2f7d57)' : 'var(--mf-accent-deep)', fontWeight: 700 }}>{saveLabel}</span>
            </span>
          )}
        </span>
      </span>
      {/* 페이지 목록(E2) — 쪽수가 곧 단추 이름이다. 누르면 바닥에서 시트가 올라온다. */}
      <button
        type="button"
        data-note-pages-toggle
        aria-expanded={pagesOpen}
        aria-label={`페이지 목록 · ${pages}쪽`}
        title="페이지 목록"
        onClick={onTogglePages}
        style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 10px 0 9px', borderRadius: 99, border: `1px solid ${pagesOpen ? 'var(--mf-accent)' : 'var(--mf-border)'}`, background: pagesOpen ? 'var(--mf-accent-soft)' : 'var(--mf-card)', color: pagesOpen ? 'var(--mf-accent-deep)' : 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        페이지
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, opacity: 0.7 }}>{pages}</span>
      </button>
      {/* 함께 보고 있는 **다른 사람**만(혼자면 아무것도 없다) — 내 얼굴까지 세우면 폰 머리에서 이름 자리를 먹는다. */}
      <PresenceAvatars controller={controller} isMobile />
      <button type="button" className="mf-note-tb" data-note-more aria-label="공책 메뉴" aria-haspopup="dialog" onClick={() => setMenu(true)} style={iconBtn}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      <MobileSheet open={menu} onClose={() => setMenu(false)} label="공책 메뉴" attrs={{ 'data-note-more-sheet': '' }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '12px 8px 4px' }}>
          <SheetRow
            label="공유"
            attr="data-note-more-share"
            d={
              <>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 19a5 5 0 0 0-4-4.9" />
              </>
            }
            onClick={() => {
              setMenu(false);
              controller.openShare();
            }}
          />
          {!readOnly && (
            <SheetRow
              label="지금 저장"
              attr="data-note-more-save"
              d={
                <>
                  <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
                  <path d="M8 4v5h7V4M8 21v-6h8v6" />
                </>
              }
              onClick={() => {
                setMenu(false);
                controller.saveNow();
              }}
            />
          )}
        </div>
      </MobileSheet>
    </div>
  );
}

function SheetRow({ label, d, onClick, attr }: { label: string; d: ReactNode; onClick: () => void; attr: string }) {
  return (
    <button
      type="button"
      className="btn mf-m-press"
      {...{ [attr]: '' }}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, height: 52, padding: '0 14px', border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, textAlign: 'left', cursor: 'pointer' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d}
      </svg>
      {label}
    </button>
  );
}

/**
 * 바닥 독(E0) — `일정 · 댓글 · 기록`. 손가락이 닿는 자리에 펼칠 것을 모은다.
 *
 * **키보드가 올라와 있으면 비킨다** — 그 시간에는 서식 도구가 그 자리의 주인이고, 독이 키보드 위로
 * 따라 올라오면 쓰는 줄을 가린다. 댓글 시트가 열려 있을 때도 비킨다(시트가 같은 자리를 덮는다).
 */
export function NoteMobileDock({ controller, agenda }: { controller: EditorController; agenda: { on: boolean; toggle: () => void } }) {
  const keyboard = useKeyboardInset();
  const { typing } = useNoteTyping();
  if (keyboard > 0 || typing || controller.commentsOpen) return null;
  const items = [
    {
      key: '일정',
      on: agenda.on,
      onPick: agenda.toggle,
      d: (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      ),
    },
    {
      key: '댓글',
      on: controller.commentsOpen,
      onPick: () => controller.openComments(),
      d: <path d="M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />,
    },
    {
      key: '기록',
      on: controller.historyOpen,
      onPick: () => controller.setHistoryOpen(!controller.historyOpen),
      d: (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ),
    },
  ];
  return (
    <div data-note-dock style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, display: 'flex', padding: '10px 16px max(14px, env(safe-area-inset-bottom))', background: 'linear-gradient(180deg, transparent, var(--mf-note-body, var(--mf-card)) 40%)', pointerEvents: 'none' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, height: 48, padding: '0 6px', borderRadius: 99, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', boxShadow: '0 10px 26px -18px rgba(46,42,38,.45)', pointerEvents: 'auto' }}>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-note-tab={it.key}
            aria-pressed={it.on}
            onClick={it.onPick}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, border: 0, borderRadius: 99, background: it.on ? 'var(--mf-accent-soft)' : 'transparent', color: it.on ? 'var(--mf-accent-deep)' : 'var(--mf-text)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {it.d}
            </svg>
            {it.key}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * 서식 도구의 **폰 자리**(E1) — 쓰는 동안 키보드 바로 위에 붙는다(데스크톱은 본문 위 한 줄 그대로).
 *
 * 도구는 늘 마운트해 둔다(`/` 목록의 「링크」가 도구의 손잡이를 당긴다) — 안 쓸 때는 화면 밖으로
 * 내리고 감춘다. 위치는 `fixed` + 키보드 높이(`useKeyboardInset`): 브라우저는 키보드가 떠도
 * 레이아웃 뷰포트를 줄이지 않아 `bottom: 0`은 키보드 **뒤**다.
 */
export function NoteMobileToolbarDock({ children }: { children: ReactNode }) {
  const { typing, inset } = useNoteTyping();
  return (
    <div
      data-note-toolbar-dock={typing ? 'on' : 'off'}
      aria-hidden={typing ? undefined : true}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: inset,
        zIndex: 40,
        borderTop: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-card)',
        boxShadow: '0 -10px 24px -18px rgba(46,42,38,.4)',
        transform: typing ? 'none' : 'translateY(110%)',
        visibility: typing ? 'visible' : 'hidden',
        transition: typing ? 'transform .18s ease' : 'transform .14s ease, visibility 0s linear .14s',
      }}
    >
      {children}
    </div>
  );
}

/* ── 폰의 메뉴 시트(E3 블록 · E4 표) ─────────────────────────────────────────── */

/**
 * 우클릭 메뉴의 **폰 판**(모바일 공책 디자인 E3·E4) — 길게 누르면 바닥에서 올라온다.
 *
 * 왜 Radix 시트(`MobileSheet`)가 아닌가: 대화상자는 열리는 순간 초점을 자기 안으로 가져간다. 이 메뉴의
 * 서식 항목은 **본문 박스의 선택**에 거는데(데스크톱 메뉴와 같은 길), 초점이 옮겨 가면 그 선택이
 * 사라진다. 그래서 초점을 건드리지 않는 평범한 판을 띄운다(단추도 `mousedown`을 막는다).
 *
 * 키보드가 떠 있으면 **그 위에** 선다 — `fixed` + `bottom: 0`은 키보드 뒤다(서식 도구와 같은 이유).
 * 덮개는 **뗄 때**(click) 닫는다 — 누르는 순간 닫으면 덮개가 사라진 뒤 그 click이 아래 글에 떨어져
 * 캐럿이 옮겨 간다(손가락은 누르고 떼는 사이가 길다).
 */
export function NoteMenuSheet({ rootRef, attrs, onClose, children }: { rootRef?: Ref<HTMLDivElement>; attrs: Record<string, string>; onClose: () => void; children: ReactNode }) {
  const inset = useKeyboardInset();
  return (
    <>
      <div
        data-note-sheet-scrim=""
        aria-hidden="true"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'var(--mf-m-scrim)' }}
      />
      <div
        ref={rootRef}
        data-note-sheet=""
        {...attrs}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: inset,
          zIndex: 60,
          maxHeight: `calc(100dvh - ${inset}px - 48px)`,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: inset ? 12 : 'max(18px, env(safe-area-inset-bottom))',
          borderRadius: '24px 24px 0 0',
          background: 'var(--mf-m-card)',
          boxShadow: '0 -20px 50px -30px rgba(46,42,38,.5)',
          color: 'var(--mf-m-ink)',
        }}
      >
        <span aria-hidden="true" style={{ alignSelf: 'center', flex: '0 0 auto', width: 36, height: 4, marginTop: 8, borderRadius: 99, background: 'var(--mf-m-grip)', display: 'block' }} />
        {children}
      </div>
    </>
  );
}

/** 시트 머리 — `블록 본문` · `표 [칸 행 열 표]`처럼 무엇의 메뉴인지 한 줄로. */
export function NoteSheetHead({ kind, name, children }: { kind: string; name?: string; children?: ReactNode }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 10px' }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--mf-m-faint)' }}>{kind}</span>
      {name && (
        <span data-note-sheet-name="" style={{ minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--mf-m-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </span>
      )}
      {children}
    </div>
  );
}

/** 하위 판(글꼴 · 옮기기 · 정렬)의 머리 — ‹ 를 누르면 첫 판으로 돌아간다. */
export function NoteSheetBack({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px 8px 6px' }}>
      <button
        type="button"
        data-note-sheet-back=""
        aria-label="뒤로"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onBack}
        style={{ width: 40, height: 40, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--mf-m-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span style={{ fontSize: 15, fontWeight: 800 }}>{title}</span>
    </div>
  );
}

/** 위 줄의 네 칸 — 클립보드처럼 **가장 자주 쓰는** 일. */
export function NoteSheetTiles({ children }: { children: ReactNode }) {
  return <div style={{ flex: '0 0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, padding: '0 16px 8px' }}>{children}</div>;
}

export function NoteSheetTile({ mark, name, icon, disabled, onClick }: { mark: string; name: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-note-ctx={mark}
      className="btn mf-note-sheet-tile"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, height: 66, padding: '0 4px', border: 0, borderRadius: 14, color: disabled ? 'var(--mf-m-faint)' : 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, textAlign: 'center', wordBreak: 'keep-all', cursor: disabled ? 'default' : 'pointer' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
      {name}
    </button>
  );
}

/** 아래 카드 — 줄 사이는 가는 선(첫 줄에는 없다 · `editor.css`). */
export function NoteSheetList({ children }: { children: ReactNode }) {
  return <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', margin: '4px 16px 0', borderRadius: 14, background: 'var(--mf-m-bg)', overflow: 'hidden' }}>{children}</div>;
}

const SHEET_ROW = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 50, width: '100%', boxSizing: 'border-box', padding: '0 14px 0 16px', border: 0, fontFamily: 'inherit', textAlign: 'left' } as const;

/**
 * 카드 한 줄 — [아이콘 · 색 점 · 견본] 이름 … [설명] [›].
 *
 * **단축키는 적지 않는다**(디자인 E3) — 손가락에는 키보드 조합이 없다. 대신 하위 판으로 가는 줄은
 * 무엇이 들어 있는지를 짧게 적는다(`글꼴 — 굵게 · 기울임 · 색`). `onClick`이 없으면 단추가 아닌
 * 줄이다 — 오른쪽에 단추 둘을 세우는 줄(`행 추가 [위에 | 아래에]`)은 단추 안에 단추를 넣을 수 없다.
 */
export function NoteSheetRow({ mark, name, icon, dot, swatch, hint, more, on, disabled, danger, onClick, children }: { mark: string; name: string; icon?: ReactNode; dot?: string; swatch?: string; hint?: string; more?: boolean; on?: boolean; disabled?: boolean; danger?: boolean; onClick?: () => void; children?: ReactNode }) {
  const tone = disabled ? 'var(--mf-m-faint)' : danger ? 'var(--mf-m-danger)' : 'var(--mf-m-ink)';
  const body = (
    <>
      {icon && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={danger || disabled ? 'currentColor' : 'var(--mf-m-ink2)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          {icon}
        </svg>
      )}
      {dot && <span aria-hidden="true" style={{ width: 10, height: 10, flex: '0 0 auto', margin: '0 4px', borderRadius: 999, background: dot, display: 'block' }} />}
      {swatch && <span aria-hidden="true" style={{ width: 18, height: 18, flex: '0 0 auto', borderRadius: 6, background: swatch, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)', display: 'block' }} />}
      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {hint && <span style={{ flex: '0 0 auto', fontSize: 12.5, color: on ? 'var(--mf-accent-deep)' : 'var(--mf-m-tab)', fontWeight: on ? 700 : 500, whiteSpace: 'nowrap' }}>{hint}</span>}
      {children}
      {more && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-m-faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      )}
    </>
  );
  if (!onClick) {
    return (
      <div data-note-ctx={mark} className="mf-note-sheet-row" style={{ ...SHEET_ROW, color: tone }}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-note-ctx={mark}
      className="btn mf-note-sheet-row"
      disabled={disabled}
      aria-pressed={on === undefined ? undefined : on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ ...SHEET_ROW, color: tone, cursor: disabled ? 'default' : 'pointer' }}
    >
      {body}
    </button>
  );
}

/** 줄 오른쪽의 작은 알약 단추(`위에` · `아래에`) — 고르는 값이 아니라 **바로 하는 일**이다. */
export function NoteSheetPill({ mark, name, disabled, onClick }: { mark: string; name: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-note-ctx={mark}
      className="btn"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ flex: '0 0 auto', height: 32, padding: '0 12px', border: '1px solid var(--mf-m-btn-line)', borderRadius: 99, background: 'var(--mf-m-card)', color: disabled ? 'var(--mf-m-faint)' : 'var(--mf-m-ink)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer' }}
    >
      {name}
    </button>
  );
}

/** 맨 아래의 지우기 — 다른 일과 **떨어진** 자리에 붉은 면으로(잘못 누르기 쉬운 일이라). */
export function NoteSheetDanger({ mark, name, disabled, onClick }: { mark: string; name: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-note-ctx={mark}
      className="btn mf-note-sheet-danger"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, minWidth: 0, border: 0, borderRadius: 14, color: disabled ? 'var(--mf-m-faint)' : 'var(--mf-m-danger)', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
      </svg>
      {name}
    </button>
  );
}

/** 지우기 단추 줄 — 하나든 둘이든(`행 삭제 · 열 삭제`) 같은 여백으로. */
export function NoteSheetDangerRow({ children }: { children: ReactNode }) {
  return <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, margin: '10px 16px 0' }}>{children}</div>;
}

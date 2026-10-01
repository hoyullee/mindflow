// 폰의 공책 크롬(모바일 공책 디자인 E0·E2) — 머리 한 줄 · 바닥 독 · ⋯ 시트.
//
// 데스크톱 상단 바는 [뒤로 · 이름 · 저장] · [경로] · [공유 + 얼굴 | 일정 · 댓글 · 기록]을 한 줄에 세운다.
// 폰 폭(390)에 그대로 접으면 아이콘이 여덟 개 붙어 이름이 서너 글자에서 잘렸다(실측). 그래서 폰은
// 셋으로 나눈다: 머리는 **어디에 있나**(뒤로 · 표지 띠 + 이름 · 저장 상태 · 페이지 N), 바닥 독은
// **무엇을 펼까**(일정 · 댓글 · 기록 — 손가락이 닿는 자리), ⋯ 시트는 드물게 쓰는 것(공유 · 지금 저장).

import { useState, type ReactNode } from 'react';
import type { EditorController } from '../useEditorState';
import { noteCoverColor } from '@mindflow/mindmap-core';
import { NoteBookTitle } from './NoteBookTitle';
import { PresenceAvatars } from './PresenceAvatars';
import { MobileSheet } from '../../home/mobile/parts';
import { useKeyboardInset } from '../../../hooks/useKeyboardInset';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

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
  if (keyboard > 0 || controller.commentsOpen) return null;
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

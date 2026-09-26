// 날짜 칩에 마우스를 올리면 뜨는 **그날 일정**(스펙 3-3).
//
// 칩은 "이 문장이 가리키는 날"이고, 그 날에 무엇이 있는지는 캘린더만 안다. 올려서 보는
// 것으로 끝나는 자리라 누르지 않아도 열리고, 벗어나면 닫힌다 — 여닫는 타이밍(110ms 열고
// 180ms 닫기)은 스펙이 정했고 **팝오버 위에 있는 동안은 닫지 않는다**(목록을 훑어야 한다).

import { useMemo } from 'react';
import type { CalendarEntry } from '../../home/calendar/entries';
import { dayProgress, entriesOn, partsOf } from '../../home/calendar/model';
import { useNoteAgenda } from '../noteAgenda';
import type { NoteEventOpen } from './NoteEventPopups';
import type { Theme } from '../theme';

const DOW_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** `오늘 / 내일 / 어제 / N일 뒤 / N일 전` — 일정 블록의 달력 머리와 같은 말. */
export function relDayLabel(iso: string, today: string): string {
  const a = partsOf(iso);
  const b = partsOf(today);
  if (!a || !b) return '';
  const day = (p: { y: number; m: number; d: number }) => new Date(p.y, p.m - 1, p.d).getTime();
  const diff = Math.round((day(a) - day(b)) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return diff > 0 ? `${diff}일 뒤` : `${-diff}일 전`;
}

export function NoteDatePop({
  iso,
  today,
  rect,
  theme,
  onEnter,
  onLeave,
  onClose,
  onOpenEvent,
}: {
  iso: string;
  today: string;
  /** 칩의 화면 사각형 — 이 아래(또는 위)에 선다. */
  rect: { left: number; top: number; bottom: number };
  theme: Theme;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  /**
   * 고른 것을 **공책 안에서** 연다(요청 5·6) — 예전에는 일정 화면으로 건너갔다.
   * 팝오버는 제 몫을 다했으므로 먼저 닫고 넘긴다.
   */
  onOpenEvent: (open: NoteEventOpen) => void;
}) {
  const th = theme;
  const at = partsOf(iso);
  const agenda = useNoteAgenda(at?.y ?? 2026, at?.m ?? 1);
  /**
   * 그 날의 항목 — `entriesOn`이 **하루짜리와 그 날을 덮는 기간을 함께** 고르고
   * 종일을 위로 올린다(제보: 시간 일정만 보인다). 여기서 더 거르지 않는다:
   * 걸러야 할 것이 있다면 그건 달력과 달라지는 자리다.
   */
  const list = useMemo(() => entriesOn(agenda.entries, iso), [agenda.entries, iso]);
  const holiday = agenda.holidays[iso];
  const loading = agenda.loading;

  /**
   * 요일 색 — **일정 페이지의 규칙 그대로**(요청): 일요일·쉬는 공휴일은
   * `--mf-danger`, 토요일은 `--mf-info`, 나머지는 본문색. `MonthGrid`의 `numFg`와
   * 같은 갈래라 한쪽만 바뀌면 두 화면이 어긋난다.
   */
  const dow = at ? new Date(at.y, at.m - 1, at.d).getDay() : -1;
  const dowInk = dow === 0 || holiday?.dayOff ? 'var(--mf-danger)' : dow === 6 ? 'var(--mf-info)' : th.text;

  const go = (open: NoteEventOpen): void => {
    onClose();
    onOpenEvent(open);
  };

  // 아래 공간 300px 기준으로 위아래를 정한다(스펙 3-3).
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const below = vh - rect.bottom - 8;
  const place = below > 300 ? 'below' : 'above';
  const left = Math.max(8, Math.min(rect.left, vw - 272 - 8));

  return (
    <div
      data-note-datepop={iso}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{
        position: 'fixed',
        left,
        ...(place === 'below' ? { top: rect.bottom + 8 } : { bottom: vh - rect.top + 8 }),
        zIndex: 80,
        width: 272,
        boxSizing: 'border-box',
        borderRadius: 14,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border-soft)',
        boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
        overflow: 'hidden',
        animation: 'mf-note-pop .13s ease both',
      }}
    >
      <div style={{ padding: '12px 14px 8px' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          {/* **날짜는 본문색, 요일만 색**(요청) — 머리 전체를 물들이면 그 날이 무슨
              날인지가 아니라 "이 팝오버가 강조 상태"로 읽힌다. 칩의 요일 글자와 같은
              규칙이고, 여기서는 공휴일까지 안다(일정과 함께 받아 온다). */}
          <span data-datepop-title data-datepop-dow={dow >= 0 ? String(dow) : undefined} style={{ flex: '0 0 auto', fontSize: 13.5, fontWeight: 800, color: th.text }}>
            {at ? `${at.m}월 ${at.d}일 ` : iso}
            {at && (
              <span data-datepop-dow-ink style={{ color: dowInk }}>{DOW_FULL[dow] ?? ''}</span>
            )}
          </span>
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, fontWeight: 700, color: iso === today ? '#e85e33' : th.subtext }}>{relDayLabel(iso, today)}</span>
          {/* 개수는 **다 받은 뒤에만** 말한다 — 받는 중에 「일정 0개」를 보이면 그게
              답인 줄 알고 팝오버를 닫는다(제보: 깜빡인다 · 종일 일정이 안 보인다). */}
          {loading ? (
            <span data-datepop-count-skel aria-hidden className="mf-note-skel" style={{ flex: '0 0 42px', height: 9, borderRadius: 5 }} />
          ) : (
            <span data-datepop-count style={{ flex: '0 0 auto', fontSize: 11, color: th.subtext }}>일정 {list.length}개</span>
          )}
        </span>
        {holiday?.name && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 700, color: '#c4614c' }}>{holiday.name}</span>}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '0 8px 6px' }}>
        {loading ? (
          /* 스켈레톤 — 줄 높이(28px)를 그대로 잡아 목록이 도착해도 판이 튀지 않는다.
             두 줄인 이유: 한 줄이면 "일정 하나"로 읽히고, 셋이면 빈 날에 과하다. */
          <span data-datepop-skel aria-hidden style={{ display: 'block', padding: '2px 0 4px' }}>
            {[0, 1].map((i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px' }}>
                <span className="mf-note-skel" style={{ flex: '0 0 42px', height: 9, borderRadius: 5 }} />
                <span className="mf-note-skel" style={{ flex: '0 0 3px', height: 16, borderRadius: 2 }} />
                <span className="mf-note-skel" style={{ flex: '1 1 auto', height: 9, borderRadius: 5, maxWidth: i ? '58%' : '82%' }} />
              </span>
            ))}
          </span>
        ) : list.length ? (
          list.map((e: CalendarEntry) => (
            <button
              key={e.cardId}
              type="button"
              data-datepop-entry={e.cardId}
              className="mf-note-sched-row"
              onClick={() => {
                // 반복 회차의 키는 `id#회차시작일`이다 — 삭제 범위(이 일정만/이후)의
                // 기준이라 상세까지 그대로 넘긴다(일정 화면과 같은 규칙).
                if (e.google) go({ kind: 'google', id: e.cardId, at: iso });
                else if (e.event) {
                  const [id, occ] = e.cardId.split('#');
                  go({ kind: 'geurio', id: id ?? e.cardId, ...(occ ? { occ } : {}), at: iso });
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 8px', borderRadius: 8, border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
            >
              <span style={{ flex: '0 0 42px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: th.subtext }}>{dayProgress(e, iso) ?? (e.startTime || '종일')}</span>
              <span aria-hidden style={{ flex: '0 0 3px', height: 16, borderRadius: 2, background: '#e0a88c' }} />
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: th.text }}>{e.title}</span>
            </button>
          ))
        ) : (
          <span data-datepop-empty style={{ display: 'block', padding: '4px 8px 8px', fontSize: 12.5, color: 'var(--mf-faint)' }}>이 날에는 일정이 없어요</span>
        )}
      </div>
      <button
        type="button"
        data-datepop-new
        onClick={() => go({ kind: 'new', at: iso })}
        style={{ display: 'block', width: '100%', height: 34, border: 0, borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-chip-bg)', color: th.subtext, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
      >
        + 이 날에 일정 추가
      </button>
    </div>
  );
}

// 날짜 칩에 마우스를 올리면 뜨는 **그날 일정**(스펙 3-3).
//
// 칩은 "이 문장이 가리키는 날"이고, 그 날에 무엇이 있는지는 캘린더만 안다. 올려서 보는
// 것으로 끝나는 자리라 누르지 않아도 열리고, 벗어나면 닫힌다 — 여닫는 타이밍(110ms 열고
// 180ms 닫기)은 스펙이 정했고 **팝오버 위에 있는 동안은 닫지 않는다**(목록을 훑어야 한다).

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalendarEntry } from '../../home/calendar/entries';
import { dayProgress, entriesOn, partsOf } from '../../home/calendar/model';
import { focusCalendar } from '../../home/calendarFocus';
import { useNoteAgenda } from '../noteAgenda';
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
}: {
  iso: string;
  today: string;
  /** 칩의 화면 사각형 — 이 아래(또는 위)에 선다. */
  rect: { left: number; top: number; bottom: number };
  theme: Theme;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const th = theme;
  const at = partsOf(iso);
  const agenda = useNoteAgenda(at?.y ?? 2026, at?.m ?? 1);
  const list = useMemo(() => entriesOn(agenda.entries, iso), [agenda.entries, iso]);
  const navigate = useNavigate();
  const holiday = agenda.holidays[iso];

  const go = (focus?: { date: string; eventId?: string; source?: 'geurio' | 'google' }): void => {
    onClose();
    focusCalendar(focus);
    navigate('/home');
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
          <span data-datepop-title style={{ flex: '0 0 auto', fontSize: 13.5, fontWeight: 800, color: th.text }}>
            {at ? `${at.m}월 ${at.d}일 ${DOW_FULL[new Date(at.y, at.m - 1, at.d).getDay()] ?? ''}` : iso}
          </span>
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11.5, fontWeight: 700, color: iso === today ? '#e85e33' : th.subtext }}>{relDayLabel(iso, today)}</span>
          <span data-datepop-count style={{ flex: '0 0 auto', fontSize: 11, color: th.subtext }}>일정 {list.length}개</span>
        </span>
        {holiday?.name && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, fontWeight: 700, color: '#c4614c' }}>{holiday.name}</span>}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '0 8px 6px' }}>
        {list.length ? (
          list.map((e: CalendarEntry) => (
            <button
              key={e.cardId}
              type="button"
              data-datepop-entry={e.cardId}
              className="mf-note-sched-row"
              onClick={() => go({ date: e.due, ...(e.google || e.event ? { eventId: e.cardId } : {}), ...(e.google ? { source: 'google' as const } : e.event ? { source: 'geurio' as const } : {}) })}
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
        onClick={() => go({ date: iso })}
        style={{ display: 'block', width: '100%', height: 34, border: 0, borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-chip-bg)', color: th.subtext, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
      >
        + 이 날에 일정 추가
      </button>
    </div>
  );
}

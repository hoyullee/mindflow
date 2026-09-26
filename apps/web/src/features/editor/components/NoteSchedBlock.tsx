// 본문의 **일정 블록**(스펙 2-3) — 캘린더와 실시간으로 이어진 일정 목록.
//
// 본문에 드는 것은 "무엇을 보여 줄까"(`block.sched`)뿐이고 내용은 그때그때 캘린더에서
// 읽는다 — 그래서 어제 쓴 페이지를 오늘 열면 오늘 일정이 뜬다. 일정을 본문에 베껴
// 두면 지우거나 옮긴 일정이 문서에 화석으로 남는다(`NoteBlock.sched` 주석).
//
// 글이 없는 **위젯 블록**이라 캐럿이 서지 않는다(구분선·그림과 같은 갈래). 고르기·
// 옮기기·지우기는 블록 단위이고, 안쪽 조작(세그먼트·달력·일정 줄)은 전파를 끊는다.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NoteBlock } from '@mindflow/mindmap-core';
import type { CalendarEntry } from '../../home/calendar/entries';
import { MiniCalendar } from '../../home/calendar/MiniCalendar';
import { DOW, dayProgress, partsOf, todayISO } from '../../home/calendar/model';
import { entryChip } from '../../home/calendar/chips';
import { focusCalendar } from '../../home/calendarFocus';
import { schedDays, schedSubtitle, schedTitle, useNoteAgenda, type SchedKind } from '../noteAgenda';
import type { EditorController } from '../useEditorState';

const SEG: SchedKind[] = ['today', 'week', 'month', 'next'];
const SEG_NAME: Record<SchedKind, string> = { today: '오늘', week: '이번 주', month: '달력', next: '다가오는' };

/** 날짜 칸의 숫자 색 — 큰 달력과 같은 규칙(오늘·일요일·토요일). */
function dayInk(iso: string, today: string): string {
  if (iso === today) return '#e85e33';
  const at = partsOf(iso);
  if (!at) return 'var(--mf-text)';
  const dow = new Date(at.y, at.m - 1, at.d).getDay();
  return dow === 0 ? '#c4614c' : dow === 6 ? '#5f81bf' : 'var(--mf-text)';
}

function dowLabel(iso: string, today: string): string {
  if (iso === today) return '오늘';
  const at = partsOf(iso);
  if (!at) return '';
  return DOW[new Date(at.y, at.m - 1, at.d).getDay()] ?? '';
}

export function NoteSchedBlock({
  controller,
  block,
  flow,
  picked,
  pickObject,
}: {
  controller: EditorController;
  block: NoteBlock;
  flow: React.CSSProperties;
  picked: boolean;
  pickObject: (id: string, add: boolean) => void;
}) {
  const th = controller.uiTheme;
  const navigate = useNavigate();
  const today = todayISO();
  const at = partsOf(today)!;
  const kind: SchedKind = block.sched ?? 'today';
  const [day, setDay] = useState(block.schedDay || today);
  // 달력 보기만 달을 옮길 수 있다 — 나머지는 "오늘 기준"이라 이번 달 격자면 족하다.
  const [ym, setYm] = useState(() => {
    const p = partsOf(block.schedDay || today) ?? at;
    return { y: p.y, m: p.m };
  });
  const agenda = useNoteAgenda(ym.y, ym.m);
  const days = useMemo(() => schedDays(kind, agenda.entries, today, day), [kind, agenda.entries, today, day]);
  const surface = useMemo(() => ({ card: th.panel, text: th.text }), [th.panel, th.text]);

  const setKind = (next: SchedKind): void => controller.setNoteBlockSched(block.id, next);
  const openEntry = (e: CalendarEntry): void => {
    focusCalendar({ date: e.due, ...(e.google || e.event ? { eventId: e.cardId } : {}), ...(e.google ? { source: 'google' as const } : e.event ? { source: 'geurio' as const } : {}) });
    navigate('/home');
  };
  const newEvent = (iso: string): void => {
    focusCalendar({ date: iso });
    navigate('/home');
  };

  const row = (e: CalendarEntry, iso: string, withSource: boolean) => {
    const chip = entryChip(e, surface);
    const span = dayProgress(e, iso);
    return (
      <button
        key={`${e.cardId}:${iso}`}
        type="button"
        data-sched-entry={e.cardId}
        className="mf-note-sched-row"
        onClick={(ev) => {
          ev.stopPropagation();
          openEntry(e);
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 8px', borderRadius: 8, border: 0, background: 'transparent', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ flex: '0 0 46px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: th.subtext }}>
          {span ?? (e.startTime || '종일')}
        </span>
        <span aria-hidden style={{ flex: '0 0 3px', height: 16, borderRadius: 2, background: chip.base }} />
        <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: th.text }}>{e.title}</span>
        {withSource && <span style={{ flex: '0 0 auto', fontSize: 11, color: th.subtext }}>{e.google ? 'Google' : e.event ? 'Geurio' : e.boardName}</span>}
      </button>
    );
  };

  const emptyLine = <span style={{ display: 'block', padding: '7px 0', fontSize: 12.5, color: th.subtext }}>일정 없음</span>;

  return (
    <div data-note-block={block.id} data-note-kind="sched" style={flow}>
      <div
        data-sched-block={block.id}
        data-sched-kind={kind}
        contentEditable={false}
        onPointerDown={(e) => {
          e.stopPropagation();
          pickObject(block.id, e.shiftKey);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${picked ? 'var(--mf-accent-mute)' : 'var(--mf-border-soft)'}`,
          borderRadius: 14,
          background: 'var(--mf-card)',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {/* 머리 띠(2-3) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 13px', background: 'var(--mf-note-chip-bg)', borderBottom: '1px solid var(--mf-border-soft)' }}>
          <span aria-hidden style={{ flex: '0 0 auto', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'var(--mf-note-chip-bg-on)', color: 'var(--mf-note-chip-icon)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M8 3v4M16 3v4M3 10h18" />
            </svg>
          </span>
          <span data-sched-title style={{ flex: '0 0 auto', fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: th.text }}>{schedTitle(kind, today)}</span>
          <span data-sched-sub style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: th.subtext }}>
            {schedSubtitle(kind, agenda.entries, today)}
          </span>
          {!controller.readOnly && (
            <span style={{ flex: '0 0 auto', display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--mf-note-chip-pill)' }}>
              {SEG.map((k) => (
                <button
                  key={k}
                  type="button"
                  data-sched-seg={k}
                  aria-pressed={k === kind}
                  onClick={(e) => {
                    e.stopPropagation();
                    setKind(k);
                  }}
                  style={{
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 7,
                    border: 0,
                    background: k === kind ? 'var(--mf-card)' : 'transparent',
                    color: k === kind ? th.text : th.subtext,
                    boxShadow: k === kind ? '0 1px 2px rgba(46,42,38,.12)' : 'none',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: k === kind ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {SEG_NAME[k]}
                </button>
              ))}
            </span>
          )}
          {!controller.readOnly && (
            <>
              <button
                type="button"
                data-sched-new
                aria-label="새 일정"
                title="새 일정"
                onClick={(e) => {
                  e.stopPropagation();
                  newEvent(kind === 'month' ? day : today);
                }}
                style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: 8, border: 0, background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 15, cursor: 'pointer' }}
              >
                +
              </button>
              <button
                type="button"
                data-sched-remove
                aria-label="일정 블록 지우기"
                title="지우기"
                onClick={(e) => {
                  e.stopPropagation();
                  controller.removeNoteBlock(block.id);
                }}
                style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--mf-faint)', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer' }}
              >
                ×
              </button>
            </>
          )}
        </div>

        {kind === 'month' ? (
          /* 달력형 — 왼쪽 미니 달력(일정 화면의 그 부품), 오른쪽 고른 날의 목록 */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
            <div style={{ padding: '11px 13px 13px' }}>
              <MiniCalendar
                entries={agenda.entries}
                todayIso={today}
                y={ym.y}
                m={ym.m}
                selectedDay={day}
                holidays={agenda.holidays}
                onPickDay={(iso) => {
                  setDay(iso);
                  controller.setNoteBlockSched(block.id, 'month', iso);
                }}
                onSetMonth={(y, m) => setYm({ y, m })}
                cellH={30}
              />
            </div>
            <div style={{ borderLeft: '1px solid var(--mf-border-soft)', padding: '11px 8px 10px' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 6px 6px' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: th.text }}>{(() => {
                  const p = partsOf(day);
                  return p ? `${p.m}월 ${p.d}일 ${dowLabel(day, '')}` : day;
                })()}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: day === today ? '#e85e33' : th.subtext }}>{dueLabel(day, today)}</span>
              </span>
              {days[0]?.entries.length ? days[0].entries.map((e) => row(e, day, false)) : <span style={{ padding: '0 6px' }}>{emptyLine}</span>}
            </div>
          </div>
        ) : (
          /* 목록형 — 날짜 줄마다 그 날의 일정 */
          <div style={{ padding: '2px 0' }}>
            {days.map((d, i) => (
              <div key={d.iso} data-sched-day={d.iso} style={{ display: 'flex', gap: 12, padding: '8px 14px 8px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--mf-border-soft)' }}>
                <span style={{ flex: '0 0 36px', textAlign: 'center' }}>
                  <span style={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 16, fontWeight: 800, lineHeight: 1.15, color: dayInk(d.iso, today) }}>{partsOf(d.iso)?.d ?? ''}</span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: d.iso === today ? '#e85e33' : th.subtext }}>{dowLabel(d.iso, today)}</span>
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>{d.entries.length ? d.entries.map((e) => row(e, d.iso, true)) : emptyLine}</span>
              </div>
            ))}
            {!days.length && <span style={{ display: 'block', padding: '14px 16px', fontSize: 12.5, color: th.subtext }}>일정 없음</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** `오늘 / 내일 / 어제 / N일 뒤 / N일 전`(2-3 달력형의 머리). */
function dueLabel(iso: string, today: string): string {
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

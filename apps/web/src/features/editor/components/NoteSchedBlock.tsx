// 본문의 **일정 블록**(스펙 2-3) — 캘린더와 실시간으로 이어진 일정 목록.
//
// 본문에 드는 것은 "무엇을 보여 줄까"(`block.sched`)뿐이고 내용은 그때그때 캘린더에서
// 읽는다 — 그래서 어제 쓴 페이지를 오늘 열면 오늘 일정이 뜬다. 일정을 본문에 베껴
// 두면 지우거나 옮긴 일정이 문서에 화석으로 남는다(`NoteBlock.sched` 주석).
//
// 글이 없는 **위젯 블록**이라 캐럿이 서지 않는다(구분선·그림과 같은 갈래). 고르기·
// 옮기기·지우기는 블록 단위이고, 안쪽 조작(세그먼트·달력·일정 줄)은 전파를 끊는다.

import { useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NoteBlock } from '@mindflow/mindmap-core';
import type { CalendarEntry } from '../../home/calendar/entries';
import { MiniCalendar } from '../../home/calendar/MiniCalendar';
import { DOW, dayProgress, partsOf, todayISO } from '../../home/calendar/model';
import { entryChip } from '../../home/calendar/chips';
import { focusCalendar } from '../../home/calendarFocus';
import { schedDays, useNoteAgenda, type SchedKind } from '../noteAgenda';
import type { EditorController } from '../useEditorState';
import { NoteEventOpenerContext, noteEventOpenOf } from './NoteEventPopups';

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

  const openInNote = useContext(NoteEventOpenerContext);
  /**
   * 일정을 누르면 **공책 안에서** 그 팝업을 연다(제보: 일정 화면으로 건너가 버렸다) — 날짜 칩·
   * 우측 「일정」 탭과 같은 길이고, 어느 상세를 여는가도 같은 한 자리(`noteEventOpenOf`)가 정한다.
   * 편집기 밖(공급자가 없는 미리보기)에서만 예전처럼 일정 화면으로 보낸다.
   */
  const openEntry = (e: CalendarEntry, iso: string): void => {
    if (openInNote) {
      openInNote(noteEventOpenOf(e, e.due || iso));
      return;
    }
    focusCalendar({ date: e.due, ...(e.google || e.event ? { eventId: e.cardId } : {}), ...(e.google ? { source: 'google' as const } : e.event ? { source: 'geurio' as const } : {}) });
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
          openEntry(e, iso);
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
        {/* 머리 띠는 **없다**(요청) — 제목·부제·보기 세그먼트·`+`·`×`를 통째로 걷었다. 보기는 넣을
            때 「일정 블록 고르기」 창에서 고르고(`/일정`), 지우기는 다른 위젯 블록과 같다(골라서
            Delete · 우클릭 메뉴). 머리가 있으면 본문 안의 일정이 **본문이 아니라 창**으로 읽혔다. */}
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
                  // 앞뒤 달의 칸을 눌렀으면 **보는 달도 따라간다** — 머리와 목록이
                  // 서로 다른 달을 말하지 않게 한다(제보 17).
                  const p = partsOf(iso);
                  if (p && (p.y !== ym.y || p.m !== ym.m)) setYm({ y: p.y, m: p.m });
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

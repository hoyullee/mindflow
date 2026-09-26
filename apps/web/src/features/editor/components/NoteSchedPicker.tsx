// 「일정 블록 고르기」(스펙 2-2) — `/일정`을 고르면 뜨는 572px 2열 창.
//
// 왼쪽이 종류 넷, 오른쪽이 **실제 데이터로 그린** 미리보기다. 실제 데이터인 이유는
// 스펙이 그렇게 적었고, 그래야 "내 일정이 이렇게 보이겠구나"가 고르기 전에 읽히기
// 때문이다(빈 상자 넷을 놓고 고르라고 하면 이름만으로 고르게 된다).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CalendarEntry } from '../../home/calendar/entries';
import { DOW, monthCells, partsOf, todayISO } from '../../home/calendar/model';
import { SCHED_KINDS, schedDays, schedSubtitle, schedTitle, useNoteAgenda, type SchedKind } from '../noteAgenda';
import type { Theme } from '../theme';

/** 종류별 설명 세 줄(스펙 2-2의 표). */
const BLURBS: Record<SchedKind, string[]> = {
  today: ['오늘 하루 일정을 시간순으로 보여줘요', '날짜가 바뀌면 그날 일정으로 자동 갱신돼요', '항목을 누르면 일정 상세가 열려요'],
  week: ['이번 주(일–토)를 날짜별로 묶어 보여줘요', '일정이 없는 날은 접고 오늘은 항상 보여요', '회의록·주간 계획에 잘 맞아요'],
  month: ['이번 달 미니 달력 옆에 고른 날 일정이 나와요', '점이 찍힌 날에 일정이 있어요', '날짜를 누르면 오른쪽 목록이 바뀌어요'],
  next: ['오늘부터 가까운 일정 6개만 추려요', '날짜가 멀어도 다음 일정을 놓치지 않아요', '할 일·준비 페이지에 잘 맞아요'],
};

const ICONS: Record<SchedKind, JSX.Element> = {
  today: (<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" /></>),
  week: (<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M7 15.5h10" /></>),
  month: (<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="17.5" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" /></>),
  next: (<><path d="M4 6h13M4 11h13M4 16h8" /><path d="M18 12v8M15 17l3 3 3-3" /></>),
};

const PANEL: CSSProperties = {
  position: 'fixed',
  zIndex: 60,
  width: 572,
  maxWidth: 'calc(100vw - 16px)',
  boxSizing: 'border-box',
  borderRadius: 14,
  background: 'var(--mf-card)',
  border: '1px solid var(--mf-border-soft)',
  boxShadow: '0 22px 44px -22px rgba(46,42,38,.5)',
  overflow: 'hidden',
  animation: 'mf-note-pop .13s ease both',
};

export function NoteSchedPicker({ anchor, theme, onPick, onClose }: { anchor: { x: number; y: number } | null; theme: Theme; onPick: (kind: SchedKind) => void; onClose: () => void }) {
  const th = theme;
  const today = todayISO();
  const at = partsOf(today)!;
  const agenda = useNoteAgenda(at.y, at.m);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const kind = SCHED_KINDS[cursor]?.key ?? 'today';

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + SCHED_KINDS.length) % SCHED_KINDS.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onPick(SCHED_KINDS[cursor]?.key ?? 'today');
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [cursor, onClose, onPick]);

  // 자리 — 예상 높이 400px 기준으로 위아래를 정한다(스펙 2-2).
  const pos = useMemo(() => {
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
    const x = Math.max(8, Math.min((anchor?.x ?? vw / 2) - 40, vw - 572 - 8));
    const y = anchor?.y ?? vh / 2;
    return y + 400 + 12 < vh ? { left: x, top: y + 8 } : { left: x, top: Math.max(8, y - 400 - 8) };
  }, [anchor]);

  return (
    <div ref={boxRef} data-sched-picker style={{ ...PANEL, ...pos }} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px 8px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: th.subtext }}>일정 블록 고르기</span>
        <span style={{ fontSize: 10.5, color: 'var(--mf-faint)' }}>↑↓ 이동 · Enter</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '236px 1fr', minHeight: 0 }}>
        <div style={{ padding: '7px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SCHED_KINDS.map((k, i) => (
            <button
              key={k.key}
              type="button"
              data-sched-pick={k.key}
              aria-current={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(k.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '7px 8px',
                borderRadius: 10,
                border: 0,
                background: i === cursor ? 'var(--mf-note-chip-bg)' : 'transparent',
                fontFamily: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: 34,
                  height: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  background: i === cursor ? 'var(--mf-note-chip-bg-on)' : 'var(--mf-note-chip-pill)',
                  color: i === cursor ? 'var(--mf-note-chip-icon)' : th.subtext,
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[k.key]}
                </svg>
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: th.text }}>{k.name}</span>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: th.subtext }}>{k.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ padding: '12px 14px 14px', borderLeft: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-chip-bg)' }}>
          <span style={{ display: 'block', paddingBottom: 7, fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mf-faint)' }}>본문에 이렇게 들어가요</span>
          <SchedPreview kind={kind} entries={agenda.entries} today={today} theme={th} />
          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {BLURBS[kind].map((line) => (
              <li key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span aria-hidden style={{ flex: '0 0 auto', width: 4, height: 4, marginTop: 7, borderRadius: 99, background: '#d8c8b8' }} />
                {/* 글자를 **따로 감싼다** — 줄이 바뀌어도 불릿과 겹치지 않게(스펙 2-2). */}
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.5, color: th.subtext, wordBreak: 'keep-all' }}>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** 미니 카드 — 실제 블록을 축소한 모양(스펙 2-2). **실제 데이터로** 그린다. */
function SchedPreview({ kind, entries, today, theme }: { kind: SchedKind; entries: readonly CalendarEntry[]; today: string; theme: Theme }) {
  const th = theme;
  const at = partsOf(today)!;
  const days = schedDays(kind, entries, today).slice(0, 3);
  const cells = kind === 'month' ? monthCells(at.y, at.m, entries, today, 0, 6) : [];
  return (
    <div data-sched-preview={kind} style={{ borderRadius: 11, border: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)', boxShadow: '0 1px 2px rgba(46,42,38,.05)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-chip-bg)' }}>
        <span aria-hidden style={{ flex: '0 0 auto', width: 20, height: 20, borderRadius: 6, background: 'var(--mf-note-chip-bg-on)' }} />
        <span style={{ flex: '0 0 auto', fontSize: 11.5, fontWeight: 800, color: th.text }}>{schedTitle(kind, today)}</span>
        <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 9.5, color: th.subtext }}>
          {schedSubtitle(kind, entries, today)}
        </span>
      </div>
      {kind === 'month' ? (
        <div style={{ padding: 8, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((c) => (
            <span key={c.iso} style={{ height: 19, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <span
                style={{
                  width: 15,
                  height: 13,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 9.5,
                  background: c.iso === today ? '#e85e33' : 'transparent',
                  color: c.iso === today ? '#fff' : c.inMonth ? th.text : 'var(--mf-faint)',
                }}
              >
                {partsOf(c.iso)?.d ?? ''}
              </span>
              <span aria-hidden style={{ width: 3, height: 3, borderRadius: 99, background: c.entries.length ? (c.iso === today ? '#fff' : '#e0a88c') : 'transparent' }} />
            </span>
          ))}
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {days.length ? (
            days.map((d) => (
              <div key={d.iso} style={{ display: 'flex', gap: 8, padding: '4px 9px' }}>
                <span style={{ flex: '0 0 24px', textAlign: 'center' }}>
                  <span style={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 800, color: d.iso === today ? '#e85e33' : th.text }}>{partsOf(d.iso)?.d ?? ''}</span>
                  <span style={{ display: 'block', fontSize: 8.5, color: th.subtext }}>{(() => {
                    const p = partsOf(d.iso);
                    return p ? (DOW[new Date(p.y, p.m - 1, p.d).getDay()] ?? '') : '';
                  })()}</span>
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                  {d.entries.slice(0, 3).map((e) => (
                    <span key={e.cardId} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 17 }}>
                      <span style={{ flex: '0 0 30px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 9.5, color: th.subtext }}>{e.startTime || '종일'}</span>
                      <span aria-hidden style={{ flex: '0 0 2px', height: 11, borderRadius: 1, background: '#e0a88c' }} />
                      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, fontWeight: 700, color: th.text }}>{e.title}</span>
                    </span>
                  ))}
                  {d.entries.length > 3 && <span style={{ display: 'block', fontSize: 10, color: th.subtext }}>외 {d.entries.length - 3}개 더</span>}
                  {!d.entries.length && <span style={{ display: 'block', height: 17, fontSize: 10.5, color: 'var(--mf-faint)' }}>일정 없음</span>}
                </span>
              </div>
            ))
          ) : (
            <span style={{ display: 'block', padding: '10px 12px', fontSize: 10.5, color: 'var(--mf-faint)' }}>일정 없음</span>
          )}
        </div>
      )}
    </div>
  );
}

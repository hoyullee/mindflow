// 마감 목록 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `dlOpen` 패널 이식.
//
// 날짜별 보기(RNB)와 **다른 물건**이다: 그 패널은 고른 날 하나를 펼쳐 보여 주고,
// 이쪽은 달과 무관하게 "다가오는 마감 / 지난 마감"을 훑는 목록이다. 그래서 디자인
// 원본도 둘을 각자 켜고 끄는 버튼으로 두고, 이 목록은 달력 위에 **겹치는 판**으로
// 띄운다(둘 다 켜면 RNB 왼쪽에 나란히 선다).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CalendarEntry } from './entries';
import { entryChip, markStyle, type ChipSurface } from './chips';
import { dueBadge, dueTone, isSpan, overdueEntries, upcomingEntries, type DueTone } from './model';

/** 한 번에 보여 주는 줄 수 — 넘치면 `+N개 더 보기`로 접는다(제보 #15). */
const PAGE = 7;

/**
 * 마감 배지의 색 — **중요도 사다리**(제보 #14: 오늘도 D-14도 같은 색이라 급한 정도가
 * 안 보였다). 등급은 순수 함수(`dueTone`)가 정하고 여기서는 그 등급의 옷만 입힌다.
 */
const TONE: Record<DueTone, CSSProperties> = {
  over: { background: 'var(--mf-danger-bg)', color: 'var(--mf-stat-over)' },
  today: { background: 'var(--mf-accent-soft)', color: 'var(--mf-stat-today)' },
  soon: { background: 'var(--mf-due-soon-bg)', color: 'var(--mf-stat-week)' },
  later: { background: 'var(--mf-panel2)', color: 'var(--mf-muted)' },
};

export function DeadlinePanel({
  entries,
  todayIso,
  surface,
  offsetRight,
  onPickEntry,
  onClose,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
  surface: ChipSurface;
  /** 날짜별 보기가 열려 있으면 그 폭만큼 왼쪽으로 비켜선다(원본 `dlRight`). */
  offsetRight: number;
  onPickEntry: (e: CalendarEntry) => void;
  onClose: () => void;
}) {
  const upcoming = upcomingEntries(entries, todayIso);
  const overdue = overdueEntries(entries, todayIso);
  // 다가오는 마감이 많으면 스크롤이 통째로 길어진다(제보) — 처음에는 앞의 것만
  // 보여 주고 나머지는 `+N개 더 보기`로 편다(펼치면 그대로 남는다).
  const [openAll, setOpenAll] = useState(false);
  const [openOld, setOpenOld] = useState(false);
  return (
    <div
      data-cal-deadline
      className="lnb-scroll"
      style={{
        position: 'absolute',
        zIndex: 22,
        top: 0,
        bottom: 0,
        right: offsetRight,
        // 제목·보드 이름이 자주 잘려 조금 더 넓혔다(제보 #13).
        width: 320,
        boxSizing: 'border-box',
        borderLeft: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-card)',
        boxShadow: '-18px 0 36px -26px rgba(46,42,38,.45)',
        padding: '14px 14px 22px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        animation: 'mf-fade .18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px 10px', flexShrink: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>마감 목록</span>
        <button type="button" aria-label="마감 목록 닫기" title="닫기" onClick={onClose} className="mf-ctl" style={{ width: 22, height: 22, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <SectionLabel>다가오는 마감</SectionLabel>
      {upcoming.length ? (
        <>
          {(openAll ? upcoming.slice(0, 60) : upcoming.slice(0, PAGE)).map((e) => (
            <Row key={`${e.docId}-${e.cardId}`} entry={e} todayIso={todayIso} surface={surface} onPick={onPickEntry} />
          ))}
          {!openAll && upcoming.length > PAGE && <MoreButton attr="data-cal-more-upcoming" n={upcoming.length - PAGE} onClick={() => setOpenAll(true)} />}
        </>
      ) : (
        <span style={{ padding: '4px 9px 8px', fontSize: 11.5, color: 'var(--mf-faint)' }}>다가오는 마감이 없어요</span>
      )}

      {overdue.length > 0 && (
        <>
          <SectionLabel>지난 마감</SectionLabel>
          {(openOld ? overdue.slice(0, 60) : overdue.slice(0, PAGE)).map((e) => (
            <Row key={`${e.docId}-${e.cardId}`} entry={e} todayIso={todayIso} surface={surface} onPick={onPickEntry} />
          ))}
          {!openOld && overdue.length > PAGE && <MoreButton attr="data-cal-more-overdue" n={overdue.length - PAGE} onClick={() => setOpenOld(true)} />}
        </>
      )}
    </div>
  );
}

/** 접힌 나머지를 펴는 줄 — 목록의 한 행처럼 보이되 면 없이 글자만. */
function MoreButton({ n, attr, onClick }: { n: number; attr: string; onClick: () => void }) {
  return (
    <button
      type="button"
      {...{ [attr]: '1' }}
      onClick={onClick}
      className="mf-ctl"
      style={{ flexShrink: 0, width: '100%', padding: '8px 9px', marginTop: 2, borderRadius: 10, border: '1px dashed var(--mf-border)', background: 'transparent', font: 'inherit', fontSize: 11.5, fontWeight: 700, color: 'var(--mf-muted)', cursor: 'pointer', textAlign: 'center' }}
    >
      +{n}개 더 보기
    </button>
  );
}

/** 구획 이름 — 원본과 같은 작은 대문자 꼴. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', color: 'var(--mf-faint)', padding: '10px 9px 8px' }}>{children}</span>;
}

function Row({ entry, todayIso, surface, onPick }: { entry: CalendarEntry; todayIso: string; surface: ChipSurface; onPick: (e: CalendarEntry) => void }) {
  const chip = entryChip(entry, surface);
  const badge = dueBadge(entry.due, todayIso);
  const tone = dueTone(entry.due, todayIso);
  return (
    <button
      type="button"
      data-cal-row={`${entry.docId}:${entry.cardId}`}
      onClick={() => onPick(entry)}
      className="mf-ctl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 9px',
        borderRadius: 10,
        border: '1px solid var(--mf-border-soft)',
        background: 'var(--mf-card)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={markStyle(chip)} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title || '제목 없음'}</span>
        <span style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.boardName} · {entry.colName}
          {isSpan(entry) ? ` · ${entry.start!.slice(5).replace('-', '.')} – ${entry.due.slice(5).replace('-', '.')}` : ''}
        </span>
      </span>
      <span
        data-cal-due={tone}
        style={{
          flexShrink: 0,
          height: 18,
          padding: '0 7px',
          borderRadius: 999,
          ...TONE[tone],
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9.5,
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {badge}
      </span>
    </button>
  );
}

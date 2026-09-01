// 그 날의 일정 전부 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `dayListOpen` 팝업.
//
// 날짜 칸을 **더블클릭**하거나 `+N개 더`를 누르면 뜬다. 칸은 좁아 두 줄이면 접히는데,
// 이 팝업은 기간 일정(그 날을 지나는 바)까지 **전부** 한 목록으로 늘어놓는다.
// 항목을 고르면 그 상세 팝업으로 이어지고, 발치의 점선 버튼이 그 날짜로 새 일정을 연다.
//
// 색은 원본의 고정 hex를 그대로 박지 않고 이 화면의 규칙을 따른다 — **hue는 원본
// (구글 파랑 · Geurio 코랄 · 칸반/기간 초록), 밝기는 놓이는 면에서**(`mixHex`/`tagInk`,
// 칩과 같은 판단). 왼쪽 색 바는 그 항목의 상태 점 색(`entryChip(...).dot`)이라
// 달력 칩과 같은 색으로 같은 항목을 가리킨다.

import { Modal } from '../../../components/Modal';
import { mixHex } from '../../editor/theme';
import { tagInk } from '../../editor/kanbanMeta';
import type { CalendarEntry, HolidayInfo } from './entries';
import { entryChip, type ChipSurface } from './chips';
import { dayProgress, entriesOn, isSpan, minutesOf, partsOf, timeLabel } from './model';

/** 원본 태그 알약의 hue — 구글 `#7C9BD8` · Geurio `#E8845C` · 칸반/기간 `#69B08A`. */
const TAG_HUE = { google: '#7C9BD8', geurio: '#E8845C', kanban: '#69B08A', span: '#69B08A' } as const;

/** 한 항목의 태그 이름 + hue — 행 오른쪽 알약(원본 `v.tag`/`tagBg`/`tagFg`). */
function tagOf(e: CalendarEntry): { label: string; hue: string } {
  if (isSpan(e)) return { label: '기간', hue: TAG_HUE.span };
  if (e.google) return { label: '구글', hue: TAG_HUE.google };
  if (e.event) return { label: '캘린더', hue: TAG_HUE.geurio };
  return { label: '칸반', hue: TAG_HUE.kanban };
}

/** 행의 둘째 줄 — 원본의 `v.sub`: 기간은 `8.24–8.30 · 7일 중 3일째`, 나머지는 출처. */
function subOf(e: CalendarEntry, iso: string): string {
  if (isSpan(e)) {
    const from = partsOf(e.start!);
    const to = partsOf(e.due);
    const range = from && to ? `${from.m}.${from.d}–${to.m}.${to.d}` : '';
    const prog = dayProgress(e, iso);
    return [range, prog].filter(Boolean).join(' · ');
  }
  const mins = minutesOf(e.startTime);
  const when = mins == null ? '하루 종일' : timeLabel(mins);
  if (e.google) return `${when} · 구글 캘린더`;
  if (e.event) return `${when} · Geurio 캘린더`;
  return `${e.boardName} · ${e.colName}`;
}

export function DayListPopup({
  iso,
  entries,
  holiday,
  surface,
  onClose,
  onPickEntry,
  onNew,
}: {
  iso: string;
  entries: readonly CalendarEntry[];
  holiday?: HolidayInfo;
  surface: ChipSurface;
  onClose: () => void;
  /** 행을 골랐다 — 팝업을 닫고 그 항목의 상세를 연다(호출부가 잇는다). */
  onPickEntry: (e: CalendarEntry) => void;
  /** 발치의 `이 날에 새 일정` — 이 날짜가 기본값으로 들어간다. */
  onNew: (iso: string) => void;
}) {
  const p = partsOf(iso);
  const list = entriesOn(entries, iso);
  const title = p ? `${p.m}월 ${p.d}일` : iso;
  const sub = `${holiday ? `${holiday.name} · ` : ''}일정 ${list.length}개`;

  return (
    <Modal
      open
      onClose={onClose}
      label={`${title} 일정`}
      dim={{ zIndex: 210, background: 'rgba(46,42,38,.3)', backdropFilter: 'blur(3px)', padding: 32, boxSizing: 'border-box' }}
      cardAttrs={{ 'data-day-list': iso }}
      card={{
        width: 400,
        maxWidth: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 18,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border-soft)',
        boxShadow: '0 44px 84px -34px rgba(46,42,38,.55)',
        overflow: 'hidden',
        animation: 'mf-fade .18s ease',
      }}
    >
      {/* 머리 — 제목(날짜) + 부제(공휴일 · 일정 N개) + ✕. */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 17px', borderBottom: '1px solid var(--mf-border-soft)' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-.025em', color: 'var(--mf-text)' }}>{title}</span>
          <span data-day-list-sub style={{ fontSize: 11, color: 'var(--mf-faint)' }}>{sub}</span>
        </span>
        <button type="button" title="닫기" aria-label="닫기" className="mf-ctl" onClick={onClose} style={{ width: 28, height: 28, flex: '0 0 auto', border: 0, borderRadius: 9, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/* 목록 — 색 바 + 제목/부제 + 태그 알약(원본 `dayListItems`). */}
      <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((e) => {
          const chip = entryChip(e, surface);
          const tag = tagOf(e);
          return (
            <button
              key={`${e.docId}-${e.cardId}`}
              type="button"
              data-day-list-item={e.cardId}
              className="mf-ctl"
              onClick={() => onPickEntry(e)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', border: 0, borderRadius: 12, background: 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0 }}
            >
              <span aria-hidden style={{ width: 4, height: 26, flex: '0 0 auto', borderRadius: 999, background: chip.dot, display: 'block' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '제목 없음'}</span>
                <span style={{ fontSize: 10.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subOf(e, iso)}</span>
              </span>
              <span style={{ flex: '0 0 auto', height: 19, padding: '0 8px', borderRadius: 999, background: mixHex(surface.card, tag.hue, 0.14), color: tagInk(tag.hue, surface.text), fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{tag.label}</span>
            </button>
          );
        })}
        {list.length === 0 && <span style={{ padding: '16px 12px', fontSize: 12, color: 'var(--mf-faint)' }}>이 날에는 일정이 없어요</span>}
      </div>

      {/* 발치 — 이 날짜로 새 일정(점선 버튼, 원본 `dayListNew`). */}
      <div style={{ flex: '0 0 auto', padding: '11px 12px 13px', borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-panel2)' }}>
        <button
          type="button"
          data-day-list-new
          className="mf-ctl"
          onClick={() => onNew(iso)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', height: 38, borderRadius: 12, border: '1px dashed var(--mf-accent-mute)', background: 'var(--mf-card)', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxSizing: 'border-box' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          이 날에 새 일정
        </button>
      </div>
    </Modal>
  );
}

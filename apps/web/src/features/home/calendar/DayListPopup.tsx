// 그 날의 일정 전부 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `dayListOpen`을
// **툴팁 리스트**로(요청 — 첨부 시안). 처음 이식은 막(dim)을 깔고 가운데 띄웠는데,
// 흘깃 보는 목록이라 화면을 어둡히지 않고 **누른 칸 곁에** 뜨는 편이 맞다.
//
// 날짜 칸 더블클릭·`+N개 더`가 연다. 칸은 좁아 두 줄이면 접히는데, 이 팝업은 기간
// 일정(그 날을 지나는 바)까지 전부 한 목록으로 늘어놓는다. 항목을 고르면 그 상세
// 팝업으로 이어지고, 발치의 `이 날에 새 일정`이 그 날짜로 새 일정을 연다.
//
// 왼쪽 색 바는 **그 항목의 색**이다 — 달력 칸의 칩과 같은 값(`entryChip().base`).
// 처음 이식은 시안대로 출처 hue 넷(구글 파랑 · Geurio 코랄 · 칸반 초록) 중 하나를
// 썼는데, 그러면 칸에서 분류색으로 보던 일정이 팝업에서 초록 바로 바뀌어 **같은
// 일정으로 읽히지 않았다**(제보). 출처는 둘째 줄이 글로 말한다.
//
// 오른쪽 점은 **뜻이 있을 때만** 그린다(제보: 무엇을 뜻하는지 알 수 없다) — 칸반
// 카드의 **열(상태) 색**이다. 구글 일정에서는 그 점이 왼쪽 바와 같은 색이고 Geurio
// 일정에는 열이 없어(고정 팔레트 색이 우연히 붙는다) 아무 뜻이 없었다.

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarEntry, HolidayInfo } from './entries';
import { entryChip, type ChipSurface } from './chips';
import { dayProgress, entriesOn, isSpan, minutesOf, partsOf, timeLabel } from './model';

/** 행의 둘째 줄 — 원본의 `v.sub`: 기간은 `8.24–8.30 · 3/7일째`, 나머지는 출처. */
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

const W = 360;
const PAD = 12;

export function DayListPopup({
  iso,
  at,
  entries,
  holiday,
  surface,
  onClose,
  onPickEntry,
  onNew,
  onWorkLocation,
  workLocation,
}: {
  iso: string;
  /** 더블클릭한 지점(화면 좌표) — 툴팁이 이 곁에 선다. */
  at: { x: number; y: number };
  entries: readonly CalendarEntry[];
  holiday?: HolidayInfo;
  surface: ChipSurface;
  onClose: () => void;
  /** 행을 골랐다 — 팝업을 닫고 그 항목의 상세를 연다(호출부가 잇는다). */
  onPickEntry: (e: CalendarEntry) => void;
  /** 발치의 `이 날에 새 일정` — 이 날짜가 기본값으로 들어간다. */
  onNew: (iso: string) => void;
  /**
   * 근무 위치(요청) — 구글에 쓸 수 있을 때만 호출부가 넘긴다. 우클릭 메뉴와 **같은
   * 팝업**을 열지만 이쪽이 눈에 보이는 길이다(우클릭은 알아야 쓰는 조작이다).
   */
  onWorkLocation?: (iso: string) => void;
  /** 그 날에 걸린 근무 위치 — 있으면 버튼이 그 값을 말한다. */
  workLocation?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 자리 잡기 — 높이는 내용이 정하므로 **실측**해 화면 안으로 당긴다(아래가 모자라면
  // 지점 위로 뒤집는다). 페인트 전에 재므로 틀린 자리가 화면에 나가지 않는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(PAD, Math.min(at.x - 48, vw - W - PAD));
    let top = at.y + 10;
    if (top + h + PAD > vh) top = at.y - h - 10;
    setPos({ left, top: Math.max(PAD, Math.min(top, Math.max(PAD, vh - h - PAD))) });
  }, [at.x, at.y, iso]);

  // 바깥을 누르거나 Escape면 닫힌다 — 막이 없는 툴팁이라 스스로 듣는다.
  useLayoutEffect(() => {
    const down = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).closest?.('[data-day-list]')) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const p = partsOf(iso);
  const list = entriesOn(entries, iso);
  const title = p ? `${p.m}월 ${p.d}일` : iso;
  const sub = `${holiday ? `${holiday.name} · ` : ''}일정 ${list.length}개`;

  return createPortal(
    <div
      ref={ref}
      data-day-list={iso}
      role="dialog"
      aria-label={`${title} 일정`}
      style={{
        position: 'fixed',
        left: pos?.left ?? at.x,
        top: pos?.top ?? at.y,
        // 첫 커밋(실측 전)의 프레임이 화면에 나가지 않게 — 자리가 서면 보인다.
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 240,
        width: W,
        maxWidth: `calc(100vw - ${PAD * 2}px)`,
        maxHeight: `calc(100vh - ${PAD * 2}px)`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 18,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border-soft)',
        boxShadow: '0 24px 56px -22px rgba(46,42,38,.5), 0 3px 9px rgba(46,42,38,.08)',
        overflow: 'hidden',
        animation: 'mf-pop .16s ease',
      }}
    >
      {/* 머리 — 시안대로 날짜와 개수가 **한 줄**이다(`8월 26일  일정 5개` + ✕). */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'baseline', gap: 8, padding: '15px 17px 4px' }}>
        <span style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-.025em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{title}</span>
        <span data-day-list-sub style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
        <button type="button" title="닫기" aria-label="닫기" className="mf-ctl" onClick={onClose} style={{ width: 26, height: 26, flex: '0 0 auto', alignSelf: 'center', border: 0, borderRadius: 9, background: 'transparent', color: 'var(--mf-faint)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/* 목록 — [출처 색 바 | 제목/부제 | 상태 점](시안 — 태그 알약 대신 점). */}
      <div className="lnb-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((e) => {
          const chip = entryChip(e, surface);
          return (
            <button
              key={`${e.docId}-${e.cardId}`}
              type="button"
              data-day-list-item={e.cardId}
              className="mf-ctl"
              onClick={() => onPickEntry(e)}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', border: 0, borderRadius: 12, background: 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0 }}
            >
              <span aria-hidden style={{ width: 4, height: 30, flex: '0 0 auto', borderRadius: 999, background: chip.base, display: 'block' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '제목 없음'}</span>
                <span style={{ fontSize: 11, color: 'var(--mf-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subOf(e, iso)}</span>
              </span>
              {/* 칸반 카드만 — 그 카드가 있는 **열(상태)** 색이다(달력 칸의 시간 일정
                  표식과 같은 뜻). 다른 원천에는 열이 없어 점을 두지 않는다. */}
              {!e.google && !e.event ? (
                <span data-day-list-state title={`상태 · ${e.colName}`} style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: 999, background: chip.dot, display: 'block' }} />
              ) : null}
            </button>
          );
        })}
        {list.length === 0 && <span style={{ padding: '14px 12px 18px', fontSize: 12.5, color: 'var(--mf-faint)' }}>이 날에는 일정이 없어요</span>}
      </div>

      {/* 발치 — 시안대로 점선 상자가 아니라 **한 줄 글 버튼**(구분선 위). */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--mf-border-soft)' }}>
        <button
          type="button"
          data-day-list-new
          className="mf-ctl"
          onClick={() => onNew(iso)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', padding: '13px 17px 15px', border: 0, background: 'transparent', color: 'var(--mf-accent-strong)', font: 'inherit', fontSize: 13.5, fontWeight: 800, letterSpacing: '-.015em', cursor: 'pointer', textAlign: 'left' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          이 날에 새 일정
        </button>
        {onWorkLocation && (
          <button
            type="button"
            data-day-list-work
            className="mf-ctl"
            onClick={() => onWorkLocation(iso)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', padding: '11px 17px 14px', border: 0, borderTop: '1px solid var(--mf-border-soft)', background: 'transparent', color: 'var(--mf-subtext)', font: 'inherit', fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', cursor: 'pointer', textAlign: 'left' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 10.5 12 4l9 6.5" />
              <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
            </svg>
            {workLocation ? `근무 위치 · ${workLocation}` : '근무 위치 설정'}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

import { describe, expect, it } from 'vitest';
import { entryChip } from './chips';
import type { CalendarEntry } from './entries';

// 시간표 블록·날짜별 행의 면(tint) — 디자인 시안의 두 값(제보: 우리 것은 너무 진했다).
// 라이트 카드(#FFFDFB) 기준: Geurio·칸반 rgb(247,243,238)은 시안 그대로, 구글은
// rgb(241,245,251) — 시안(252)과 파랑 1/255 차이(육안 구분 불가, chips.ts 주석).
// 값을 표로 옮기면 다크에서 죽으므로 카드 면에서 파생하는 계약이다.

const SURFACE = { card: '#FFFDFB', text: '#332820' };

const E = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  docId: 'd1', cardId: 'k1', title: '카드', due: '2026-08-20', colId: 'c1', colName: '할 일', colIndex: 0, tag: '', boardName: 'B', spaceName: 'S', ...over,
});

const GOOGLE: CalendarEntry['google'] = { id: 'g1', calendarId: 'cal', calendarName: '내 캘린더', title: '구글', startDate: '2026-08-20', endDate: '2026-08-20', allDay: true, eventId: 'e1' };

const rgb = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
  return `rgb(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)})`;
};

describe('일정 칩 면 색(tint)', () => {
  it('Geurio·칸반 항목은 따뜻한 중립 rgb(247,243,238)', () => {
    expect(rgb(entryChip(E(), SURFACE).tint)).toBe('rgb(247,243,238)');
  });

  it('구글 일정은 옅은 파랑 rgb(241,245,251)', () => {
    expect(rgb(entryChip(E({ google: GOOGLE }), SURFACE).tint)).toBe('rgb(241,245,251)');
  });

  it('다크 면에서는 그 면에서 파생한다 — 라이트 값이 그대로 박혀 나오지 않는다', () => {
    const dark = entryChip(E(), { card: '#262019', text: '#f2e9df' });
    expect(dark.tint).not.toBe(entryChip(E(), SURFACE).tint);
  });
});

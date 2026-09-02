import { describe, expect, it } from 'vitest';
import { entryChip, markStyle } from './chips';
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

describe('표식 — 우리 일정은 점, 구글은 둥근 막대(요청)', () => {
  // 요청 ⑤ — 구글에서 그 일정에 지정한 색을 그대로 쓴다. 예전에는 출처를 색으로
  // 말하려고 구글 파랑을 강제했는데, 그러면 사용자가 고른 색이 화면에서 사라진다.
  // **출처는 색이 아니라 막대 모양이 말한다**(우리 일정은 점).
  it('구글 일정은 그 일정의 색을 쓰고, 출처는 막대 모양이 말한다', () => {
    const chip = entryChip(E({ google: GOOGLE, colColor: '#00a000' }), SURFACE);
    expect(chip.mark).toBe('bar');
    expect(chip.dot).toBe('#00a000');
    const st = markStyle(chip);
    expect(st.width).toBe(3);
    expect(Number(st.height)).toBeGreaterThan(Number(st.width));
  });

  it('색이 없는 구글 일정은 구글 파랑으로 물러선다', () => {
    expect(entryChip(E({ google: GOOGLE }), SURFACE).dot).toBe('#4a78d0');
  });

  it('우리 일정은 그대로 점이다 — 열 색을 그대로 쓴다', () => {
    const chip = entryChip(E({ colColor: '#00a000' }), SURFACE);
    expect(chip.mark).toBe('dot');
    expect(chip.dot).toBe('#00a000');
    expect(markStyle(chip).width).toBe(markStyle(chip).height);
  });
});

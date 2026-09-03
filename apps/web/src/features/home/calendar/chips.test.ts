import { describe, expect, it } from 'vitest';
import { entryChip, markStyle } from './chips';
import { mixHex } from '../../editor/theme';
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

const channels = (hex: string): number[] => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
};

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

describe('채운 칩·기간 바의 면(제보 ④ — 너무 옅었다)', () => {
  it('지정한 색이 알아보게 진하다 — 카드 면보다 그 색 쪽에 가깝다', () => {
    // 제보: 구글에서 고른 색이 파스텔로만 보여 구별이 안 됐다. 면을 색 쪽으로 더
    // 끌어오되 솔리드로는 가지 않는다(잉크가 그 면 위에서 읽혀야 한다).
    const chip = entryChip(E({ google: GOOGLE, colColor: '#d50000' }), SURFACE);
    const [r, g, b] = channels(chip.bg);
    // 빨강 위 — 카드(255,253,251)에서 빨강(213,0,0) 쪽으로 1/3쯤 와 있다.
    expect(r).toBeLessThan(255);
    expect(g).toBeLessThan(200);
    expect(b).toBeLessThan(200);
    // 아직 면이지 색 그 자체는 아니다(잉크가 읽힐 여지를 남긴다).
    expect(g).toBeGreaterThan(120);
  });

  it('예전 값(0.16)보다 진하다 — 되돌리면 이 단정이 깨진다', () => {
    const chip = entryChip(E({ google: GOOGLE, colColor: '#d50000' }), SURFACE);
    const old = mixHex(SURFACE.card, '#d50000', 0.16);
    expect(channels(chip.bg)[1]).toBeLessThan(channels(old)[1]!);
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

  it('Geurio 일정에 지정한 색은 칩의 정체성 색이 된다(요청 ⑤)', () => {
    // 고른 색이 달력에 보이지 않으면 색 고르기가 죽은 UI가 된다.
    const ev = { id: 'e1', title: '회의', startDate: '2026-08-20', endDate: '2026-08-20', allDay: true, source: 'geurio' } as const;
    const chip = entryChip(E({ event: ev, colColor: '#8a6bd1' }), SURFACE);
    expect(chip.base).toBe('#8a6bd1');
    expect(chip.dot).toBe('#8a6bd1');
    // 지정이 없으면 예전처럼 분류색에서 결정적으로 뽑는다(무회귀).
    expect(entryChip(E({ event: ev }), SURFACE).base).not.toBe('#8a6bd1');
  });

  it('칸반 카드의 열 색은 정체성이 아니다 — 분류색 그대로다(무회귀)', () => {
    const card = entryChip(E({ colColor: '#00a000' }), SURFACE);
    expect(card.base).not.toBe('#00a000');
    expect(card.dot).toBe('#00a000');
  });

  it('우리 일정은 그대로 점이다 — 열 색을 그대로 쓴다', () => {
    const chip = entryChip(E({ colColor: '#00a000' }), SURFACE);
    expect(chip.mark).toBe('dot');
    expect(chip.dot).toBe('#00a000');
    expect(markStyle(chip).width).toBe(markStyle(chip).height);
  });
});

describe('구글 일정의 글자색(요청 ⑥)', () => {
  it('구글 일정은 제목이 언제나 본문 색이다 — 색으로 말하는 것은 표식 하나면 된다', () => {
    const g = entryChip(E({ google: GOOGLE, colColor: '#f6bf26' }), SURFACE);
    expect(g.fg).toBe(SURFACE.text);
    // 표식(아이콘)은 그대로 그 일정의 색이다
    expect(g.dot).toBe('#f6bf26');
  });

  it('우리 일정·카드는 예전처럼 분류색에서 뽑은 잉크를 쓴다(무회귀)', () => {
    const ours = entryChip(E({ tag: '개발' }), SURFACE);
    expect(ours.fg).not.toBe(SURFACE.text);
  });
});

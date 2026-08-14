import { describe, expect, it } from 'vitest';
import type { KanbanCard, KanbanColumn } from '@mindflow/mindmap-core';
import { boardProgress, cardMatches, columnColor, dueLabel, dueTone, initialOf, ownerLabel, tagColor } from './kanbanMeta';

const PAL = ['#a', '#b', '#c', '#d', '#e'];
const col = (id: string, color?: string): KanbanColumn => ({ id, title: id, ...(color ? { color } : {}) });
const card = (id: string, c: string, extra: Partial<KanbanCard> = {}): KanbanCard => ({ id, col: c, pos: 0, text: id, ...extra });

describe('칸반 곁정보 — 색', () => {
  it('같은 분류 이름은 언제나 같은 색, 기본 다섯은 팔레트 순서대로', () => {
    expect(tagColor('기획', PAL)).toBe('#a');
    expect(tagColor('디자인', PAL)).toBe('#b');
    expect(tagColor('QA', PAL)).toBe('#e');
    expect(tagColor('내가 만든 분류', PAL)).toBe(tagColor('내가 만든 분류', PAL));
    // 색을 저장하지 않으므로 테마를 바꾸면 함께 바뀐다.
    expect(tagColor('기획', ['#x', '#y'])).toBe('#x');
  });

  it('열 점 색은 지정이 있으면 그것, 없으면 순서대로', () => {
    expect(columnColor(col('c1', '#zzz'), 3, PAL)).toBe('#zzz');
    expect(columnColor(col('c1'), 0, PAL)).toBe('#a');
    expect(columnColor(col('c9'), 6, PAL)).toBe('#b'); // 팔레트를 돌아 다시 앞으로
  });
});

describe('칸반 곁정보 — 기한', () => {
  const today = new Date(2026, 7, 14, 9, 0, 0); // 2026-08-14

  it('가까운 날은 말로, 먼 날은 날짜로', () => {
    expect(dueLabel('2026-08-14', today)).toBe('오늘');
    expect(dueLabel('2026-08-15', today)).toBe('내일');
    expect(dueLabel('2026-08-13', today)).toBe('어제');
    expect(dueLabel('2026-08-20', today)).toBe('8월 20일');
    expect(dueLabel('2027-03-02', today)).toBe('2027년 3월 2일');
    expect(dueLabel('엉망', today)).toBe('엉망'); // 못 읽으면 그대로 보여 준다
  });

  it('급함 — 지남 / 오늘·내일 / 그 밖', () => {
    expect(dueTone('2026-08-13', today)).toBe('over');
    expect(dueTone('2026-08-14', today)).toBe('soon');
    expect(dueTone('2026-08-15', today)).toBe('soon');
    expect(dueTone('2026-08-16', today)).toBe('normal');
  });
});

describe('칸반 곁정보 — 담당', () => {
  it('한 글자와 표시 이름', () => {
    expect(initialOf('지수')).toBe('지');
    expect(initialOf('buddy@example.com')).toBe('B');
    expect(initialOf('')).toBe('?');
    expect(ownerLabel(card('a', 'c1', { owner: 'buddy@example.com' }))).toBe('buddy');
    expect(ownerLabel(card('a', 'c1', { owner: 'buddy@example.com', ownerName: '벗' }))).toBe('벗');
    expect(ownerLabel(card('a', 'c1'))).toBe('');
  });
});

describe('칸반 진행률', () => {
  const cols = [col('todo'), col('doing'), col('review'), col('done')];
  const cards = [card('1', 'todo'), card('2', 'todo'), card('3', 'doing'), card('4', 'review'), card('5', 'done'), card('6', 'done')];

  it('마지막 열이 완료, 가운데 열들이 진행', () => {
    const p = boardProgress(cols, cards);
    expect(p).toMatchObject({ total: 6, done: 2, doing: 2, donePct: 33, doingPct: 33 });
    expect(p.label).toBe('완료 2/6 · 진행 2');
  });

  it('열이 둘이면 진행 구간이 없고, 카드가 없으면 0%', () => {
    expect(boardProgress([col('a'), col('b')], [card('1', 'a'), card('2', 'b')])).toMatchObject({ done: 1, doing: 0, donePct: 50 });
    expect(boardProgress(cols, [])).toMatchObject({ total: 0, donePct: 0, doingPct: 0 });
  });
});

describe('칸반 검색', () => {
  it('본문·분류·담당 이름에 걸린다', () => {
    const c = card('1', 'todo', { text: '런치 페이지 카피', tag: '마케팅', ownerName: '지수' });
    expect(cardMatches(c, '카피')).toBe(true);
    expect(cardMatches(c, '마케팅')).toBe(true);
    expect(cardMatches(c, '지수')).toBe(true);
    expect(cardMatches(c, 'QA')).toBe(false);
    expect(cardMatches(c, '   ')).toBe(true); // 빈 질의는 전부 통과
  });
});

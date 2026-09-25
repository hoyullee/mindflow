import { describe, expect, it } from 'vitest';
import { CHIP_TAIL, insertChip } from './noteChipInsert';
import type { RichRun } from '@mindflow/mindmap-core';

describe('칩 끼우기 — `@질의`를 지우고 그 자리에', () => {
  it('평문 줄 한가운데에 날짜 칩이 **글자 사이로** 들어간다', () => {
    // "회의는 @27 입니다" → "회의는 [8월 27일 목] 입니다"
    const out = insertChip('회의는 @27 입니다', [], 4, 3, '8월 27일 목', { dt: '2026-08-27' });
    expect(out.text).toBe(`회의는 8월 27일 목${CHIP_TAIL} 입니다`);
    expect(out.runs.find((r) => r.dt)).toMatchObject({ t: '8월 27일 목', dt: '2026-08-27' });
    // 캐럿은 **공백 뒤**다 — 바로 이어 치면 칩 밖에서 시작한다.
    expect(out.caret).toBe(4 + 8 + 1);
    expect(out.text[out.caret - 1]).toBe(CHIP_TAIL);
  });

  it('**앞뒤의 서식이 살아남는다** — 굵은 글 사이에 끼워도 굵기가 풀리지 않는다', () => {
    const runs: RichRun[] = [{ t: '굵게 @가 뒤', b: true, c: null }];
    const out = insertChip('굵게 @가 뒤', runs, 3, 2, '@김서연', { m: 'a@b.com' });
    expect(out.runs[0]).toMatchObject({ t: '굵게 ', b: true });
    expect(out.runs.find((r) => r.m)).toMatchObject({ t: '@김서연', m: 'a@b.com' });
    expect(out.runs[out.runs.length - 1]).toMatchObject({ t: ' 뒤', b: true });
  });

  it('칩은 **한 런**이다 — 글자마다 쪼개지지 않는다', () => {
    const out = insertChip('@', [], 0, 1, '8월 27일 목', { dt: '2026-08-27' });
    expect(out.runs.filter((r) => r.dt)).toHaveLength(1);
  });

  it('서로 다른 칩은 **붙여 넣어도 합쳐지지 않는다**', () => {
    const a = insertChip('@', [], 0, 1, '오늘', { dt: '2026-08-25' });
    const b = insertChip(a.text + '@', a.runs, a.text.length, 1, '내일', { dt: '2026-08-26' });
    expect(b.runs.filter((r) => r.dt).map((r) => r.dt)).toEqual(['2026-08-25', '2026-08-26']);
  });

  it('줄 끝에서 열었으면 그냥 **뒤에 붙는다**', () => {
    const out = insertChip('메모 @', [], 3, 1, '오늘', { dt: '2026-08-25' });
    expect(out.text).toBe(`메모 오늘${CHIP_TAIL}`);
    expect(out.caret).toBe(out.text.length);
  });

  it('구간이 줄을 넘어가도 **잘라서** 안전하게 끼운다', () => {
    const out = insertChip('짧', [], 0, 99, '오늘', { dt: '2026-08-25' });
    expect(out.text).toBe(`오늘${CHIP_TAIL}`);
  });
});

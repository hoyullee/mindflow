// 공책 기록의 한 줄 요약·묶음·글자 비교·날짜 묶음(기록 패널 스펙 §2·§5).
import { describe, expect, it } from 'vitest';
import type { NoteBlock, NotePage } from '@mindflow/mindmap-core';
import { canMerge, clipDiff, dayLabel, describePageChange, diffChars, groupByDay, momentLabel, participantsOf, timeLabel, MERGE_WINDOW_MS } from './noteHistory';
import type { NoteHistoryEntry } from '../../adapters/ports';

const r = (t: string) => [{ t, b: false, c: null }];
const p = (id: string, t: string): NoteBlock => ({ id, kind: 'p', runs: r(t) });
const page = (blocks: NoteBlock[], title = '회의록'): NotePage => ({ id: 'pg', title, blocks });

describe('describePageChange — 한 줄 요약(동사로 끝, 대상은 작은따옴표)', () => {
  it('처음 보는 페이지는 「페이지 만듦」', () => {
    expect(describePageChange(null, page([]))?.summary).toBe('페이지 만듦');
  });

  it('문단 하나의 글을 고치면 문구 수정 + 전·후 글', () => {
    const a = page([p('b1', '오늘 결정한 것'), p('b2', '둘째')]);
    const b = page([p('b1', '오늘 정한 것'), p('b2', '둘째')]);
    const c = describePageChange(a, b)!;
    expect(c).toMatchObject({ kind: 'edit', summary: '본문 첫 문단 문구 수정', anchor: 'b1', diff: { before: '오늘 결정한 것', after: '오늘 정한 것' } });
    const d = describePageChange(page([p('b1', 'x'), p('b2', '둘째')]), page([p('b1', 'x'), p('b2', '둘째!')]))!;
    expect(d.summary).toBe('본문 2번째 문단 문구 수정');
  });

  it('소제목과 체크리스트를 더하면 `\'결정한 것\' 소제목과 체크리스트 3개 추가`', () => {
    const a = page([p('b1', '첫')]);
    const h: NoteBlock = { id: 'h', kind: 'h2', runs: r('결정한 것') };
    const ck: NoteBlock = { id: 'c', kind: 'ck', items: [{ id: 'i1', runs: r('가') }, { id: 'i2', runs: r('나') }, { id: 'i3', runs: r('다') }] };
    const c = describePageChange(a, page([p('b1', '첫'), h, ck]))!;
    expect(c).toMatchObject({ kind: 'insert', summary: "'결정한 것' 소제목과 체크리스트 3개 추가", anchor: 'h' });
  });

  it('체크리스트 완료 표시 · 표에 행 추가 · 지움 · 순서 · 이름', () => {
    const ck = (done: boolean): NoteBlock => ({ id: 'c', kind: 'ck', items: [{ id: 'i1', runs: r('가'), done }] });
    expect(describePageChange(page([ck(false)]), page([ck(true)]))).toMatchObject({ kind: 'checklist', summary: '체크리스트 1개 완료로 표시' });
    const tb = (rows: number): NoteBlock => ({ id: 't', kind: 'table', rows: Array.from({ length: rows }, (_, i) => [r(i ? `${i}` : '담당과 기한'), r('x')]) });
    expect(describePageChange(page([tb(2)]), page([tb(3)]))).toMatchObject({ kind: 'table', summary: "'담당과 기한' 표에 행 추가" });
    expect(describePageChange(page([p('a', '1'), p('b', '2')]), page([p('a', '1')]))).toMatchObject({ kind: 'delete', summary: '문단 1개 지움' });
    expect(describePageChange(page([p('a', '1'), p('b', '2')]), page([p('b', '2'), p('a', '1')]))).toMatchObject({ kind: 'move', summary: '블록 순서 바꿈' });
    expect(describePageChange(page([], '회의록'), page([], '주간 회의'))).toMatchObject({ kind: 'rename', summary: "페이지 이름을 '주간 회의'로 바꿈" });
    expect(describePageChange(page([], '회의록'), page([], '결정'))?.summary).toBe("페이지 이름을 '결정'으로 바꿈");
  });

  it('바뀐 것이 없으면 null', () => {
    expect(describePageChange(page([p('a', '1')]), page([p('a', '1')]))).toBeNull();
  });
});

describe('canMerge — 같은 사람이 같은 블록을 2분 안에', () => {
  const delta = (touched: string[]) => ({ kind: 'edit' as const, summary: '', diff: null, anchor: touched[0] ?? null, touched });
  const run = { actorId: 'me', lastAt: 1_000, anchor: 'b1', kind: 'edit' as const };
  it('같은 블록·창 안이면 합친다', () => expect(canMerge(run, 'me', 1_000 + MERGE_WINDOW_MS - 1, delta(['b1']))).toBe(true));
  it('다른 블록 · 다른 사람 · 창 밖 · 되돌리기는 새 항목', () => {
    expect(canMerge(run, 'me', 2_000, delta(['b2']))).toBe(false);
    expect(canMerge(run, 'you', 2_000, delta(['b1']))).toBe(false);
    expect(canMerge(run, 'me', 1_000 + MERGE_WINDOW_MS, delta(['b1']))).toBe(false);
    expect(canMerge({ ...run, kind: 'restore' }, 'me', 2_000, delta(['b1']))).toBe(false);
  });
});

describe('diffChars · clipDiff — 바뀐 글자만, 앞뒤 문맥 10자', () => {
  it('바뀐 말만 지움·추가로', () => {
    expect(diffChars('오늘 결정한 것', '오늘 정한 것')).toEqual([
      { op: 'eq', t: '오늘 ' },
      { op: 'del', t: '결' },
      { op: 'eq', t: '정한 것' },
    ]);
    const segs = diffChars('담당은 김서연', '담당은 이호열');
    expect(segs.filter((s) => s.op !== 'eq').map((s) => s.op + s.t)).toEqual(['del김서연', 'ins이호열']);
  });
  it('공백·개행은 하나로 본다', () => {
    expect(diffChars('가  나\n다', '가 나 다')).toEqual([{ op: 'eq', t: '가 나 다' }]);
  });
  it('앞뒤 같은 글이 길면 10자만 남기고, 바뀐 글이 200자를 넘으면 `외 N자`', () => {
    const { segs } = clipDiff(diffChars(`${'가'.repeat(30)}X${'나'.repeat(30)}`, `${'가'.repeat(30)}Y${'나'.repeat(30)}`));
    expect(segs[0]).toEqual({ op: 'eq', t: `…${'가'.repeat(10)}` });
    expect(segs[segs.length - 1]).toEqual({ op: 'eq', t: `${'나'.repeat(10)}…` });
    const long = clipDiff([{ op: 'ins', t: 'a'.repeat(250) }]);
    expect(long.more).toBe(50);
  });
});

describe('날짜·시각 라벨', () => {
  const now = new Date(2026, 8, 30, 15, 0).getTime();
  it('오늘 · 어제 · 9월 15일 (화) · 해가 다르면 연도', () => {
    expect(dayLabel(now - 3_600_000, now)).toBe('오늘');
    expect(dayLabel(new Date(2026, 8, 29, 23, 0).getTime(), now)).toBe('어제');
    expect(dayLabel(new Date(2026, 8, 15, 10, 0).getTime(), now)).toBe('9월 15일 (화)');
    expect(dayLabel(new Date(2025, 11, 3, 10, 0).getTime(), now)).toBe('2025년 12월 3일 (수)');
  });
  it('1분이 안 된 오늘 항목은 `방금`, 그 밖은 HH:mm', () => {
    expect(timeLabel(now - 20_000, now)).toBe('방금');
    expect(timeLabel(new Date(2026, 8, 30, 9, 5).getTime(), now)).toBe('09:05');
    expect(momentLabel(new Date(2026, 8, 15, 16, 20).getTime(), now)).toBe('9월 15일 16:20');
  });
  it('날짜별로 묶고, 편집한 사람은 최근 순 한 번씩', () => {
    const e = (id: string, at: number, actor: string): NoteHistoryEntry => ({ id, docId: 'd', pageId: 'pg', at, actor: { id: actor, name: actor, color: '#000' }, kind: 'edit', summary: '', snapshot: null });
    const list = [e('1', now - 1_000, 'a'), e('2', now - 2_000, 'b'), e('3', new Date(2026, 8, 29, 9).getTime(), 'a')];
    expect(groupByDay(list, now).map((g) => [g.label, g.entries.length])).toEqual([['오늘', 2], ['어제', 1]]);
    expect(participantsOf(list).map((a) => a.id)).toEqual(['a', 'b']);
  });
});

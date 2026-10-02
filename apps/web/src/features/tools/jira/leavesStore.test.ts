import { beforeEach, describe, expect, it } from 'vitest';
import { addLeave, deleteLeave, leaveInputError, overlapsLeave, refreshLeaves, resetLeavesForTest, updateLeave, useJiraLeaves } from './leavesStore';
import { renderHook, waitFor } from '@testing-library/react';

// 데모 모드(Supabase 없음) — 이 기기의 localStorage에 산다. 서버 쪽 규칙(RLS·트리거)은 0050가 같은 것을 막는다.
describe('담당자 휴가 저장소(데모)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLeavesForTest();
  });

  it('겹침 규칙 — 같은 날 오전 + 오후만 허용', () => {
    const list = [{ person: 'p', start: '2026-10-13', end: '2026-10-13', kind: 'am' as const }];
    expect(overlapsLeave(list, { person: 'p', start: '2026-10-13', end: '2026-10-13', kind: 'pm' })).toBe(false);
    expect(overlapsLeave(list, { person: 'p', start: '2026-10-13', end: '2026-10-13', kind: 'am' })).toBe(true);
    expect(overlapsLeave(list, { person: 'p', start: '2026-10-12', end: '2026-10-14', kind: 'full' })).toBe(true);
    expect(overlapsLeave(list, { person: 'q', start: '2026-10-13', end: '2026-10-13', kind: 'full' })).toBe(false);
  });

  it('입력 검사', () => {
    const base = { person: 'p', personName: 'P', note: '', kind: 'full' as const };
    expect(leaveInputError({ ...base, start: '', end: '' })).toBe('날짜를 골라 주세요');
    expect(leaveInputError({ ...base, start: '2026-10-14', end: '2026-10-13' })).toMatch('앞');
    expect(leaveInputError({ ...base, kind: 'am', start: '2026-10-13', end: '2026-10-14' })).toMatch('반차');
    expect(leaveInputError({ ...base, start: '2026-10-13', end: '2026-10-14' })).toBeNull();
  });

  it('샘플은 남의 것 — 고치거나 지울 수 없다 · 내가 넣은 것은 고치고 지운다', async () => {
    const { result } = renderHook(() => useJiraLeaves('demo'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.leaves.length).toBe(3);
    const seed = result.current.leaves[0]!;
    expect(seed.mine).toBe(false);
    expect((await deleteLeave(seed.id)).error).toMatch('등록한 사람만');
    expect(await updateLeave(seed.id, { ...seed, note: 'x' })).toMatch('등록한 사람만');

    const input = { person: 'demo-p1', personName: '이호율', start: '2030-01-07', end: '2030-01-08', kind: 'full' as const, note: ' 연차 ' };
    expect(await addLeave(input)).toBeNull();
    expect(await addLeave({ ...input, start: '2030-01-08', end: '2030-01-09' })).toBe('이미 등록된 휴가와 겹쳐요');
    await refreshLeaves();
    const mine = result.current.leaves.find((l) => l.person === 'demo-p1')!;
    expect([mine.mine, mine.note]).toEqual([true, '연차']);
    expect(await updateLeave(mine.id, { ...input, end: '2030-01-10' })).toBeNull();
    expect(result.current.leaves.find((l) => l.id === mine.id)?.end).toBe('2030-01-10');
    const del = await deleteLeave(mine.id);
    expect(del.error).toBeNull();
    expect(result.current.leaves.some((l) => l.id === mine.id)).toBe(false);
  });
});

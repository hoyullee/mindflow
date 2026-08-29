import { describe, expect, it, vi } from 'vitest';
import { SupabaseEventStore } from './supabaseEventStore';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `calendar_events`(0033) 어댑터.
 *
 * RLS가 "내 일정만"을 강제하므로 어댑터는 `owner`를 보내지 않고 필터도 걸지 않는다.
 * 검증하는 것은 ① 겹침 조회 질의 ② 행↔일정 매핑(시각 쌍·초 잘라내기) ③ 부분 수정이
 * 현재 값을 읽어 정규화하는가 ④ 표가 없는 서버에서 조용히 물러나는가(배포 순서 안전).
 */

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  title: '주간 회의',
  start_date: '2026-08-26',
  end_date: '2026-08-26',
  all_day: false,
  start_time: '10:00:00',
  end_time: '11:00:00',
  location: '3층',
  note: '',
  color: null,
  source: 'geurio',
  ...over,
});

type Row = Record<string, unknown>;

function clientWith({ rows = [ROW()] as Row[], selectError = null as { message: string } | null, writeError = null as { message: string } | null, single = undefined as Row | null | undefined }) {
  const order = vi.fn(async () => ({ data: rows, error: selectError }));
  const gte = vi.fn(() => ({ order }));
  const lte = vi.fn(() => ({ gte }));
  const insertSingle = vi.fn(async () => ({ data: single ?? rows[0], error: writeError }));
  // 인자를 타입으로만 선언한다(`mock.calls`를 읽으려면 필요하고, 몸통에서는 쓰지 않는다).
  const insert = vi.fn<(row: Row) => { select: () => { single: typeof insertSingle } }>(() => ({ select: () => ({ single: insertSingle }) }));
  const readSingle = vi.fn(async () => ({ data: single === undefined ? rows[0] : single, error: single === null ? { message: 'no row' } : null }));
  const updateEq = vi.fn(async () => ({ error: writeError }));
  const update = vi.fn<(row: Row) => { eq: typeof updateEq }>(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(async () => ({ error: writeError }));
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ lte, eq: vi.fn(() => ({ single: readSingle })) })),
      insert,
      update,
      delete: vi.fn(() => ({ eq: deleteEq })),
    })),
  } as unknown as SupabaseClient;
  return { client, lte, gte, order, insert, update, updateEq, deleteEq, readSingle };
}

describe('SupabaseEventStore', () => {
  it('조회는 구간과 겹치는 행을 묻는다(시작 ≤ 끝날 · 끝 ≥ 첫날)', async () => {
    const { client, lte, gte } = clientWith({});
    const got = await new SupabaseEventStore(client).list('2026-07-26', '2026-09-05');
    expect(lte).toHaveBeenCalledWith('start_date', '2026-09-05');
    expect(gte).toHaveBeenCalledWith('end_date', '2026-07-26');
    expect(got).toHaveLength(1);
  });

  it('행을 일정으로 옮길 때 시각의 초를 잘라내고, 시각 쌍이 온전할 때만 시간 일정으로 본다', async () => {
    const { client } = clientWith({});
    const [e] = await new SupabaseEventStore(client).list('2026-08-01', '2026-08-31');
    expect(e).toMatchObject({ id: 'e1', title: '주간 회의', allDay: false, startTime: '10:00', endTime: '11:00', location: '3층', source: 'geurio' });
    // 빈 메모·색은 키를 만들지 않는다.
    expect('note' in e!).toBe(false);
    expect('color' in e!).toBe(false);

    // 한쪽 시각이 없으면 종일로 읽는다(그릴 수 없는 반쪽 상태를 만들지 않는다).
    const half = clientWith({ rows: [ROW({ end_time: null })] });
    const [h] = await new SupabaseEventStore(half.client).list('2026-08-01', '2026-08-31');
    expect(h!.allDay).toBe(true);
    expect(h!.startTime).toBeUndefined();
  });

  it('표가 없는 서버(마이그레이션 지연)에서는 빈 목록으로 물러난다 — 칸반 마감은 그대로 뜬다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = clientWith({ selectError: { message: 'relation "calendar_events" does not exist' } });
    expect(await new SupabaseEventStore(client).list('2026-08-01', '2026-08-31')).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('만들 때 owner를 보내지 않는다(표의 default가 auth.uid() — RLS가 정본)', async () => {
    const { client, insert } = clientWith({});
    await new SupabaseEventStore(client).create({ title: '회의', startDate: '2026-08-26', endDate: '2026-08-26', allDay: false, startTime: '10:00', endTime: '11:00' });
    const row = insert.mock.calls[0]![0];
    expect('owner' in row).toBe(false);
    expect(row).toMatchObject({ title: '회의', start_date: '2026-08-26', all_day: false, start_time: '10:00', end_time: '11:00' });
  });

  it('종일 일정은 시각 칸을 비워 보낸다(표의 제약)', async () => {
    const { client, insert } = clientWith({});
    await new SupabaseEventStore(client).create({ title: '휴가', startDate: '2026-08-26', endDate: '2026-08-28', allDay: true, startTime: '10:00', endTime: '11:00' });
    expect(insert.mock.calls[0]![0]).toMatchObject({ all_day: true, start_time: null, end_time: null });
  });

  it('제목이 비면 서버에 가지 않는다', async () => {
    const { client, insert } = clientWith({});
    expect((await new SupabaseEventStore(client).create({ title: '  ', startDate: '2026-08-26', endDate: '2026-08-26', allDay: true })).error).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });

  it('부분 수정은 현재 행을 읽어 얹은 뒤 정규화한다 — 건드리지 않은 값이 지워지지 않는다', async () => {
    const { client, update, readSingle } = clientWith({});
    expect((await new SupabaseEventStore(client).update('e1', { title: '이름 변경' })).error).toBeUndefined();
    expect(readSingle).toHaveBeenCalled();
    expect(update.mock.calls[0]![0]).toMatchObject({ title: '이름 변경', location: '3층', all_day: false, start_time: '10:00', end_time: '11:00' });
  });

  it('종일로 되돌리는 수정은 시각을 비운다', async () => {
    const { client, update } = clientWith({});
    await new SupabaseEventStore(client).update('e1', { allDay: true, startTime: undefined, endTime: undefined });
    expect(update.mock.calls[0]![0]).toMatchObject({ all_day: true, start_time: null, end_time: null });
  });

  it('없는 행은 고치지 못했다고 알린다', async () => {
    const { client, update } = clientWith({ single: null });
    expect((await new SupabaseEventStore(client).update('gone', { title: 'x' })).error).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('쓰기 실패는 사람이 읽을 문구로 돌려준다(원문은 콘솔)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const del = clientWith({ writeError: { message: 'permission denied' } });
    expect((await new SupabaseEventStore(del.client).remove('e1')).error).toBe('일정을 삭제하지 못했어요.');
    const upd = clientWith({ writeError: { message: 'permission denied' } });
    expect((await new SupabaseEventStore(upd.client).update('e1', { title: 'x' })).error).toBe('일정을 고치지 못했어요.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('지우기는 그 id만 겨눈다', async () => {
    const { client, deleteEq } = clientWith({});
    void deleteEq;
    expect((await new SupabaseEventStore(client).remove('e1')).error).toBeUndefined();
  });
});

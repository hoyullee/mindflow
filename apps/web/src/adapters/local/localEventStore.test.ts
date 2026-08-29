import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalEventStore, normalizeEventInput } from './localEventStore';
import type { CalendarEvent } from '../ports';

/**
 * 로컬/데모 모드의 Geurio 일정 — 서버가 없으니 localStorage(`mf_events`)에 쌓는다.
 *
 * Supabase 어댑터와 **같은 계약**을 지키는 것이 요점이다: 겹침 조회, 그리고 저장 전
 * 정규화(표 0033의 제약과 같은 규칙 — 날짜 순서·시각 쌍). 정규화는 두 어댑터가
 * 같은 함수를 쓰므로 여기서 검증하면 양쪽이 함께 지켜진다.
 */

const IN = (over: Record<string, unknown> = {}) => ({ title: '회의', startDate: '2026-08-26', endDate: '2026-08-26', allDay: true, ...over }) as Parameters<LocalEventStore['create']>[0];

describe('normalizeEventInput — 표(0033)의 제약을 클라이언트에서도 지킨다', () => {
  it('종료일이 시작일보다 앞서면 시작일로 당긴다', () => {
    expect(normalizeEventInput(IN({ startDate: '2026-08-26', endDate: '2026-08-20' })).endDate).toBe('2026-08-26');
  });

  it('시각은 둘 다 있을 때만 남는다 — 하나만 있으면 종일로 되돌린다', () => {
    const half = normalizeEventInput(IN({ allDay: false, startTime: '10:00' }));
    expect(half.allDay).toBe(true);
    expect(half.startTime).toBeUndefined();
    const both = normalizeEventInput(IN({ allDay: false, startTime: '10:00', endTime: '11:00' }));
    expect(both).toMatchObject({ allDay: false, startTime: '10:00', endTime: '11:00' });
  });

  it('종일이면 시각을 싣지 않는다', () => {
    const v = normalizeEventInput(IN({ allDay: true, startTime: '10:00', endTime: '11:00' }));
    expect(v.startTime).toBeUndefined();
    expect(v.endTime).toBeUndefined();
  });

  it('빈 위치·메모·색은 키를 만들지 않는다(빈 필드가 오가지 않게)', () => {
    const v = normalizeEventInput(IN({ location: '', note: '', color: '' }));
    expect('location' in v).toBe(false);
    expect('note' in v).toBe(false);
    expect('color' in v).toBe(false);
  });

  it('제목·위치·메모는 상한을 넘기지 않는다', () => {
    const v = normalizeEventInput(IN({ title: 'a'.repeat(400), location: 'b'.repeat(400), note: 'c'.repeat(5000) }));
    expect(v.title.length).toBe(200);
    expect(v.location!.length).toBe(200);
    expect(v.note!.length).toBe(2000);
  });
});

describe('LocalEventStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('만들면 id와 source가 붙고 그 구간 조회에 들어온다', async () => {
    const store = new LocalEventStore();
    const { event, error } = await store.create(IN({ title: '주간 회의' }));
    expect(error).toBeUndefined();
    expect(event).toMatchObject({ title: '주간 회의', source: 'geurio', allDay: true });
    expect(event!.id).toBeTruthy();
    expect(await store.list('2026-08-01', '2026-08-31')).toHaveLength(1);
  });

  it('제목이 비면 만들지 않는다', async () => {
    const store = new LocalEventStore();
    expect((await store.create(IN({ title: '   ' }))).error).toBeTruthy();
    expect(await store.list('2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('조회는 **구간과 겹치는** 일정을 준다 — 걸쳐 있으면 들어온다', async () => {
    const store = new LocalEventStore();
    await store.create(IN({ title: '이전 달', startDate: '2026-07-10', endDate: '2026-07-12' }));
    await store.create(IN({ title: '걸친 일정', startDate: '2026-07-30', endDate: '2026-08-03' }));
    await store.create(IN({ title: '이번 달', startDate: '2026-08-20', endDate: '2026-08-20' }));
    const got = await store.list('2026-08-01', '2026-08-31');
    expect(got.map((e) => e.title)).toEqual(['걸친 일정', '이번 달']);
  });

  it('고치면 부분 수정도 표의 제약을 지킨다 — 종일로 되돌리면 시각이 사라진다', async () => {
    const store = new LocalEventStore();
    const { event } = await store.create(IN({ allDay: false, startTime: '10:00', endTime: '11:00' }));
    expect((await store.update(event!.id, { allDay: true, startTime: undefined, endTime: undefined })).error).toBeUndefined();
    const [after] = await store.list('2026-08-01', '2026-08-31');
    expect(after).toMatchObject({ allDay: true });
    expect(after!.startTime).toBeUndefined();
    // id·source는 고쳐도 그대로다(정본 식별자).
    expect(after!.id).toBe(event!.id);
    expect(after!.source).toBe('geurio');
  });

  it('건드리지 않은 필드는 남는다(부분 수정)', async () => {
    const store = new LocalEventStore();
    const { event } = await store.create(IN({ location: '3층 회의실', note: '자료 준비' }));
    await store.update(event!.id, { title: '이름 변경' });
    const [after] = await store.list('2026-08-01', '2026-08-31');
    expect(after).toMatchObject({ title: '이름 변경', location: '3층 회의실', note: '자료 준비' });
  });

  it('없는 일정은 고치지 못했다고 알린다', async () => {
    expect((await new LocalEventStore().update('nope', { title: 'x' })).error).toBeTruthy();
  });

  it('지우면 목록에서 빠진다', async () => {
    const store = new LocalEventStore();
    const { event } = await store.create(IN());
    expect((await store.remove(event!.id)).error).toBeUndefined();
    expect(await store.list('2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('손상된 저장소여도 던지지 않는다(빈 목록으로 물러난다)', async () => {
    localStorage.setItem('mf_events', '{broken');
    expect(await new LocalEventStore().list('2026-01-01', '2026-12-31')).toEqual([]);
    // 깨진 항목이 섞여 있어도 온전한 것만 읽는다.
    localStorage.setItem('mf_events', JSON.stringify([{ id: 'a' }, { id: 'b', startDate: '2026-08-26', endDate: '2026-08-26' } as CalendarEvent]));
    expect((await new LocalEventStore().list('2026-08-01', '2026-08-31')).map((e) => e.id)).toEqual(['b']);
  });
});

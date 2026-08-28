// Geurio 일정 — `calendar_events` 테이블 위의 `EventStore`
// (`supabase/migrations/0033_calendar_events.sql`).
//
// RLS가 "내 일정만"을 강제하므로(owner = auth.uid()) 여기서는 필터를 걸지 않는다 —
// `owner`도 보내지 않는다(표의 default가 `auth.uid()`). 테이블 미적용 서버에서는
// 조용히 빈 목록/오류 문구로 물러난다(배포 순서 안전 — 일정 화면의 칸반 마감은 그대로).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarEvent, CalendarEventInput, EventStore } from '../ports';
import { normalizeEventInput } from '../local/localEventStore';

interface Row {
  id: string;
  title: string | null;
  start_date: string;
  end_date: string;
  all_day: boolean | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  note: string | null;
  color: string | null;
  source: string | null;
}

function toEvent(r: Row): CalendarEvent {
  const timed = r.all_day === false && !!r.start_time && !!r.end_time;
  return {
    id: r.id,
    title: r.title ?? '',
    startDate: r.start_date,
    endDate: r.end_date,
    allDay: !timed,
    ...(timed ? { startTime: (r.start_time as string).slice(0, 5), endTime: (r.end_time as string).slice(0, 5) } : {}),
    ...(r.location ? { location: r.location } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(r.color ? { color: r.color } : {}),
    source: r.source === 'google' ? 'google' : 'geurio',
  };
}

function toRow(v: CalendarEventInput): Record<string, unknown> {
  return {
    title: v.title,
    start_date: v.startDate,
    end_date: v.endDate,
    all_day: v.allDay,
    start_time: v.allDay ? null : (v.startTime ?? null),
    end_time: v.allDay ? null : (v.endTime ?? null),
    location: v.location ?? '',
    note: v.note ?? '',
    color: v.color ?? null,
  };
}

export class SupabaseEventStore implements EventStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    // 겹침 조회 — 월 격자가 6주라 구간이 달 경계를 넘는다.
    const { data, error } = await this.client.from('calendar_events').select('*').lte('start_date', toIso).gte('end_date', fromIso).order('start_date', { ascending: true });
    if (error) {
      console.warn('[geurio] calendar_events 조회 실패(마이그레이션 0033 확인)', error.message);
      return [];
    }
    return ((data ?? []) as Row[]).map(toEvent);
  }

  async create(input: CalendarEventInput): Promise<{ event?: CalendarEvent; error?: string }> {
    const v = normalizeEventInput(input);
    if (!v.title.trim()) return { error: '제목을 입력해 주세요.' };
    const { data, error } = await this.client.from('calendar_events').insert(toRow(v)).select('*').single();
    if (error) {
      console.warn('[geurio] 일정 저장 실패', error.message);
      return { error: '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    return { event: toEvent(data as Row) };
  }

  async update(id: string, patch: Partial<CalendarEventInput>): Promise<{ error?: string }> {
    // 부분 수정도 표의 제약(시각 쌍·날짜 순서)을 지켜야 하므로 현재 값에 얹어 정규화한다.
    const { data: cur, error: readErr } = await this.client.from('calendar_events').select('*').eq('id', id).single();
    if (readErr || !cur) return { error: '일정을 찾을 수 없어요.' };
    const merged = normalizeEventInput({ ...toEvent(cur as Row), ...patch });
    const { error } = await this.client.from('calendar_events').update(toRow(merged)).eq('id', id);
    if (error) {
      console.warn('[geurio] 일정 수정 실패', error.message);
      return { error: '일정을 고치지 못했어요.' };
    }
    return {};
  }

  async remove(id: string): Promise<{ error?: string }> {
    const { error } = await this.client.from('calendar_events').delete().eq('id', id);
    if (error) {
      console.warn('[geurio] 일정 삭제 실패', error.message);
      return { error: '일정을 삭제하지 못했어요.' };
    }
    return {};
  }
}

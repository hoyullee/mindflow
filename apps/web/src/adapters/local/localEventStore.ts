// 로컬/데모 모드의 `EventStore` — 서버가 없으니 이 브라우저에 쌓는다.
//
// Supabase 어댑터와 **같은 계약**을 지킨다(구간 겹침 조회·필드 정규화) — 모드에 따라
// 화면이 달라지지 않아야 하고, 데모에서도 일정을 만들어 볼 수 있어야 한다.

import type { CalendarEvent, CalendarEventInput, EventStore } from '../ports';

const KEY = 'mf_events';
const MAX = 500;

function readAll(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is CalendarEvent => {
      const o = e as Partial<CalendarEvent> | null;
      return !!o && typeof o.id === 'string' && typeof o.startDate === 'string' && typeof o.endDate === 'string';
    });
  } catch {
    return [];
  }
}

function writeAll(list: CalendarEvent[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    return true;
  } catch {
    return false;
  }
}

/** 저장 전 정규화 — 표의 제약(0033)과 같은 규칙을 클라이언트에서도 지킨다. */
export function normalizeEventInput(input: CalendarEventInput): CalendarEventInput {
  const startDate = input.startDate;
  const endDate = input.endDate < startDate ? startDate : input.endDate;
  const allDay = input.allDay !== false;
  // 시각은 **둘 다 있거나 둘 다 없다**(하나만 있으면 그릴 수 없다).
  const timed = !allDay && !!input.startTime && !!input.endTime;
  return {
    title: (input.title ?? '').slice(0, 200),
    startDate,
    endDate,
    allDay: !timed,
    ...(timed ? { startTime: input.startTime, endTime: input.endTime } : {}),
    ...(input.location ? { location: input.location.slice(0, 200) } : {}),
    ...(input.note ? { note: input.note.slice(0, 2000) } : {}),
    ...(input.color ? { color: input.color } : {}),
  };
}

export class LocalEventStore implements EventStore {
  async list(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    // 겹침: 시작이 구간 끝보다 앞이고, 끝이 구간 시작보다 뒤.
    return readAll()
      .filter((e) => e.startDate <= toIso && e.endDate >= fromIso)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : 1));
  }

  async create(input: CalendarEventInput): Promise<{ event?: CalendarEvent; error?: string }> {
    const v = normalizeEventInput(input);
    if (!v.title.trim()) return { error: '제목을 입력해 주세요.' };
    const event: CalendarEvent = { id: `ev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, source: 'geurio', ...v };
    if (!writeAll([...readAll(), event])) return { error: '저장에 실패했어요.' };
    return { event };
  }

  async update(id: string, patch: Partial<CalendarEventInput>): Promise<{ error?: string }> {
    const list = readAll();
    const cur = list.find((e) => e.id === id);
    if (!cur) return { error: '일정을 찾을 수 없어요.' };
    const merged = normalizeEventInput({ ...cur, ...patch });
    const next = list.map((e) => (e.id === id ? { id: e.id, source: e.source, ...merged } : e));
    if (!writeAll(next)) return { error: '저장에 실패했어요.' };
    return {};
  }

  async remove(id: string): Promise<{ error?: string }> {
    if (!writeAll(readAll().filter((e) => e.id !== id))) return { error: '삭제에 실패했어요.' };
    return {};
  }
}

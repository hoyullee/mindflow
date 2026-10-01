// 로컬/데모 모드의 `NoteHistoryStore` — 서버가 없으니 이 브라우저에 쌓는다.
//
// Supabase 어댑터(0048)와 **같은 계약**을 지킨다: 최신 먼저 · `before`/`limit`/`hasMore` ·
// 되돌리기도 새 항목(지우는 API가 없다) · 30일 밖은 하루 1개. 모드에 따라 기록 패널이
// 달라지지 않아야 하고, 데모에서도 기록을 써 볼 수 있어야 한다.
//
// 문서 한 권 = 키 하나(`mindflow_nhist_<docId>`, 모든 페이지 항목이 한 배열) — 문서를
// 지우면 이 키만 치우면 되고, 다른 문서의 기록과 쿼터를 다투지 않는다.
// 항목에 페이지 스냅샷이 실려 localStorage(대개 5MB)를 빨리 먹으므로 **크기 가드**를
// 둔다: 넘으면 가장 오래된 것부터 버린다. 저장소 실패는 던지지 않는다(기록이 없어도
// 편집은 계속되어야 한다) — 이 세션 동안만 메모리 목록으로 돈다.

import type { NoteHistoryDraft, NoteHistoryEntry, NoteHistoryStore } from '../ports';

const KEY_PREFIX = 'mindflow_nhist_';
/** 서버 보관 트리거(0048)와 같은 창. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** JSON 길이 상한(≈ 쿼터의 40%) — 넘으면 오래된 것부터 버린다. */
const MAX_CHARS = 2_000_000;
const DEFAULT_LIMIT = 100;

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `nh-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isEntry(e: unknown): e is NoteHistoryEntry {
  const o = e as Partial<NoteHistoryEntry> | null;
  return !!o && typeof o.id === 'string' && typeof o.pageId === 'string' && typeof o.at === 'number' && !!o.actor && typeof o.kind === 'string';
}

function readAll(docId: string): NoteHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + docId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return []; // 깨진 값·저장소를 막아 둔 환경 — 기록이 없는 것으로 본다
  }
}

/** 이 기기 시간대의 날짜 키 — 서버는 한국 날짜지만 로컬은 쓰는 사람의 하루가 맞다. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 30일 밖은 (페이지, 날) 마다 마지막 항목만 남긴다. 순서(오름차순)는 유지한다. */
export function pruneEntries(list: NoteHistoryEntry[], now: number): NoteHistoryEntry[] {
  const cutoff = now - KEEP_MS;
  const lastOfDay = new Map<string, NoteHistoryEntry>();
  for (const e of list) {
    if (e.at >= cutoff) continue;
    const k = `${e.pageId}|${dayKey(e.at)}`;
    const prev = lastOfDay.get(k);
    if (!prev || e.at >= prev.at) lastOfDay.set(k, e);
  }
  return list.filter((e) => e.at >= cutoff || lastOfDay.get(`${e.pageId}|${dayKey(e.at)}`) === e);
}

function writeAll(docId: string, list: NoteHistoryEntry[]): void {
  let rest = list;
  let json = JSON.stringify(rest);
  // 크기 가드 — 오래된 것부터 한 줌씩 버린다(통째 직렬화를 반복하지 않게 비율로).
  while (json.length > MAX_CHARS && rest.length > 1) {
    rest = rest.slice(Math.max(1, Math.ceil(rest.length * 0.1)));
    json = JSON.stringify(rest);
  }
  // 쿼터 초과면 절반씩 줄여 가며 몇 번 더 — 그래도 안 되면 포기(던지지 않는다).
  for (let i = 0; i < 6; i++) {
    try {
      localStorage.setItem(KEY_PREFIX + docId, json);
      return;
    } catch {
      if (rest.length <= 1) return;
      rest = rest.slice(Math.ceil(rest.length / 2));
      json = JSON.stringify(rest);
    }
  }
}

export class LocalNoteHistoryStore implements NoteHistoryStore {
  async list(docId: string, pageId: string, opts: { before?: number; limit?: number } = {}): Promise<{ entries: NoteHistoryEntry[]; hasMore: boolean }> {
    const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
    const before = opts.before;
    const mine = readAll(docId)
      .filter((e) => e.pageId === pageId && (before === undefined || e.at < before))
      .sort((a, b) => b.at - a.at);
    return { entries: mine.slice(0, limit), hasMore: mine.length > limit };
  }

  async append(draft: NoteHistoryDraft): Promise<NoteHistoryEntry> {
    const { at, ...rest } = draft;
    const entry: NoteHistoryEntry = { ...rest, id: newId(), at: at ?? Date.now(), diff: draft.diff ?? null, anchor: draft.anchor ?? null };
    // 저장 순서 = 오름차순(시각을 줄 수 있어 끝에 붙이고 정렬한다).
    const list = [...readAll(draft.docId), entry].sort((a, b) => a.at - b.at);
    writeAll(draft.docId, pruneEntries(list, Date.now()));
    return entry;
  }

  async update(id: string, patch: Parameters<NoteHistoryStore['update']>[1]): Promise<void> {
    // 항목 id만 안다 — 문서를 모르니 이 기기의 기록 키를 훑는다(키 수 = 열어 본 공책 수).
    let keys: string[] = [];
    try {
      keys = Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX));
    } catch {
      return;
    }
    for (const k of keys) {
      const docId = k.slice(KEY_PREFIX.length);
      const list = readAll(docId);
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) continue;
      const cur = list[i]!;
      const next: NoteHistoryEntry = { ...cur };
      if (patch.at !== undefined) next.at = patch.at;
      if (patch.kind !== undefined) next.kind = patch.kind;
      if (patch.summary !== undefined) next.summary = patch.summary;
      if (patch.diff !== undefined) next.diff = patch.diff;
      if (patch.anchor !== undefined) next.anchor = patch.anchor;
      if (patch.snapshot !== undefined) next.snapshot = patch.snapshot;
      list[i] = next;
      writeAll(docId, list.sort((a, b) => a.at - b.at));
      return;
    }
  }
}

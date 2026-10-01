import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNoteHistoryStore, pruneEntries } from './localNoteHistoryStore';
import type { NoteHistoryDraft, NoteHistoryEntry } from '../ports';

// 로컬/데모 모드 공책 기록 — 서버(0048)와 같은 계약: 최신 먼저 · before/limit/hasMore ·
// 30일 밖은 하루 1개 · 크기 가드 · 저장소 실패에 던지지 않음.

const DAY = 24 * 60 * 60 * 1000;
const actor = { id: 'me@x.com', name: '나', color: '#7C9BD8' };
const draft = (over: Partial<NoteHistoryDraft> = {}): NoteHistoryDraft => ({ docId: 'd1', pageId: 'p1', actor, kind: 'edit', summary: 's', snapshot: { blocks: [] }, ...over });
const KEY = 'mindflow_nhist_d1';

describe('LocalNoteHistoryStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('append는 id·시각을 채우고 mindflow_nhist_<docId>에 쌓는다', async () => {
    const store = new LocalNoteHistoryStore();
    const before = Date.now();
    const e = await store.append(draft());
    expect(e.id).toBeTruthy();
    expect(e.at).toBeGreaterThanOrEqual(before);
    expect(e.diff).toBeNull();
    expect(e.anchor).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('draft.at을 주면 그 시각을 쓴다', async () => {
    const e = await new LocalNoteHistoryStore().append(draft({ at: 1234567 }));
    expect(e.at).toBe(1234567);
  });

  it('list는 그 페이지만 최신 먼저', async () => {
    const store = new LocalNoteHistoryStore();
    const now = Date.now();
    await store.append(draft({ summary: 'old', at: now - 3000 }));
    await store.append(draft({ summary: 'new', at: now - 1000 }));
    await store.append(draft({ summary: 'other', pageId: 'p2', at: now - 2000 }));
    const { entries, hasMore } = await store.list('d1', 'p1');
    expect(entries.map((e) => e.summary)).toEqual(['new', 'old']);
    expect(hasMore).toBe(false);
  });

  it('문서끼리 섞이지 않는다', async () => {
    const store = new LocalNoteHistoryStore();
    await store.append(draft({ docId: 'd2' }));
    expect((await store.list('d1', 'p1')).entries).toHaveLength(0);
    expect((await store.list('d2', 'p1')).entries).toHaveLength(1);
  });

  it('limit·hasMore·before로 더 불러온다', async () => {
    const store = new LocalNoteHistoryStore();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await store.append(draft({ summary: `e${i}`, at: now - (5 - i) * 1000 }));
    const first = await store.list('d1', 'p1', { limit: 2 });
    expect(first.entries.map((e) => e.summary)).toEqual(['e4', 'e3']);
    expect(first.hasMore).toBe(true);
    const next = await store.list('d1', 'p1', { limit: 2, before: first.entries[1]!.at });
    expect(next.entries.map((e) => e.summary)).toEqual(['e2', 'e1']);
    expect(next.hasMore).toBe(true);
    const last = await store.list('d1', 'p1', { limit: 2, before: next.entries[1]!.at });
    expect(last.entries.map((e) => e.summary)).toEqual(['e0']);
    expect(last.hasMore).toBe(false);
  });

  it('update는 id로 찾아 준 필드만 고친다', async () => {
    const store = new LocalNoteHistoryStore();
    const e = await store.append(draft({ summary: 'a', anchor: 'b1' }));
    await store.update(e.id, { summary: 'b', diff: { before: 'x', after: 'y' } });
    const [got] = (await store.list('d1', 'p1')).entries;
    expect(got).toMatchObject({ id: e.id, summary: 'b', anchor: 'b1', diff: { before: 'x', after: 'y' } });
  });

  it('없는 id의 update는 조용히 지나간다', async () => {
    await expect(new LocalNoteHistoryStore().update('nope', { summary: 'x' })).resolves.toBeUndefined();
  });

  it('30일 밖은 (페이지, 날)마다 마지막 하나만 남는다 — 30일 안은 전부', async () => {
    const store = new LocalNoteHistoryStore();
    const now = Date.now();
    const noon = (daysAgo: number) => {
      const d = new Date(now - daysAgo * DAY);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    };
    await store.append(draft({ summary: 'o40-a', at: noon(40) }));
    await store.append(draft({ summary: 'o40-b', at: noon(40) + 3600_000 }));
    await store.append(draft({ summary: 'o35', at: noon(35) }));
    await store.append(draft({ summary: 'o40-other-page', pageId: 'p2', at: noon(40) }));
    await store.append(draft({ summary: 'r-a', at: now - 5 * DAY }));
    await store.append(draft({ summary: 'r-b', at: now - 5 * DAY + 1000 }));
    const p1 = (await store.list('d1', 'p1')).entries.map((e) => e.summary);
    expect(p1).toEqual(['r-b', 'r-a', 'o35', 'o40-b']);
    expect((await store.list('d1', 'p2')).entries.map((e) => e.summary)).toEqual(['o40-other-page']);
  });

  it('pruneEntries는 입력 순서를 보존한다', () => {
    const now = Date.now();
    const mk = (id: string, at: number): NoteHistoryEntry => ({ id, docId: 'd1', pageId: 'p1', at, actor, kind: 'edit', summary: id, snapshot: null });
    const out = pruneEntries([mk('a', now - 40 * DAY), mk('b', now - 40 * DAY + 1000), mk('c', now - DAY)], now);
    expect(out.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('크기가 상한을 넘으면 오래된 것부터 버린다(새 항목은 남는다)', async () => {
    const store = new LocalNoteHistoryStore();
    const big = 'x'.repeat(300_000);
    const now = Date.now();
    for (let i = 0; i < 10; i++) await store.append(draft({ summary: `e${i}`, snapshot: { big }, at: now - (10 - i) * 1000 }));
    expect(localStorage.getItem(KEY)!.length).toBeLessThanOrEqual(2_000_000);
    const { entries } = await store.list('d1', 'p1', { limit: 50 });
    expect(entries[0]!.summary).toBe('e9');
    expect(entries.length).toBeLessThan(10);
  });

  it('저장소가 던져도 append는 던지지 않고 항목을 돌려준다', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const e = await new LocalNoteHistoryStore().append(draft());
    expect(e.id).toBeTruthy();
  });

  it('깨진 JSON은 기록이 없는 것으로 본다', async () => {
    localStorage.setItem(KEY, '{nope');
    const store = new LocalNoteHistoryStore();
    expect((await store.list('d1', 'p1')).entries).toEqual([]);
    await store.append(draft());
    expect((await store.list('d1', 'p1')).entries).toHaveLength(1);
  });
});

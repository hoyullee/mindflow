// 저장마다 페이지별 항목을 남기고, 2분 안의 같은 블록 편집은 한 항목으로 묶는다(스펙 §2·§6.3).
import { describe, expect, it } from 'vitest';
import type { Doc, NoteBlock, NotePage } from '@mindflow/mindmap-core';
import type { NoteHistoryDraft, NoteHistoryEntry, NoteHistoryStore } from '../../adapters/ports';
import { NoteHistoryRecorder } from './noteHistoryRecorder';
import { MERGE_WINDOW_MS } from './noteHistory';

function memStore() {
  const rows: NoteHistoryEntry[] = [];
  let n = 0;
  const store: NoteHistoryStore = {
    async list(docId, pageId) {
      return { entries: rows.filter((r) => r.docId === docId && r.pageId === pageId).sort((a, b) => b.at - a.at), hasMore: false };
    },
    async append(d: NoteHistoryDraft) {
      const e = { ...d, id: `e${++n}`, at: d.at ?? 0 } as NoteHistoryEntry;
      rows.push(e);
      return e;
    },
    async update(id, patch) {
      const e = rows.find((r) => r.id === id);
      if (e) Object.assign(e, patch);
    },
  };
  return { store, rows };
}

const r = (t: string) => [{ t, b: false, c: null }];
const p = (id: string, t: string): NoteBlock => ({ id, kind: 'p', runs: r(t) });
const doc = (pages: NotePage[]): Doc => ({ v: 1, kind: 'note', nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral', pages }) as unknown as Doc;
const pg = (blocks: NoteBlock[], id = 'pg'): NotePage => ({ id, title: '회의록', blocks });

describe('NoteHistoryRecorder', () => {
  const actor = { id: 'u1', name: '나', color: '#e0663f' };

  it('같은 블록을 2분 안에 이어 고치면 **한 항목**이고, 요약은 처음 판 → 마지막 판', async () => {
    const { store, rows } = memStore();
    let now = 1_000_000;
    const rec = new NoteHistoryRecorder(store, 'd', () => actor, () => now);
    rec.seed(doc([pg([p('b1', '가나')])]));
    await rec.record(doc([pg([p('b1', '가나다')])]));
    now += 30_000;
    await rec.record(doc([pg([p('b1', '가나다라')])]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'edit', summary: '본문 첫 문단 문구 수정', diff: { before: '가나', after: '가나다라' }, at: now });

    // 창 밖 → 새 항목
    now += MERGE_WINDOW_MS + 1;
    await rec.record(doc([pg([p('b1', '가나다라마')])]));
    expect(rows).toHaveLength(2);
  });

  it('다른 블록으로 옮겨 가면 새 항목 · 새 페이지는 「페이지 만듦」 · 되돌리기는 restore', async () => {
    const { store, rows } = memStore();
    const rec = new NoteHistoryRecorder(store, 'd', () => actor, () => 5_000);
    rec.seed(doc([pg([p('b1', '가'), p('b2', '나')])]));
    await rec.record(doc([pg([p('b1', '가!'), p('b2', '나')])]));
    await rec.record(doc([pg([p('b1', '가!'), p('b2', '나!')])]));
    expect(rows.map((x) => x.summary)).toEqual(['본문 첫 문단 문구 수정', '본문 2번째 문단 문구 수정']);

    await rec.record(doc([pg([p('b1', '가!'), p('b2', '나!')]), pg([], 'pg2')]));
    expect(rows[2]).toMatchObject({ pageId: 'pg2', kind: 'create', summary: '페이지 만듦' });

    rec.expectRestore('pg', '9월 15일 16:20 시점으로 되돌림');
    await rec.record(doc([pg([p('b1', '가'), p('b2', '나')]), pg([], 'pg2')]));
    expect(rows[3]).toMatchObject({ kind: 'restore', summary: '9월 15일 16:20 시점으로 되돌림' });
    expect((rows[3]!.snapshot as NotePage).blocks.map((b) => b.runs?.[0]?.t)).toEqual(['가', '나']);
  });

  it('남이 저장한 판을 채택하면(seed) 그 변화는 내 이름으로 실리지 않는다', async () => {
    const { store, rows } = memStore();
    const rec = new NoteHistoryRecorder(store, 'd', () => actor, () => 1);
    rec.seed(doc([pg([p('b1', '가')])]));
    rec.seed(doc([pg([p('b1', '가 — 남이 고침')])])); // 서버 판 채택
    await rec.record(doc([pg([p('b1', '가 — 남이 고침')])]));
    expect(rows).toHaveLength(0);
  });

  it('저장소가 실패해도 던지지 않는다 — 본문 저장을 막지 않는다', async () => {
    const bad: NoteHistoryStore = { list: async () => ({ entries: [], hasMore: false }), append: async () => { throw new Error('x'); }, update: async () => { throw new Error('x'); } };
    const rec = new NoteHistoryRecorder(bad, 'd', () => actor, () => 1);
    rec.seed(doc([pg([p('b1', '가')])]));
    await expect(rec.record(doc([pg([p('b1', '나')])]))).resolves.toBeUndefined();
  });
});

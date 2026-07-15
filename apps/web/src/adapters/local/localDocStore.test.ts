import { beforeEach, describe, expect, it } from 'vitest';
import { ROOT_ID, type Doc } from '@mindflow/mindmap-core';
import { LocalDocStore } from './localDocStore';

function makeDoc(title: string): Doc {
  return {
    v: 1,
    nodes: {
      [ROOT_ID]: { id: ROOT_ID, text: title, emoji: '🎯', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
    },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('LocalDocStore', () => {
  it('round-trips save -> load -> list, and remove() soft-deletes', async () => {
    const store = new LocalDocStore();

    const saved = await store.save('doc1', makeDoc('내 첫 맵'));
    expect(saved).toEqual({ ok: true, version: 1 });

    const loaded = await store.load('doc1');
    expect(loaded).not.toBeNull();
    expect(loaded!.doc.nodes[ROOT_ID]!.text).toBe('내 첫 맵');
    expect(loaded!.version).toBe(1);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'doc1', title: '내 첫 맵', version: 1, deletedAt: null, isFavorite: false });

    await store.remove('doc1');
    const afterRemove = await store.list();
    expect(afterRemove[0]!.deletedAt).not.toBeNull();
    // soft delete: the doc itself is still loadable (trash can restore it)
    expect(await store.load('doc1')).not.toBeNull();

    await store.restore('doc1');
    const afterRestore = await store.list();
    expect(afterRestore[0]!.deletedAt).toBeNull();
  });

  it('increments version on every successful save', async () => {
    const store = new LocalDocStore();
    const v1 = await store.save('doc2', makeDoc('A'));
    expect(v1).toEqual({ ok: true, version: 1 });

    const v2 = await store.save('doc2', makeDoc('B'), { prevVersion: 1 });
    expect(v2).toEqual({ ok: true, version: 2 });

    const loaded = await store.load('doc2');
    expect(loaded!.version).toBe(2);
    expect(loaded!.doc.nodes[ROOT_ID]!.text).toBe('B');
  });

  it('rejects a save whose prevVersion is stale (optimistic lock)', async () => {
    const store = new LocalDocStore();
    await store.save('doc3', makeDoc('A')); // version 1

    // simulate another tab/device saving first
    const other = await store.save('doc3', makeDoc('A (다른 탭에서 수정)'), { prevVersion: 1 });
    expect(other).toEqual({ ok: true, version: 2 });

    // stale write, still believes it's at version 1
    const stale = await store.save('doc3', makeDoc('A (내 탭, 오래된 버전)'), { prevVersion: 1 });
    expect(stale).toEqual({ ok: false, reason: 'conflict', currentVersion: 2 });

    // the other tab's write must still be intact
    const loaded = await store.load('doc3');
    expect(loaded!.doc.nodes[ROOT_ID]!.text).toBe('A (다른 탭에서 수정)');
    expect(loaded!.version).toBe(2);
  });

  it('rename() and setFavorite() update list() metadata without touching the doc body', async () => {
    const store = new LocalDocStore();
    await store.save('doc4', makeDoc('원본 제목'));

    await store.rename('doc4', '새 제목');
    await store.setFavorite('doc4', true);

    const [meta] = await store.list();
    expect(meta).toMatchObject({ title: '새 제목', isFavorite: true });

    const loaded = await store.load('doc4');
    expect(loaded!.doc.nodes[ROOT_ID]!.text).toBe('원본 제목'); // doc body unchanged
  });

  it('load() returns null for an id that was never saved', async () => {
    const store = new LocalDocStore();
    expect(await store.load('nope')).toBeNull();
  });

  it('is compatible with docs written by legacy code (no meta entry yet)', async () => {
    localStorage.setItem('mindflow_doc_legacy', JSON.stringify(makeDoc('레거시 문서')));
    const store = new LocalDocStore();

    const loaded = await store.load('legacy');
    expect(loaded).toEqual({ doc: expect.objectContaining({ nodes: expect.any(Object) }), version: 1, title: '레거시 문서' });

    const listed = await store.list();
    expect(listed.find((m) => m.id === 'legacy')).toMatchObject({ title: '레거시 문서', version: 1 });
  });
});

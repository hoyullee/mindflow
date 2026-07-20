import { beforeEach, describe, expect, it } from 'vitest';
import { LocalSpaceStore } from './localSpaceStore';

beforeEach(() => {
  localStorage.clear();
});

describe('LocalSpaceStore', () => {
  it('round-trips spaces, mapFolders, and recent', async () => {
    const store = new LocalSpaceStore();
    await store.save({
      spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [] }],
      mapFolders: { '내 맵': 'f1' },
      recent: ['맵 3', '맵 1'],
    });

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.mapFolders).toEqual({ '내 맵': 'f1' });
    expect(loaded!.recent).toEqual(['맵 3', '맵 1']);
  });

  it('defaults recent to an empty array when saved without one, and stays undefined for legacy blobs', async () => {
    const store = new LocalSpaceStore();
    // legacy blob written before `recent` existed
    localStorage.setItem('mf_spaces', JSON.stringify({ v: 1, spaces: [{ id: 'general', name: '일반 공간' }], mapFolders: {} }));
    const legacy = await store.load();
    expect(legacy!.recent).toBeUndefined();

    await store.save({ spaces: legacy!.spaces, mapFolders: legacy!.mapFolders });
    const reloaded = await store.load();
    expect(reloaded!.recent).toEqual([]);
  });

  it('drops non-string recent entries on load', async () => {
    const store = new LocalSpaceStore();
    localStorage.setItem('mf_spaces', JSON.stringify({ v: 1, spaces: [{ id: 'g', name: 'x' }], mapFolders: {}, recent: ['맵 1', 42, null, '맵 2'] }));
    const loaded = await store.load();
    expect(loaded!.recent).toEqual(['맵 1', '맵 2']);
  });
});

import { describe, expect, it } from 'vitest';
import { deriveHomeView } from './viewModel';
import { initialHomeState } from './types';

describe('deriveHomeView — favorites', () => {
  it("gives each favorite an editor href with the map's real docId, even when it lives in a non-active space", () => {
    const state = initialHomeState();
    state.activeSpace = 'general';
    state.spaces = [
      { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [] },
      { id: 'work', name: '작업', color: '#3f8fd0', maps: [{ title: '중요한 맵', when: '내 맵', hue: '#3f8fd0', docId: 'new-xyz' }] },
    ];
    state.favs = { '중요한 맵': true };

    const view = deriveHomeView(state);
    expect(view.favItems).toHaveLength(1);
    const fav = view.favItems[0]!;
    expect(fav.title).toBe('중요한 맵');
    // href must carry the actual doc id, not the title-hash fallback
    expect(fav.href).toContain('map=new-xyz');
    expect(fav.href).toContain('title=');
  });

  it('excludes a trashed map from favorites (no dangling favorite row/href)', () => {
    const state = initialHomeState();
    state.spaces = [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '삭제된 맵', when: '내 맵', hue: '#f0663f', docId: 'm9' }] }];
    state.favs = { '삭제된 맵': true };
    state.deleted = { '삭제된 맵': true };

    const view = deriveHomeView(state);
    expect(view.favItems).toHaveLength(0);
  });
});

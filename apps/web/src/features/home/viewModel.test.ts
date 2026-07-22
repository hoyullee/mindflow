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
    // The real delete flow flags the title AND pushes a trash entry — hiding is
    // decided by the trashed DOC ID (titles don't interfere across trash/space).
    state.deleted = { '삭제된 맵': true };
    state.trash = [{ title: '삭제된 맵', source: 'local', docId: 'm9' }];

    const view = deriveHomeView(state);
    expect(view.favItems).toHaveLength(0);
  });

  it("does NOT hide a live favorite because a trashed doc shares its title", () => {
    const state = initialHomeState();
    // live '맵 A' (docId a2) + a DIFFERENT trashed doc that had the same title
    state.spaces = [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '맵 A', when: '내 맵', hue: '#f0663f', docId: 'a2' }] }];
    state.favs = { '맵 A': true };
    state.deleted = { '맵 A': true }; // stale title flag left by the trashed sibling
    state.trash = [{ title: '맵 A', source: 'local', docId: 'a1' }];

    const view = deriveHomeView(state);
    expect(view.favItems).toHaveLength(1); // the live map keeps its favorite row
    expect(view.allCards.some((c) => c.title === '맵 A' && c.docId === 'a2')).toBe(true); // and its grid card
  });
});

describe('deriveHomeView — recent (cross-space)', () => {
  function twoSpaceState() {
    const state = initialHomeState();
    state.loaded = true;
    state.activeSpace = 'general';
    state.spaces = [
      { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '일반맵', when: '내 맵', hue: '#f0663f', docId: 'g1' }] },
      { id: 'work', name: '작업', color: '#3f8fd0', maps: [{ title: '작업맵', when: '내 맵', hue: '#3f8fd0', docId: 'w1' }] },
    ];
    return state;
  }

  it('includes recent maps from EVERY space, not just the active one', () => {
    const state = twoSpaceState();
    // both recents open, one from each space; active space is 일반 공간
    state.recent = ['작업맵', '일반맵'];

    const view = deriveHomeView(state);
    const titles = view.recentCards.map((c) => c.title);
    expect(titles).toEqual(['작업맵', '일반맵']); // preserves recency order, spans spaces
    expect(view.recentSectionVisible).toBe(true);
    // the non-active-space recent still resolves its real docId for the href
    expect(view.recentCards.find((c) => c.title === '작업맵')!.href).toContain('map=w1');
  });

  it("tags each recent card with its owning space's color AND name (a11y: the dot alone is color-only info)", () => {
    const state = twoSpaceState();
    state.recent = ['작업맵', '일반맵'];
    const cards = deriveHomeView(state).recentCards;
    expect(cards.find((c) => c.title === '작업맵')!.spaceColor).toBe('#3f8fd0'); // 작업
    expect(cards.find((c) => c.title === '일반맵')!.spaceColor).toBe('#f0663f'); // 일반 공간
    expect(cards.find((c) => c.title === '작업맵')!.spaceName).toBe('작업');
    expect(cards.find((c) => c.title === '일반맵')!.spaceName).toBe('일반 공간');
  });

  it('hides the recent strip while searching (it lives above the search results)', () => {
    const state = twoSpaceState();
    state.recent = ['작업맵'];
    state.search = '작업';
    expect(deriveHomeView(state).recentSectionVisible).toBe(false);
  });

  it('keeps the recent tray visible INSIDE a folder (it is global, not a folder view)', () => {
    const state = twoSpaceState();
    state.recent = ['작업맵'];
    state.spaces[0]!.folders = [{ id: 'f1', name: '자료' }];
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    expect(view.backVisible).toBe(true); // sanity: we ARE inside the folder view
    expect(view.recentSectionVisible).toBe(true);
    // …and the cross-space entries still resolve while browsing the folder
    expect(view.recentCards.map((c) => c.title)).toEqual(['작업맵']);
  });

  it('keeps the recent tray visible inside a Drive folder too', () => {
    const state = twoSpaceState();
    state.recent = ['작업맵'];
    state.activeSpace = 'drive';
    state.drive = 'connected';
    state.driveFolders = [{ id: 'df1', name: '드라이브 자료' }];
    state.driveFolder = 'df1';
    const view = deriveHomeView(state);
    expect(view.backVisible).toBe(true);
    expect(view.recentSectionVisible).toBe(true);
  });

  it("a folder assignment binds ONE doc — a same-titled map in another space isn't captured", () => {
    // Interference repro (policy follow-up #1): both spaces hold a map titled
    // '중복 맵'. Assigning 일반 공간's copy (d1) to folder f1 must not pull 작업's
    // copy (d2) out of its top level — title-keyed mapFolders used to do that.
    const state = twoSpaceState();
    state.spaces[0]!.folders = [{ id: 'f1', name: '자료' }];
    state.spaces[0]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#f0663f', docId: 'd1' }];
    state.spaces[1]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#3f8fd0', docId: 'd2' }];
    state.mapFolders = { d1: 'f1' }; // docId-keyed assignment for 일반 공간's copy

    // 일반 공간 (active): its copy lives in the folder, not at the top level
    state.activeSpace = 'general';
    let view = deriveHomeView(state);
    expect(view.allCards.some((c) => c.title === '중복 맵')).toBe(false);
    expect(view.folderCards.find((f) => f.id === 'f1')!.count).toBe(1);

    // 작업 space: its same-titled copy stays at the TOP LEVEL, uncaptured
    state.activeSpace = 'work';
    view = deriveHomeView(state);
    expect(view.allCards.some((c) => c.title === '중복 맵' && c.docId === 'd2')).toBe(true);
  });

  it('drops trashed maps from the recent strip', () => {
    const state = twoSpaceState();
    state.recent = ['작업맵', '일반맵'];
    // real delete flow: title flag + trash entry (hiding keys off the docId)
    state.deleted = { '작업맵': true };
    state.trash = [{ title: '작업맵', source: 'local', docId: 'w1' }];
    expect(deriveHomeView(state).recentCards.map((c) => c.title)).toEqual(['일반맵']);
  });
});

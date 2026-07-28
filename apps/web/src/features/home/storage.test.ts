import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_CAP, cardKeyOf, loadRecent, mergeRecent, migrateMapFolderKeys, migrateRecentKeys, pushRecentEntry } from './storage';

describe('mapFolders docId keying', () => {
  const spaces = [
    {
      id: 'general',
      name: '일반 공간',
      home: true,
      color: '#f0663f',
      maps: [
        { title: '문서 맵', when: '내 맵', hue: '#f0663f', docId: 'd1' },
        { title: '워크스페이스 전용', when: '내 맵', hue: '#f0663f' }, // docId-less
      ],
    },
  ];

  it('cardKeyOf prefers the docId, falls back to the title', () => {
    expect(cardKeyOf('문서 맵', 'd1')).toBe('d1');
    expect(cardKeyOf('워크스페이스 전용', undefined)).toBe('워크스페이스 전용');
  });

  it('migrates legacy title keys onto docId keys, keeping docId-less entries by title', () => {
    const { mapFolders, changed } = migrateMapFolderKeys(spaces, { '문서 맵': 'f1', '워크스페이스 전용': 'f2' });
    expect(changed).toBe(true);
    expect(mapFolders).toEqual({ d1: 'f1', '워크스페이스 전용': 'f2' });
  });

  it('never clobbers an existing docId entry (newer truth wins over a stale title key)', () => {
    const { mapFolders } = migrateMapFolderKeys(spaces, { d1: 'f-new', '문서 맵': 'f-old' });
    expect(mapFolders['d1']).toBe('f-new');
    expect(mapFolders['문서 맵']).toBe('f-old'); // stale title key kept inert, not moved
  });

  it('is a no-op (same reference) when nothing needs migrating', () => {
    const input = { d1: 'f1' };
    const { mapFolders, changed } = migrateMapFolderKeys(spaces, input);
    expect(changed).toBe(false);
    expect(mapFolders).toBe(input);
  });

  // 제보 재현: 폴더 안에서 파일을 가져오면 그 카드는 docId가 없어 배정이 **제목 키**로
  // 저장된다. 그런데 다른 스페이스에 같은 제목의 doc 카드가 있으면 이 마이그레이션이
  // 제목 키를 그 카드의 docId로 옮겨 버려, 가져온 맵이 폴더에서 사라지고 스페이스
  // 최상위로 떨어졌다("처음엔 폴더에 있었는데 나중에 스페이스로 옮겨져 있다").
  it('같은 제목의 doc 카드가 있어도 docId 없는 카드의 제목 키는 빼앗지 않는다', () => {
    const twoSpaces = [
      {
        id: 'sa',
        name: '내 공간',
        home: true,
        color: '#f0663f',
        maps: [{ title: '가져온 맵', when: '방금 가져옴', hue: '#f0663f' }], // 가져온 카드 = docId 없음
        folders: [{ id: 'f1', name: '내폴더' }],
      },
      {
        id: 'sb',
        name: '다른 공간',
        color: '#3f8fd0',
        maps: [{ title: '가져온 맵', when: '내 맵', hue: '#f0663f', docId: 'other-doc' }], // 같은 제목, 다른 맵
      },
    ];
    const { mapFolders, changed } = migrateMapFolderKeys(twoSpaces, { '가져온 맵': 'f1' });
    expect(changed).toBe(false);
    expect(mapFolders).toEqual({ '가져온 맵': 'f1' }); // 배정은 가져온 카드에 그대로 남는다
    expect(mapFolders['other-doc']).toBeUndefined(); // 남의 맵으로 넘어가지 않는다
  });
});

describe('migrateRecentKeys', () => {
  const spaces = [
    {
      id: 'general',
      name: '일반 공간',
      home: true,
      color: '#f0663f',
      maps: [
        { title: '문서 맵', when: '내 맵', hue: '#f0663f', docId: 'd1' },
        { title: '워크스페이스 전용', when: '내 맵', hue: '#f0663f' }, // docId-less
      ],
    },
  ];

  it('moves legacy title entries onto docId keys, keeping order', () => {
    const { recent, changed } = migrateRecentKeys(spaces, ['문서 맵', '워크스페이스 전용']);
    expect(changed).toBe(true);
    expect(recent).toEqual(['d1', '워크스페이스 전용']);
  });

  it('collapses a docId entry and its legacy title alias into the most recent occurrence', () => {
    const { recent } = migrateRecentKeys(spaces, ['d1', '문서 맵', '기타']);
    expect(recent).toEqual(['d1', '기타']);
  });

  it('is a no-op (same reference) when entries are already keys', () => {
    const input = ['d1', '워크스페이스 전용'];
    const { recent, changed } = migrateRecentKeys(spaces, input);
    expect(changed).toBe(false);
    expect(recent).toBe(input);
  });

  // `migrateMapFolderKeys`와 같은 함정: 제목으로 해석되는 카드가 살아 있으면 그
  // 항목은 그 카드의 것이다. 옮기면 최근 항목이 **다른 맵**을 가리킨다.
  it('docId 없는 카드가 소유한 제목 항목은 다른 맵의 docId로 옮기지 않는다', () => {
    const twoSpaces = [
      { id: 'sa', name: '내 공간', home: true, color: '#f0663f', maps: [{ title: '가져온 맵', when: '방금 가져옴', hue: '#f0663f' }] },
      { id: 'sb', name: '다른 공간', color: '#3f8fd0', maps: [{ title: '가져온 맵', when: '내 맵', hue: '#f0663f', docId: 'other-doc' }] },
    ];
    const { recent, changed } = migrateRecentKeys(twoSpaces, ['가져온 맵']);
    expect(changed).toBe(false);
    expect(recent).toEqual(['가져온 맵']);
  });
});

describe('pushRecentEntry', () => {
  beforeEach(() => localStorage.clear());

  it('prepends the opened map to the persisted recent list (most-recent first)', () => {
    pushRecentEntry('맵 A');
    pushRecentEntry('맵 B');
    expect(loadRecent()).toEqual(['맵 B', '맵 A']);
  });

  it('de-duplicates: re-opening a map moves it to the front, no duplicate', () => {
    pushRecentEntry('맵 A');
    pushRecentEntry('맵 B');
    pushRecentEntry('맵 A');
    expect(loadRecent()).toEqual(['맵 A', '맵 B']);
  });

  it(`caps the stored history at ${RECENT_CAP}`, () => {
    for (let i = 0; i < RECENT_CAP + 5; i++) pushRecentEntry('맵 ' + i);
    const list = loadRecent();
    expect(list.length).toBe(RECENT_CAP);
    expect(list[0]).toBe('맵 ' + (RECENT_CAP + 4)); // newest first
  });

  it('ignores blank titles', () => {
    pushRecentEntry('맵 A');
    pushRecentEntry('   ');
    expect(loadRecent()).toEqual(['맵 A']);
  });
});

describe('mergeRecent', () => {
  it('keeps this-device recents first, then fills in synced history', () => {
    // local (primary) reflects what was just opened HERE; synced (secondary) is
    // the cross-device history from the backend workspace blob.
    expect(mergeRecent(['맵 A'], ['맵 A', '맵 B', '맵 C'])).toEqual(['맵 A', '맵 B', '맵 C']);
  });

  it('surfaces synced recents on a fresh device (empty local list)', () => {
    expect(mergeRecent([], ['맵 1', '맵 2'])).toEqual(['맵 1', '맵 2']);
  });

  it('de-duplicates by title (a map opened on both devices appears once)', () => {
    expect(mergeRecent(['맵 2', '맵 1'], ['맵 1', '맵 3'])).toEqual(['맵 2', '맵 1', '맵 3']);
  });

  it(`keeps both devices' full history under the retention cap (${RECENT_CAP})`, () => {
    // Retention is deliberately generous (display exposes far fewer — the tray
    // decides from the viewport) so cross-device history isn't truncated.
    const primary = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const secondary = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const merged = mergeRecent(primary, secondary);
    expect(merged.length).toBe(16); // nothing dropped below the cap
    expect(merged.slice(0, 8)).toEqual(primary); // primary (this device) keeps priority
    expect(merged[8]).toBe('s0');
  });

  it(`caps the merged list at RECENT_CAP (${RECENT_CAP}) when history exceeds it`, () => {
    const primary = Array.from({ length: RECENT_CAP }, (_, i) => `p${i}`);
    const secondary = ['overflow'];
    const merged = mergeRecent(primary, secondary);
    expect(merged.length).toBe(RECENT_CAP);
    expect(merged).not.toContain('overflow');
  });

  it('honours an explicit cap argument', () => {
    expect(mergeRecent(['a', 'b'], ['c', 'd', 'e', 'f'], 4)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates a missing synced list and non-string junk', () => {
    expect(mergeRecent(['맵 1'], undefined)).toEqual(['맵 1']);
    expect(mergeRecent(['맵 1', '', '맵 1'], ['맵 2'])).toEqual(['맵 1', '맵 2']);
  });
});

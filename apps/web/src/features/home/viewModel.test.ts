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
    state.favs = { 'new-xyz': true }; // favorites are keyed by cardKeyOf (docId)

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
    state.favs = { m9: true }; // docId-keyed favorite of the trashed doc
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
    state.favs = { a2: true }; // the LIVE map's docId-keyed star
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

  it('경로 표기: 폴더에 없는 맵은 스페이스명만, 툴팁은 제목까지 포함한 전체 경로', () => {
    const state = twoSpaceState();
    state.recent = ['작업맵'];
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.pathLabel).toBe('작업');
    expect(card.pathFull).toBe('작업 › 작업맵');
  });

  it('경로 표기: 폴더에 든 맵의 라벨은 폴더명만(스페이스는 색 점이 대신) — 툴팁엔 스페이스까지', () => {
    // 좁은 카드 폭을 변별력 있는 폴더명에 양보한다. 라벨에서 빠진 스페이스명은
    // pathFull(툴팁·스크린리더)에 항상 남아 정보가 사라지지 않는다.
    const state = twoSpaceState();
    state.recent = ['일반맵'];
    state.spaces[0]!.folders = [{ id: 'f1', name: '기획' }];
    state.mapFolders = { g1: 'f1' }; // docId-keyed assignment
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.pathLabel).toBe('기획');
    expect(card.pathFull).toBe('일반 공간 › 기획 › 일반맵');
  });

  it('경로 표기: 라벨이 폴더명이어도 스페이스 색 점은 그대로 유지된다', () => {
    const state = twoSpaceState();
    state.recent = ['일반맵'];
    state.spaces[0]!.folders = [{ id: 'f1', name: '기획' }];
    state.mapFolders = { g1: 'f1' };
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.spaceColor).toBe('#f0663f'); // 스페이스는 색으로 계속 구분된다
    expect(card.spaceName).toBe('일반 공간');
  });

  it('경로 표기: 폴더 id는 소유 스페이스에서만 찾는다(다른 스페이스의 동일 id에 오염 X)', () => {
    // 폴더 id는 스페이스별 스코프 — 작업맵(w1)이 f1에 배정돼 있어도 그 이름은
    // 작업 스페이스의 folders에서 찾아야 한다. 일반 공간에만 f1이 있으면 미해결.
    const state = twoSpaceState();
    state.recent = ['작업맵'];
    state.spaces[0]!.folders = [{ id: 'f1', name: '일반쪽 폴더' }]; // 일반 공간에만 존재
    state.mapFolders = { w1: 'f1' }; // 작업맵 배정
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.pathLabel).toBe('작업'); // 남의 스페이스 폴더명이 새어들지 않는다
    expect(card.pathFull).toBe('작업 › 작업맵');
  });

  it('경로 표기: 삭제된 폴더에 배정된 맵은 스페이스명만 남는다(빈 값/undefined 누수 없음)', () => {
    const state = twoSpaceState();
    state.recent = ['일반맵'];
    state.spaces[0]!.folders = []; // 폴더가 지워짐
    state.mapFolders = { g1: 'f-gone' }; // 배정만 남은 상태
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.pathLabel).toBe('일반 공간');
    expect(card.pathFull).toBe('일반 공간 › 일반맵');
  });

  it('경로 표기: 스페이스명이 비면 라벨·툴팁 모두 빈 문자열(카드는 줄 높이만 유지)', () => {
    const state = twoSpaceState();
    state.spaces[1]!.name = '   '; // 공백뿐인 이름
    state.recent = ['작업맵'];
    const card = deriveHomeView(state).recentCards[0]!;
    expect(card.pathLabel).toBe('');
    expect(card.pathFull).toBe(''); // 툴팁을 달지 않는다
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

  it('same-titled maps in different spaces keep INDEPENDENT recent entries (docId keys)', () => {
    // Policy follow-up #2: the recent list pins docs by ID, so opening both
    // '중복 맵's puts BOTH in the tray — each with its own space dot — instead
    // of the first-titled match swallowing the other.
    const state = twoSpaceState();
    state.spaces[0]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#f0663f', docId: 'd1' }];
    state.spaces[1]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#3f8fd0', docId: 'd2' }];
    state.recent = ['d2', 'd1'];

    const cards = deriveHomeView(state).recentCards;
    expect(cards).toHaveLength(2);
    expect(cards[0]!.docId).toBe('d2');
    expect(cards[0]!.spaceName).toBe('작업');
    expect(cards[1]!.docId).toBe('d1');
    expect(cards[1]!.spaceName).toBe('일반 공간');
    // hrefs open the EXACT doc, not the first title match
    expect(cards[0]!.href).toContain('map=d2');
    expect(cards[1]!.href).toContain('map=d1');
  });

  it('same-titled maps keep INDEPENDENT favorite stars (docId keys)', () => {
    const state = twoSpaceState();
    state.spaces[0]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#f0663f', docId: 'd1' }];
    state.spaces[1]!.maps = [{ title: '중복 맵', when: '내 맵', hue: '#3f8fd0', docId: 'd2' }];
    state.favs = { d2: true }; // only 작업's copy is starred

    const view = deriveHomeView(state);
    expect(view.favItems).toHaveLength(1);
    expect(view.favItems[0]!.docId).toBe('d2');
    expect(view.favItems[0]!.href).toContain('map=d2');
    // the grid card of the UNstarred copy stays unstarred
    state.activeSpace = 'general';
    expect(deriveHomeView(state).allCards.find((c) => c.docId === 'd1')!.isFav).toBe(false);
    state.activeSpace = 'work';
    expect(deriveHomeView(state).allCards.find((c) => c.docId === 'd2')!.isFav).toBe(true);
  });

  it('collapses a legacy title entry and its docId entry into one recent card', () => {
    const state = twoSpaceState();
    // '작업맵' (docId w1): a docId entry from the new editor + a legacy title
    // entry recorded by an older session — one card, not two.
    state.recent = ['w1', '작업맵'];
    const cards = deriveHomeView(state).recentCards;
    expect(cards.filter((c) => c.title === '작업맵')).toHaveLength(1);
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

// 제보 ①: 모바일 홈에서 폴더 안에 들어가면 파일을 가져올 방법이 없다. 폴더 안에서는
// 툴바의 `가져오기`가 사라져서, 폴더에 파일을 넣으려면 최상위로 나가 가져온 뒤
// 다시 그 폴더로 옮겨야 했다.
describe('deriveHomeView — 폴더 안에서의 가져오기/새 폴더', () => {
  function folderState() {
    const state = initialHomeState();
    state.loaded = true;
    state.activeSpace = 'general';
    state.spaces = [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [{ id: 'f1', name: '자료' }] }];
    return state;
  }

  it('폴더 안에서도 가져오기가 보인다', () => {
    const state = folderState();
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    expect(view.backVisible).toBe(true); // sanity: 폴더 안이다
    expect(view.importVisible).toBe(true);
  });

  it('최상위에서도 물론 보인다', () => {
    expect(deriveHomeView(folderState()).importVisible).toBe(true);
  });

  it('Drive 공간에서는 여전히 숨긴다(가져오기 대상이 로컬 스페이스뿐)', () => {
    const state = folderState();
    state.activeSpace = 'drive';
    state.drive = 'connected';
    expect(deriveHomeView(state).importVisible).toBe(false);
  });

  it('새 폴더는 폴더 안에서도 보인다(중첩 폴더) — 현재 폴더가 부모가 된다', () => {
    const state = folderState();
    state.curFolder = 'f1';
    expect(deriveHomeView(state).newFolderVisible).toBe(true);
    // 최상위에서도 물론 보인다
    state.curFolder = null;
    expect(deriveHomeView(state).newFolderVisible).toBe(true);
  });
});

// 신규 기능: 폴더 안에 폴더(중첩 폴더). parent 없는 기존 데이터는 전부 최상위(무회귀).
describe('deriveHomeView — 중첩 폴더', () => {
  function nestedState() {
    const state = initialHomeState();
    state.loaded = true;
    state.activeSpace = 'general';
    state.spaces = [
      {
        id: 'general',
        name: '일반 공간',
        home: true,
        color: '#f0663f',
        maps: [
          { title: '깊은 맵', when: '내 맵', hue: '#f0663f', docId: 'd-deep' },
          { title: '상위 맵', when: '내 맵', hue: '#f0663f', docId: 'd-top' },
          { title: '루트 맵', when: '내 맵', hue: '#f0663f', docId: 'd-root' },
        ],
        folders: [
          { id: 'f1', name: '자료' },
          { id: 'f2', name: '하위', parent: 'f1' },
          { id: 'f3', name: '다른최상위' },
        ],
      },
    ];
    state.mapFolders = { 'd-deep': 'f2', 'd-top': 'f1' };
    return state;
  }

  it('최상위에는 parent 없는 폴더만 보인다', () => {
    const view = deriveHomeView(nestedState());
    expect(view.folderCards.map((f) => f.id).sort()).toEqual(['f1', 'f3']);
    // 최상위 맵만 카드로 (폴더 배정된 맵은 안 보임)
    expect(view.allCards.map((c) => c.title)).toEqual(['루트 맵']);
  });

  it('폴더 안에서는 하위 폴더 + 그 폴더의 맵이 보인다', () => {
    const state = nestedState();
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    expect(view.folderCards.map((f) => f.id)).toEqual(['f2']);
    expect(view.allCards.map((c) => c.title)).toEqual(['상위 맵']);
    expect(view.folderEmpty).toBe(false);
  });

  it('하위 폴더 안에서는 그 폴더의 맵만 보인다', () => {
    const state = nestedState();
    state.curFolder = 'f2';
    const view = deriveHomeView(state);
    expect(view.folderCards).toEqual([]);
    expect(view.allCards.map((c) => c.title)).toEqual(['깊은 맵']);
  });

  it('폴더 타일의 맵 개수는 하위 폴더까지 재귀 집계된다', () => {
    const view = deriveHomeView(nestedState());
    expect(view.folderCards.find((f) => f.id === 'f1')!.count).toBe(2); // 상위 맵 + 깊은 맵
  });

  it('하위 폴더가 있는 폴더는 비어 보여도 삭제 불가(canDelete=false)', () => {
    const state = nestedState();
    state.mapFolders = { 'd-deep': 'f2' }; // f1 직접 소속 맵 없음
    const view = deriveHomeView(state);
    expect(view.folderCards.find((f) => f.id === 'f1')!.canDelete).toBe(false);
    expect(view.folderCards.find((f) => f.id === 'f3')!.canDelete).toBe(true);
  });

  it('브레드크럼: 하위 폴더 안에서는 상위 경로가 "스페이스 / 상위폴더"로 깊어진다', () => {
    const state = nestedState();
    state.curFolder = 'f2';
    const view = deriveHomeView(state);
    expect(view.titleParent).toBe('일반 공간 / 자료');
    expect(view.titleLeaf).toBe('하위');
    expect(view.spaceTitle).toBe('일반 공간 / 자료 / 하위');
  });

  it('이동 대상 폴더는 **현재 위치의 폴더만** — 최상위에서는 최상위, 폴더 안에서는 직속 하위(제보)', () => {
    // 최상위: 최상위 폴더 둘만(하위 f2는 안 나온다 — 예전엔 "자료 / 하위"까지
    // 전부 나와 목록이 길고 계층이 흐려졌다).
    const top = deriveHomeView(nestedState());
    expect(top.allCards[0]!.moveTargets.map((t) => t.name).sort()).toEqual(['다른최상위', '자료']);
    // 폴더 안: 그 폴더의 직속 하위만 — 화면의 폴더 카드와 같은 목록이다.
    const state = nestedState();
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    const targets = view.allCards[0]!.moveTargets;
    expect(targets.map((t) => t.name)).toEqual(['하위']);
    expect(targets.some((t) => t.id === 'f1')).toBe(false);
  });

  it('빈 하위 폴더만 있는 폴더 뷰: 빈 안내 대신 폴더 구획이 그려진다', () => {
    const state = nestedState();
    state.mapFolders = { 'd-deep': 'f2' };
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    expect(view.folderEmpty).toBe(false);
    expect(view.foldersSectionVisible).toBe(true);
  });
});

// 제보 ②: 이름이 긴 폴더에 들어가면 제목의 경로("스페이스 / 폴더")가 줄바꿈된다.
// 상위 경로는 `…`로 접고 현재 폴더명만 보여 준다(전체 경로는 spaceTitle에 남는다).
describe('deriveHomeView — 제목 경로 조각', () => {
  function state1() {
    const state = initialHomeState();
    state.loaded = true;
    state.activeSpace = 'general';
    state.spaces = [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [], folders: [{ id: 'f1', name: '아주 긴 이름의 폴더입니다' }] }];
    return state;
  }

  it('최상위: 상위 경로가 없고 조각은 스페이스명', () => {
    const view = deriveHomeView(state1());
    expect(view.titleParent).toBeNull();
    expect(view.titleLeaf).toBe('일반 공간');
    expect(view.spaceTitle).toBe('일반 공간');
  });

  it('폴더 안: 상위=스페이스명, 조각=폴더명, 전체 경로는 그대로 유지', () => {
    const state = state1();
    state.curFolder = 'f1';
    const view = deriveHomeView(state);
    expect(view.titleParent).toBe('일반 공간');
    expect(view.titleLeaf).toBe('아주 긴 이름의 폴더입니다');
    expect(view.spaceTitle).toBe('일반 공간 / 아주 긴 이름의 폴더입니다');
  });

  it('Drive 폴더도 같은 규칙', () => {
    const state = state1();
    state.activeSpace = 'drive';
    state.drive = 'connected';
    state.driveFolders = [{ id: 'df1', name: '드라이브 자료' }];
    state.driveFolder = 'df1';
    const view = deriveHomeView(state);
    expect(view.titleParent).toBe('Google Drive');
    expect(view.titleLeaf).toBe('드라이브 자료');
    expect(view.spaceTitle).toBe('Google Drive / 드라이브 자료');
  });
});

// 최근 트레이 프리페치 대상(제보: "간헐적으로 미리보기가 로딩인 채로 남는다") —
// 트레이가 실제로 그릴 카드와 같은 파이프라인으로 골라야 한다.
describe('recentTrayDocIds', () => {
  const spaces = [
    { id: 's1', name: '일반', home: true, color: '#f0663f', maps: [{ title: '주간 계획', when: '', hue: '#f0663f', docId: 'docA' }] },
    { id: 's2', name: '1212', color: '#3f8fd0', maps: [{ title: '주간 계획', when: '', hue: '#3f8fd0', docId: 'docB' }] },
  ];

  it('머리에 쌓인 사라진 문서·휴지통·별칭 항목이 보이는 카드를 밀어내지 못한다', async () => {
    const { recentTrayDocIds } = await import('./viewModel');
    // 원시 recent의 앞 40개가 전부 해석 불가(지워진 문서의 옛 키) — 예전 방식
    // (slice(0, 32))이라면 docB는 창 밖이라 프리페치에서 빠졌다.
    const stale = Array.from({ length: 40 }, (_, i) => `gone-${i}`);
    const ids = recentTrayDocIds(spaces, [...stale, 'docB', 'docA'], [], {});
    expect(ids).toEqual(['docB', 'docA']);
  });

  it('휴지통에 간 맵은 제외, 같은 문서의 별칭(제목 키)은 하나로 접힌다', async () => {
    const { recentTrayDocIds } = await import('./viewModel');
    const ids = recentTrayDocIds(spaces, ['docA', '주간 계획', 'docB'], [{ docId: 'docA' }], {});
    // docA는 휴지통 — 제외. '주간 계획'(제목 별칭)은 첫 스페이스 규칙으로 docA를
    // 가리키지만 그것도 휴지통이라 제외. docB만 남는다.
    expect(ids).toEqual(['docB']);
  });
});

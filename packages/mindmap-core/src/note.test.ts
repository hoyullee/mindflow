// 공책 코어 — 페이지·블록의 순수 규칙.
//
// 이 파일이 지키는 것 셋: **글을 잃지 않는다**(종류를 바꿀 때), **열 것이 없어지지
// 않는다**(마지막 페이지), **저장본이 갈리지 않는다**(서식 없는 글은 평문으로 접는다).

import { describe, expect, it } from 'vitest';
import {
  applyFill,
  blockText,
  emptyBlock,
  fillAt,
  shiftFills,
  moveBlock,
  movePage,
  newPage,
  NOTE_COVER_FALLBACK,
  noteBlockIsText,
  noteBlockShape,
  noteChecklistProgress,
  noteCoverColor,
  noteCoverSketch,
  noteHighlightColor,
  NOTE_TAG_COLORS,
  noteTagColor,
  noteUpdatedAt,
  normalizeRuns,
  pageExcerpt,
  pageText,
  removePage,
  retypeBlock,
  indentListItem,
  listMarkers,
  NOTE_LIST_MAX_INDENT,
  roundSizes,
  runsText,
  textRuns,
} from './note';
import type { NoteBlock } from './model';

describe('블록이 어느 칸을 쓰는가', () => {
  it('종류마다 한 답만 준다 — 렌더·검색·내보내기가 같은 자리를 본다', () => {
    expect(noteBlockShape('p')).toBe('runs');
    expect(noteBlockShape('h2')).toBe('runs');
    expect(noteBlockShape('q')).toBe('runs');
    expect(noteBlockShape('callout')).toBe('runs');
    expect(noteBlockShape('toggle')).toBe('runs');
    expect(noteBlockShape('code')).toBe('runs');
    expect(noteBlockShape('ul')).toBe('items');
    expect(noteBlockShape('ol')).toBe('items');
    expect(noteBlockShape('ck')).toBe('items');
    expect(noteBlockShape('table')).toBe('table');
    expect(noteBlockShape('link')).toBe('link');
    expect(noteBlockShape('img')).toBe('img');
    expect(noteBlockShape('hr')).toBe('empty');
  });

  it('글을 담는 종류만 캐럿을 받는다', () => {
    expect(noteBlockIsText('p')).toBe(true);
    expect(noteBlockIsText('ck')).toBe(true);
    expect(noteBlockIsText('table')).toBe(true);
    expect(noteBlockIsText('hr')).toBe(false);
    expect(noteBlockIsText('img')).toBe(false);
    expect(noteBlockIsText('link')).toBe(false);
  });
});

describe('빈 블록', () => {
  it('글을 담는 종류는 **캐럿 놓을 자리**를 들고 태어난다', () => {
    expect(emptyBlock('p').runs).toEqual([{ t: '', b: false, c: null }]);
    expect(emptyBlock('ul').items).toHaveLength(1);
    expect(emptyBlock('table').rows).toHaveLength(2);
  });

  it('글이 없는 종류는 빈 칸을 만들지 않는다', () => {
    const hr = emptyBlock('hr');
    expect(hr.runs).toBeUndefined();
    expect(hr.items).toBeUndefined();
  });

  it('id는 만들 때마다 갈린다(같은 밀리초에 여러 개를 만들어도)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => emptyBlock('p').id));
    expect(ids.size).toBe(50);
  });
});

describe('종류 바꾸기 — **글을 잃지 않는다**', () => {
  const para: NoteBlock = { id: 'b1', kind: 'p', runs: [{ t: '결정한 것', b: true, c: null }] };

  it('문단 → 제목은 서식까지 온전하다(같은 칸이다)', () => {
    const h = retypeBlock(para, 'h2');
    expect(h.kind).toBe('h2');
    expect(h.runs).toEqual([{ t: '결정한 것', b: true, c: null }]);
  });

  it('문단 → 목록은 글이 첫 항목으로 옮겨 간다', () => {
    const ul = retypeBlock(para, 'ul');
    expect(ul.items).toHaveLength(1);
    expect(runsText(ul.items![0]!.runs)).toBe('결정한 것');
  });

  it('목록 → 문단은 항목들이 한 문단으로 합쳐진다(버리지 않는다)', () => {
    const ck: NoteBlock = {
      id: 'b2',
      kind: 'ck',
      items: [
        { id: 'i1', runs: textRuns('첫째'), done: true },
        { id: 'i2', runs: textRuns('둘째') },
      ],
    };
    const p = retypeBlock(ck, 'p');
    expect(runsText(p.runs)).toBe('첫째\n둘째');
  });

  it('체크리스트로 바꾸면 켜짐 칸이 생기고, 나오면 사라진다', () => {
    const ck = retypeBlock({ id: 'b3', kind: 'ul', items: [{ id: 'i1', runs: textRuns('할 일') }] }, 'ck');
    expect(ck.items![0]).toHaveProperty('done', false);
    const back = retypeBlock({ ...ck, items: [{ id: 'i1', runs: textRuns('할 일'), done: true }] }, 'ul');
    expect(back.items![0]).not.toHaveProperty('done');
  });

  it('같은 종류로 바꾸면 **그 블록 그대로**다(헛된 새 객체를 만들지 않는다)', () => {
    expect(retypeBlock(para, 'p')).toBe(para);
  });

  it('id·정렬·들여쓰기는 종류가 바뀌어도 따라간다', () => {
    const styled: NoteBlock = { ...para, align: 'center', indent: 2 };
    const q = retypeBlock(styled, 'q');
    expect(q.id).toBe('b1');
    expect(q.align).toBe('center');
    expect(q.indent).toBe(2);
  });

  it('콜아웃·토글은 기본 어조·펼침을 들고 간다', () => {
    expect(retypeBlock(para, 'callout').tone).toBe('warn');
    expect(retypeBlock(para, 'toggle').open).toBe(true);
  });
});

describe('마지막 페이지는 지우지 못한다', () => {
  it('두 장이면 지워진다', () => {
    const pages = [newPage('가'), newPage('나')];
    const next = removePage(pages, pages[1]!.id);
    expect(next).toHaveLength(1);
  });

  it('**한 장이면 막는다** — 페이지가 없는 공책은 열 것이 없다', () => {
    const pages = [newPage('하나')];
    const next = removePage(pages, pages[0]!.id);
    // 같은 배열을 그대로 돌려주므로 호출부가 "막혔다"를 알 수 있다.
    expect(next).toBe(pages);
  });

  it('없는 id는 아무 일도 하지 않는다', () => {
    const pages = [newPage('가'), newPage('나')];
    expect(removePage(pages, 'nope')).toBe(pages);
  });
});

describe('순서 — 배열 순서가 곧 순서다', () => {
  it('페이지를 앞뒤로 옮긴다', () => {
    const [a, b, c] = [newPage('a'), newPage('b'), newPage('c')];
    const pages = [a, b, c];
    expect(movePage(pages, c.id, 0).map((p) => p.title)).toEqual(['c', 'a', 'b']);
    expect(movePage(pages, a.id, 2).map((p) => p.title)).toEqual(['b', 'c', 'a']);
  });

  it('범위를 넘겨도 끝으로 붙는다(던지지 않는다)', () => {
    const [a, b] = [newPage('a'), newPage('b')];
    expect(movePage([a, b], a.id, 99).map((p) => p.title)).toEqual(['b', 'a']);
    expect(movePage([a, b], b.id, -5).map((p) => p.title)).toEqual(['b', 'a']);
  });

  it('블록도 같은 규칙이다', () => {
    const b1 = emptyBlock('p');
    const b2 = emptyBlock('h2');
    expect(moveBlock([b1, b2], b2.id, 0).map((b) => b.kind)).toEqual(['h2', 'p']);
    expect(moveBlock([b1, b2], 'nope', 0).map((b) => b.kind)).toEqual(['p', 'h2']);
  });
});

describe('평문 뽑기 — 검색과 목록이 함께 쓴다', () => {
  it('종류마다 제 칸에서 글을 꺼낸다', () => {
    expect(blockText({ id: 'a', kind: 'p', runs: textRuns('문단') })).toBe('문단');
    expect(blockText({ id: 'b', kind: 'ul', items: [{ id: 'i', runs: textRuns('항목') }] })).toBe('항목');
    expect(blockText({ id: 'c', kind: 'table', rows: [[textRuns('머리'), textRuns('둘')]] })).toBe('머리\t둘');
  });

  it('글이 없는 종류는 빈 문자열이다 — 검색에 걸릴 말이 없다', () => {
    expect(blockText({ id: 'd', kind: 'hr' })).toBe('');
    expect(blockText({ id: 'e', kind: 'img', src: 'mfimg:x' })).toBe('');
    expect(blockText({ id: 'f', kind: 'link', docId: 'b1' })).toBe('');
  });

  it('페이지 본문은 블록을 줄로 잇고 **제목은 넣지 않는다**', () => {
    const page = newPage('제목', [
      { id: 'a', kind: 'p', runs: textRuns('첫 줄') },
      { id: 'b', kind: 'hr' },
      { id: 'c', kind: 'h2', runs: textRuns('소제목') },
    ]);
    expect(pageText(page)).toBe('첫 줄\n소제목');
  });

  it('카드의 첫 줄은 **글이 있는 첫 블록의 첫 줄**이다', () => {
    const page = newPage('제목', [
      { id: 'a', kind: 'hr' },
      { id: 'b', kind: 'p', runs: textRuns('') },
      { id: 'c', kind: 'ul', items: [{ id: 'i', runs: textRuns('보이는 줄') }, { id: 'j', runs: textRuns('둘째 줄') }] },
    ]);
    expect(pageExcerpt(page)).toBe('보이는 줄');
  });

  it('첫 줄이 길면 잘라 …를 붙인다', () => {
    const page = newPage('t', [{ id: 'a', kind: 'p', runs: textRuns('가'.repeat(200)) }]);
    const out = pageExcerpt(page, 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('서식 없는 글은 평문으로 접는다', () => {
  it('서식이 있으면 런을 그대로 둔다(빈 런만 걷어낸다)', () => {
    const runs = [{ t: '굵게', b: true, c: null }, { t: '', b: false, c: null }];
    expect(normalizeRuns(runs)).toEqual([{ t: '굵게', b: true, c: null }]);
  });

  it('서식이 없으면 한 런으로 합친다 — 저장본이 쪼개지지 않게', () => {
    expect(normalizeRuns([{ t: '가', b: false, c: null }, { t: '나', b: false, c: null }])).toEqual([
      { t: '가나', b: false, c: null },
    ]);
  });
});

describe('공책 요약', () => {
  it('마지막 수정 시각은 페이지 중 가장 최근이다', () => {
    const pages = [
      { ...newPage('a'), updatedAt: '2026-09-01T00:00:00.000Z' },
      { ...newPage('b'), updatedAt: '2026-09-16T00:00:00.000Z' },
      { ...newPage('c'), updatedAt: '2026-09-10T00:00:00.000Z' },
    ];
    expect(noteUpdatedAt(pages)).toBe('2026-09-16T00:00:00.000Z');
    expect(noteUpdatedAt([{ ...newPage('x'), updatedAt: undefined }])).toBe(null);
  });

  it('체크리스트 진행은 공책 전체를 센다(없으면 null)', () => {
    const pages = [
      newPage('a', [{ id: 'b1', kind: 'ck', items: [{ id: 'i1', runs: textRuns('a'), done: true }, { id: 'i2', runs: textRuns('b') }] }]),
      newPage('b', [{ id: 'b2', kind: 'ck', items: [{ id: 'i3', runs: textRuns('c'), done: true }] }]),
    ];
    expect(noteChecklistProgress(pages)).toEqual({ done: 2, total: 3 });
    expect(noteChecklistProgress([newPage('none')])).toBe(null);
  });
});

describe('표지 — 사용자 지정 > 태그 기본 > 기본값', () => {
  it('직접 고른 색이 이긴다', () => {
    expect(noteCoverColor({ tag: '회의록', color: '#2F7D57' })).toBe('#2F7D57');
  });

  it('없으면 태그가 정한다', () => {
    expect(noteCoverColor({ tag: '회의록' })).toBe('#8E5A80');
    expect(noteCoverSketch({ tag: '리서치' })).toBe('clip');
  });

  it('태그도 없으면 기본값이다', () => {
    expect(noteCoverColor(null)).toBe(NOTE_COVER_FALLBACK);
    expect(noteCoverColor({ tag: '' })).toBe(NOTE_COVER_FALLBACK);
    expect(noteCoverSketch(undefined)).toBe('grid');
  });

  it('직접 만든 태그도 **제 색**을 받는다 — 이름이 같으면 언제나 같은 색', () => {
    // 태그는 저장소가 따로 없는 그냥 글자다(사용자가 만들 수 있다). 예전에는 모르는
    // 이름을 전부 회색으로 칠해, 직접 만든 태그끼리 구분이 되지 않았다.
    const a = noteTagColor('스프린트');
    expect(a).not.toBe('#B0A69B');
    expect(noteTagColor('스프린트')).toBe(a); // 같은 이름 → 같은 색(기기가 달라도)
    expect(noteTagColor('디자인')).not.toBe(a); // 다른 이름 → 다른 색(대개)
    // 기본 여섯은 표에 박힌 값 그대로, 빈 값만 회색이다.
    expect(noteTagColor('회의록')).toBe('#C98BB4');
    expect(noteTagColor(null)).toBe('#B0A69B');
    expect(noteTagColor('  ')).toBe('#B0A69B');
  });

  it('**사람이 고른 색이 먼저다** — 기본 여섯도 덮어쓴다(요청)', () => {
    const picked = { 회의록: '#7C9BD8', 스프린트: '#E45DA0' };
    expect(noteTagColor('회의록', picked)).toBe('#7C9BD8');
    expect(noteTagColor('스프린트', picked)).toBe('#E45DA0');
    // 고르지 않은 이름은 지금까지 그대로(표 → 해시).
    expect(noteTagColor('정책', picked)).toBe('#7FA6E8');
    expect(noteTagColor('디자인', picked)).toBe(noteTagColor('디자인'));
    // 표가 없거나 그 이름이 없으면 아무 일도 없다.
    expect(noteTagColor('회의록', {})).toBe('#C98BB4');
    expect(noteTagColor('회의록', null)).toBe('#C98BB4');
  });

  it('고를 수 있는 색 여덟 — 해시 팔레트와 **같은 목록**이다', () => {
    expect(NOTE_TAG_COLORS).toHaveLength(8);
    // 이름을 고르지 않고 만든 태그의 색이 언제나 이 목록 안에 있어야, 고른 색과
    // 저절로 정해진 색이 한 계열로 보인다.
    const values = NOTE_TAG_COLORS.map(([c]) => c);
    for (const name of ['스프린트', '디자인', '릴리즈', '인터뷰', '가나다', 'abc']) {
      expect(values).toContain(noteTagColor(name));
    }
  });
});

describe('형광펜', () => {
  it('아는 키만 색이 된다 — 모르는 값은 칠하지 않는다', () => {
    expect(noteHighlightColor('yellow')).toBe('#FBEFC0');
    expect(noteHighlightColor('무지개')).toBe(null);
    expect(noteHighlightColor(null)).toBe(null);
  });
});

describe('표의 채움색 — 키 넷과 우선순위', () => {
  it('좁게 말한 것이 이긴다 — 칸 > 행 > 열 > 전체', () => {
    const fills = { all: '#ALL', k1: '#COL', r2: '#ROW', 'c2:1': '#CELL' };
    expect(fillAt(fills, 2, 1)).toBe('#CELL');
    expect(fillAt(fills, 2, 0)).toBe('#ROW');
    expect(fillAt(fills, 0, 1)).toBe('#COL');
    expect(fillAt(fills, 0, 0)).toBe('#ALL');
    expect(fillAt(undefined, 0, 0)).toBeUndefined();
  });

  it('옛 저장본의 접두사 없는 `"행:열"`도 칸으로 읽는다', () => {
    expect(fillAt({ '1:0': '#OLD' }, 1, 0)).toBe('#OLD');
    // 다음에 칠할 때 새 형식으로 옮겨 적는다 — 형식이 둘로 남지 않는다.
    expect(applyFill({ '1:0': '#OLD' }, { kind: 'cell', r: 0, c: 0 }, '#NEW')).toEqual({ 'c1:0': '#OLD', 'c0:0': '#NEW' });
  });

  it('행·열·전체는 **키 하나**로 남고, 그 아래의 좁은 키를 걷어 낸다', () => {
    expect(applyFill({ 'c1:0': '#a', 'c1:1': '#a' }, { kind: 'row', r: 1 }, '#b')).toEqual({ r1: '#b' });
    expect(applyFill({ 'c0:2': '#a', r0: '#c' }, { kind: 'col', c: 2 }, '#b')).toEqual({ k2: '#b' });
    expect(applyFill({ r0: '#a', k1: '#b', 'c2:2': '#c' }, { kind: 'all' }, '#d')).toEqual({ all: '#d' });
  });

  it('구간은 칸마다 적는다 — 뒤집힌 좌표도 같은 결과', () => {
    const a = applyFill(undefined, { kind: 'range', r0: 0, c0: 0, r1: 1, c1: 1 }, '#x');
    const b = applyFill(undefined, { kind: 'range', r0: 1, c0: 1, r1: 0, c1: 0 }, '#x');
    expect(a).toEqual({ 'c0:0': '#x', 'c0:1': '#x', 'c1:0': '#x', 'c1:1': '#x' });
    expect(b).toEqual(a);
  });

  it('색을 지우면 그 키만 빠지고, 다 비면 칸 자체가 사라진다', () => {
    expect(applyFill({ 'c0:0': '#a', r1: '#b' }, { kind: 'cell', r: 0, c: 0 }, null)).toEqual({ r1: '#b' });
    expect(applyFill({ r1: '#b' }, { kind: 'row', r: 1 }, null)).toBeUndefined();
  });

  it('행·열을 넣고 빼고 옮기면 좌표가 따라 움직인다 — `all`은 그대로', () => {
    expect(shiftFills({ 'c1:0': '#a', r2: '#b', k0: '#c', all: '#d' }, 'row', 'insert', 1)).toEqual({ 'c2:0': '#a', r3: '#b', k0: '#c', all: '#d' });
    expect(shiftFills({ r1: '#a', r2: '#b' }, 'row', 'remove', 1)).toEqual({ r1: '#b' });
    expect(shiftFills({ k0: '#a', k1: '#b' }, 'col', 'move', 0, 1)).toEqual({ k1: '#a', k0: '#b' });
    // 다른 축을 건드리면 그 키는 가만히 있다 — 열을 넣어도 `행 전체`는 같은 행이다.
    expect(shiftFills({ r1: '#a' }, 'col', 'insert', 0)).toEqual({ r1: '#a' });
  });
});

describe('roundSizes — 잰 치수를 정수로(합을 지킨다)', () => {
  it('낱낱이 반올림하면 부풀던 합이 그대로 남는다(제보: 유령 가로 스크롤)', () => {
    // 실측값: 640px 판에 다섯 열이 127.594씩 — 합은 638이다.
    const raw = [127.594, 127.594, 127.594, 127.594, 127.625];
    expect(raw.map((v) => Math.round(v)).reduce((a, b) => a + b, 0)).toBe(640); // 옛 방식: 2px 부푼다
    const out = roundSizes(raw);
    expect(out.reduce((a, b) => a + b, 0)).toBe(638);
    expect(out).toEqual([128, 127, 128, 127, 128]);
  });

  it('칸마다의 오차는 1px 안이고, 이미 정수면 그대로다', () => {
    const raw = [10.4, 10.4, 10.4];
    roundSizes(raw).forEach((v, i) => expect(Math.abs(v - (raw[i] as number))).toBeLessThan(1));
    expect(roundSizes([120, 80, 200])).toEqual([120, 80, 200]);
    expect(roundSizes([])).toEqual([]);
  });
});

describe('목록 항목 들여쓰기(Tab)와 단계별 표식', () => {
  const it3 = () => [
    { id: 'a', runs: [{ t: '가', b: false, c: null }] },
    { id: 'b', runs: [{ t: '나', b: false, c: null }] },
    { id: 'c', runs: [{ t: '다', b: false, c: null }] },
  ];

  it('**이웃을 따지지 않는다**(요청) — 첫 항목도, 연달아 두 번도 들어간다', () => {
    let items = indentListItem(it3(), 'a', 1); // 첫 항목도 들어간다
    expect(items[0]?.indent).toBe(1);
    items = indentListItem(it3(), 'b', 1);
    items = indentListItem(items, 'b', 1); // 앞이 0단계여도 두 번째 Tab이 듣는다
    expect(items[1]?.indent).toBe(2);
  });

  it('가장 깊은 단계에서 멈춘다 — 그 이상은 같은 배열', () => {
    let items = it3();
    for (let i = 0; i < NOTE_LIST_MAX_INDENT; i += 1) items = indentListItem(items, 'b', 1);
    expect(items[1]?.indent).toBe(NOTE_LIST_MAX_INDENT);
    expect(indentListItem(items, 'b', 1)).toBe(items);
  });

  it('딸린 항목도 함께 움직이고, 0단계로 돌아오면 칸이 사라진다', () => {
    let items = indentListItem(it3(), 'b', 1);
    items = indentListItem(items, 'c', 1);
    items = indentListItem(items, 'c', 1); // a(0) b(1) c(2)
    items = indentListItem(items, 'b', -1); // b를 내어쓰면 c도 따라 나온다
    expect(items.map((x) => x.indent ?? 0)).toEqual([0, 0, 1]);
    expect('indent' in (items[1] as object)).toBe(false); // 기본값은 적지 않는다
  });

  it('표식은 단계마다 따로 센다 — `1. a. i.` · `• ◦ ▪`', () => {
    const items = [
      { id: '1', runs: [] },
      { id: '2', runs: [], indent: 1 },
      { id: '3', runs: [], indent: 1 },
      { id: '4', runs: [], indent: 2 },
      { id: '5', runs: [] },
    ];
    expect(listMarkers('ol', items)).toEqual(['1.', 'a.', 'b.', 'i.', '2.']);
    expect(listMarkers('ul', items)).toEqual(['•', '◦', '◦', '▪', '•']);
    // 시작 번호는 **첫 단계에만** 걸린다(`3.`을 치고 시작한 목록).
    expect(listMarkers('ol', items, 3)).toEqual(['3.', 'a.', 'b.', 'i.', '4.']);
  });

  it('깊이 들어갔다 나오면 그 아래 번호는 **다시 1부터**', () => {
    const items = [
      { id: '1', runs: [] },
      { id: '2', runs: [], indent: 1 },
      { id: '3', runs: [] },
      { id: '4', runs: [], indent: 1 },
    ];
    expect(listMarkers('ol', items)).toEqual(['1.', 'a.', '2.', 'a.']);
  });
});

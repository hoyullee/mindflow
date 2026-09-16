// 공책 코어 — 페이지·블록의 순수 규칙.
//
// 이 파일이 지키는 것 셋: **글을 잃지 않는다**(종류를 바꿀 때), **열 것이 없어지지
// 않는다**(마지막 페이지), **저장본이 갈리지 않는다**(서식 없는 글은 평문으로 접는다).

import { describe, expect, it } from 'vitest';
import {
  blockText,
  emptyBlock,
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
  noteTagColor,
  noteUpdatedAt,
  normalizeRuns,
  pageExcerpt,
  pageText,
  removePage,
  retypeBlock,
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
});

describe('형광펜', () => {
  it('아는 키만 색이 된다 — 모르는 값은 칠하지 않는다', () => {
    expect(noteHighlightColor('yellow')).toBe('#FBEFC0');
    expect(noteHighlightColor('무지개')).toBe(null);
    expect(noteHighlightColor(null)).toBe(null);
  });
});

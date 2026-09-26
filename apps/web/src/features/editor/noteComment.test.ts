import { describe, expect, it } from 'vitest';
import type { NoteBlock, NotePage } from '@mindflow/mindmap-core';
import { canCommentOn, commentSpans, newThreadId, noteCommentSites, overlapsComment, quoteOf, threadIdOfNode, threadNodeId } from './noteComment';

const run = (t: string, extra: Record<string, unknown> = {}) => ({ t, b: false, c: null, ...extra });

describe('스레드 id ↔ 댓글 저장소의 대상 id', () => {
  it('앞머리를 붙이고 떼어 낸다', () => {
    expect(threadNodeId('cm1')).toBe('nm:cm1');
    expect(threadIdOfNode('nm:cm1')).toBe('cm1');
  });

  it('**페이지 댓글은 걸러진다** — 같은 표에 살지만 대상이 다르다', () => {
    expect(threadIdOfNode('root')).toBeNull();
    expect(threadIdOfNode('bk12')).toBeNull();
  });

  it('새 id는 매번 다르다', () => {
    expect(newThreadId()).not.toBe(newThreadId());
  });
});

describe('commentSpans — 런에서 걸린 구간을 읽는다', () => {
  it('걸린 구간의 글자 좌표를 준다', () => {
    const runs = [run('회의는 '), run('화요일', { cm: 'c1' }), run('입니다')];
    expect(commentSpans(runs)).toEqual([{ id: 'c1', a: 4, b: 7 }]);
  });

  it('**서식으로 갈린 런은 한 구간으로 모은다** — DOM은 여러 조각이어도 논의는 하나다', () => {
    const runs = [run('화', { cm: 'c1' }), run('요', { cm: 'c1', b: true }), run('일', { cm: 'c1' })];
    expect(commentSpans(runs)).toEqual([{ id: 'c1', a: 0, b: 3 }]);
  });

  it('사이가 끊긴 같은 id는 **따로** 센다 — 글을 지워 두 토막이 난 경우', () => {
    const runs = [run('가', { cm: 'c1' }), run('나'), run('다', { cm: 'c1' })];
    expect(commentSpans(runs)).toEqual([
      { id: 'c1', a: 0, b: 1 },
      { id: 'c1', a: 2, b: 3 },
    ]);
  });

  it('없으면 빈 배열(런이 없어도 터지지 않는다)', () => {
    expect(commentSpans(null)).toEqual([]);
    expect(commentSpans([run('평문')])).toEqual([]);
  });
});

describe('overlapsComment — 1판은 겹치는 댓글을 허용하지 않는다(6-2)', () => {
  const runs = [run('가나'), run('다라', { cm: 'c1' }), run('마바')];
  it('한 글자라도 겹치면 참', () => {
    expect(overlapsComment(runs, 3, 5)).toBe(true); // 라마 — 라가 걸려 있다
    expect(overlapsComment(runs, 0, 3)).toBe(true); // 가나다
  });
  it('맞닿기만 하는 것은 겹친 것이 아니다', () => {
    expect(overlapsComment(runs, 0, 2)).toBe(false); // 가나
    expect(overlapsComment(runs, 4, 6)).toBe(false); // 마바
  });
});

describe('quoteOf — 인용은 **지금 본문**에서 읽는다(스냅샷이 아니다)', () => {
  it('걸린 구간의 글을 그대로 준다', () => {
    const runs = [run('회의는 '), run('화요일', { cm: 'c1' })];
    expect(quoteOf(runs, 'c1')).toBe('화요일');
  });
  it('글이 고쳐지면 인용도 따라간다', () => {
    expect(quoteOf([run('수요일로 옮김', { cm: 'c1' })], 'c1')).toBe('수요일로 옮김');
  });
  it('그 줄에 없으면 빈 문자열', () => {
    expect(quoteOf([run('평문')], 'c1')).toBe('');
  });
});

describe('canCommentOn — 위젯 블록은 대상에서 뺀다(6-2)', () => {
  const b = (kind: string): NoteBlock => ({ id: 'x', kind } as NoteBlock);
  it('글을 담는 블록과 목록에는 달 수 있다', () => {
    ['p', 'h1', 'h2', 'h3', 'quote', 'callout', 'toggle', 'code', 'ul', 'ol'].forEach((k) => expect(canCommentOn(b(k))).toBe(true));
  });
  it('표·체크리스트·그림·구분선·삽입한 문서에는 달 수 없다', () => {
    ['table', 'ck', 'img', 'hr', 'link'].forEach((k) => expect(canCommentOn(b(k))).toBe(false));
    expect(canCommentOn(null)).toBe(false);
  });
});

describe('noteCommentSites — 공책 전체에서 걸린 자리', () => {
  const pages: NotePage[] = [
    {
      id: 'p1',
      title: '첫 장',
      blocks: [
        { id: 'b1', kind: 'p', runs: [run('회의는 '), run('화요일', { cm: 'c1' })] },
        { id: 'b2', kind: 'ul', items: [{ id: 'i1', runs: [run('항목', { cm: 'c2' })] }] },
      ],
    } as unknown as NotePage,
    { id: 'p2', title: '둘째 장', blocks: [{ id: 'b9', kind: 'p', runs: [run('다른 장', { cm: 'c3' })] }] } as unknown as NotePage,
  ];

  it('블록의 `runs`와 목록 항목의 `runs`를 **둘 다** 훑는다', () => {
    const sites = noteCommentSites(pages);
    expect(sites.map((s) => s.id)).toEqual(['c1', 'c2', 'c3']);
    expect(sites[0]).toMatchObject({ pageId: 'p1', blockId: 'b1', itemId: null, lineKey: 'b1', quote: '화요일' });
    expect(sites[1]).toMatchObject({ pageId: 'p1', blockId: 'b2', itemId: 'i1', lineKey: 'b2:i1', quote: '항목' });
  });

  it('한 페이지만 좁혀 볼 수 있다', () => {
    expect(noteCommentSites(pages, 'p2').map((s) => s.id)).toEqual(['c3']);
  });

  it('페이지가 없거나 망가져도 터지지 않는다', () => {
    expect(noteCommentSites(null)).toEqual([]);
    expect(noteCommentSites([{ id: 'p', title: '', blocks: null } as unknown as NotePage])).toEqual([]);
  });
});

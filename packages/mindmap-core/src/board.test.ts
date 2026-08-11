// 화이트보드(Doc.kind === 'board') — 루트 없는 문서가 코어 전 계층을 통과하는지.
//
// 설계(A안): board는 `nodes: {}`인 평범한 Doc이다. 별도 모델이 아니라 "트리가
// 없는 문서"이므로, 직렬화·CRDT·undo·검색이 전부 기존 경로를 그대로 탄다.
// 여기서는 그 전제 세 가지를 고정한다:
//   ① `kind`는 'board'일 때만 직렬화·CRDT 전파된다(기존 문서·골든 무변경)
//   ② 루트 없는 문서에서 layout이 throw하지 않는다(자유 도형만 배치)
//   ③ Float.caption(이미지 제목)은 제네릭 통과로 왕복한다

import { describe, expect, it } from 'vitest';
import type { Doc, Float, Node } from './model';
import { parseDoc, serializeDoc } from './serialize';
import { layout } from './layout';
import { toMarkdown } from './markdown';
import { docToYDoc, yDocToDoc, applyDocToYDoc } from './crdt/binding';

const memo = (id: string, x: number, y: number, extra: Partial<Float> = {}): Float => ({ id, x, y, w: 180, text: '메모 ' + id, ...extra });

function boardDoc(extra: Partial<Doc> = {}): Doc {
  return { v: 1, nodes: {}, floats: [memo('f1', 40, 60)], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral', kind: 'board', ...extra };
}

const SIZE = { w: 120, h: 40 };

describe('Doc.kind 직렬화', () => {
  it("'board'일 때만 기록되고 왕복한다 — 일반 맵에는 키 자체가 없다(골든 무변경 규칙)", () => {
    const board = serializeDoc(boardDoc());
    expect(board.kind).toBe('board');
    expect(parseDoc(JSON.parse(JSON.stringify(board)))?.kind).toBe('board');

    const map = serializeDoc({ nodes: { root: { id: 'root', text: 'T', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' });
    expect('kind' in map).toBe(false);
    expect('kind' in (parseDoc(JSON.parse(JSON.stringify(map))) ?? {})).toBe(false);
  });

  it("알 수 없는 kind 값은 버린다 — 'board'만 문서 종류다", () => {
    const doc = parseDoc({ nodes: {}, kind: 'poster' });
    expect(doc).not.toBeNull();
    expect('kind' in (doc ?? {})).toBe(false);
  });

  it('nodes가 빈 객체인 문서도 파싱을 통과한다(루트를 요구하지 않는다)', () => {
    const doc = parseDoc({ nodes: {}, floats: [memo('f1', 0, 0)] });
    expect(doc).not.toBeNull();
    expect(doc?.nodes).toEqual({});
    expect(doc?.floats).toHaveLength(1);
  });
});

describe('Float.caption(이미지 제목) 왕복', () => {
  it('직렬화와 CRDT를 제네릭으로 통과한다 — 값이 없으면 키도 없다', () => {
    const withCap = boardDoc({ floats: [memo('f1', 0, 0, { img: 'mfimg:d/x.webp', caption: '회의 화이트보드' })] });
    const round = parseDoc(JSON.parse(JSON.stringify(serializeDoc(withCap))));
    expect(round?.floats[0]?.caption).toBe('회의 화이트보드');

    const viaCrdt = yDocToDoc(docToYDoc(withCap));
    expect(viaCrdt.floats[0]?.caption).toBe('회의 화이트보드');

    const noCap = yDocToDoc(docToYDoc(boardDoc()));
    expect('caption' in (noCap.floats[0] ?? {})).toBe(false);
  });
});

describe('루트 없는 layout', () => {
  it('throw하지 않고, 트리가 없으니 노드 좌표도 그대로다', () => {
    for (const mode of ['radial', 'right', 'down'] as const) {
      expect(() => layout(boardDoc(), mode, () => SIZE)).not.toThrow();
      expect(layout(boardDoc(), mode, () => SIZE)).toEqual({});
    }
  });

  it('자유 도형의 하위 트리는 여전히 배치된다(layoutFreeSub 경로 유지)', () => {
    const free: Node = { id: 'fr1', text: '자유', emoji: '', parent: null, children: ['fc1'], collapsed: false, color: null, x: 200, y: 100, free: true };
    const child: Node = { id: 'fc1', text: '자식', emoji: '', parent: 'fr1', children: [], collapsed: false, color: null, x: 0, y: 0 };
    const out = layout(boardDoc({ nodes: { fr1: free, fc1: child } }), 'right', () => SIZE);
    // 자유 루트는 제자리, 자식은 그 오른쪽으로 배치된다.
    expect(out.fr1?.x).toBe(200);
    expect(out.fr1?.y).toBe(100);
    expect(out.fc1?.x).toBeGreaterThan(200);
  });
});

describe('CRDT의 kind 전파', () => {
  it('board 문서가 Y.Doc을 왕복해도 board로 남는다 — 빠뜨리면 협업 중 맵으로 변한다', () => {
    expect(yDocToDoc(docToYDoc(boardDoc())).kind).toBe('board');
    // kind 없는 문서는 왕복 후에도 키가 없다(라운드트립 동일성).
    const plain = boardDoc();
    delete plain.kind;
    expect('kind' in yDocToDoc(docToYDoc(plain))).toBe(false);
  });

  it('증분 적용(applyDocToYDoc)에서도 kind가 흐른다', () => {
    const prev = boardDoc();
    const ydoc = docToYDoc(prev);
    const next = { ...prev, floats: [...prev.floats, memo('f2', 300, 40)] };
    applyDocToYDoc(ydoc, next, prev);
    const out = yDocToDoc(ydoc);
    expect(out.kind).toBe('board');
    expect(out.floats).toHaveLength(2);
  });
});

describe('루트 없는 toMarkdown', () => {
  it('선두 빈 줄 없이 메모 구획부터 시작하고, 제목은 메타에서 받는다', () => {
    expect(toMarkdown(boardDoc())).toBe('## 메모\n- 메모 f1');
    expect(toMarkdown(boardDoc(), '아이디어 보드')).toBe('# 아이디어 보드\n\n## 메모\n- 메모 f1');
  });

  it('루트가 있으면 title 인자는 무시된다(기존 동작 무변경)', () => {
    const map: Doc = { v: 1, nodes: { root: { id: 'root', text: '진짜 제목', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' };
    expect(toMarkdown(map, '엉뚱한 제목')).toBe('# 진짜 제목');
  });
});

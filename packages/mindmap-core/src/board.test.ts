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

// ── 그리기 획(M4) ──────────────────────────────────────────────────────────

import { strokeBounds, strokeHit, strokePathD, translateStrokePts } from './strokes';
import type { Stroke } from './model';

const STROKE: Stroke = { id: 's1', pts: [0, 0, 100, 0, 100, 50], color: '#2b2b2b', w: 4 };

describe('Stroke 직렬화·CRDT', () => {
  it('비어 있지 않을 때만 직렬화된다 — 기존 문서·골든 무변경 규칙', () => {
    const withStroke = serializeDoc({ ...boardDoc(), strokes: [STROKE] });
    expect(withStroke.strokes).toHaveLength(1);
    expect(parseDoc(JSON.parse(JSON.stringify(withStroke)))?.strokes?.[0]).toEqual(STROKE);

    const none = serializeDoc(boardDoc());
    expect('strokes' in none).toBe(false);
    expect('strokes' in (parseDoc(JSON.parse(JSON.stringify(none))) ?? {})).toBe(false);
  });

  it('Y.Doc 왕복·증분 적용에서 획이 흐른다(획 = 원자 항목)', () => {
    const prev = boardDoc({ strokes: [STROKE] });
    expect(yDocToDoc(docToYDoc(prev)).strokes?.[0]).toEqual(STROKE);

    const ydoc = docToYDoc(prev);
    const s2: Stroke = { id: 's2', pts: [10, 10, 20, 20], color: '#d92626', w: 2 };
    applyDocToYDoc(ydoc, { ...prev, strokes: [STROKE, s2] }, prev);
    expect(yDocToDoc(ydoc).strokes).toHaveLength(2);
    // 지우개 = 항목 삭제.
    applyDocToYDoc(ydoc, { ...prev, strokes: [s2] }, { ...prev, strokes: [STROKE, s2] });
    expect(yDocToDoc(ydoc).strokes).toEqual([s2]);
  });
});

describe('획 기하(strokes.ts)', () => {
  it('strokeBounds — 선 굵기 절반을 포함한 경계 상자', () => {
    expect(strokeBounds(STROKE)).toEqual({ x0: -2, y0: -2, x1: 102, y1: 52 });
    expect(strokeBounds({ ...STROKE, pts: [] })).toBeNull();
  });

  it('strokeHit — 선분 위·근처만 true(획 지우개 판정)', () => {
    expect(strokeHit(STROKE, 50, 0, 3)).toBe(true); // 첫 선분 위
    expect(strokeHit(STROKE, 100, 25, 3)).toBe(true); // 둘째 선분 위
    expect(strokeHit(STROKE, 50, 30, 3)).toBe(false); // 멀리
    expect(strokeHit(STROKE, 50, 2.5, 3)).toBe(true); // 허용치 안
  });

  it('strokePathD — M/L 경로 문자열, 점 하나는 극소 선분(둥근 캡이 점이 된다)', () => {
    expect(strokePathD([0, 0, 10, 5])).toBe('M 0 0 L 10 5');
    expect(strokePathD([3, 4])).toBe('M 3 4 L 3.01 4');
    expect(strokePathD([])).toBe('');
  });

  it('translateStrokePts — 모든 점을 같은 만큼, 그릴 때와 같은 0.1 단위로', () => {
    expect(translateStrokePts([0, 0, 10, 5], 3, -2)).toEqual([3, -2, 13, 3]);
    // 드래그 좌표는 줌에 따라 소수가 길어진다 — 저장본에 그대로 흘리지 않는다.
    expect(translateStrokePts([0, 0], 1.234, 5.678)).toEqual([1.2, 5.7]);
    expect(translateStrokePts([], 5, 5)).toEqual([]);
  });
});

describe('하이라이터(형광펜) 획', () => {
  const HL: Stroke = { id: 'h1', pts: [0, 0, 60, 0], color: '#ffe14d', w: 20, hl: true };

  it('hl은 true일 때만 직렬화된다 — 기존 저장본·골든 무변경 규칙', () => {
    const d = serializeDoc(boardDoc({ strokes: [HL, STROKE] }));
    const [hl, pen] = d.strokes as Stroke[];
    expect(hl?.hl).toBe(true);
    expect(pen && 'hl' in pen).toBe(false);
    const round = parseDoc(JSON.parse(JSON.stringify(d)));
    expect(round?.strokes?.[0]).toEqual(HL);
    expect(round?.strokes?.[1]).toEqual(STROKE);
  });

  it('Y.Doc 왕복에서도 hl이 살아 남는다(필드 제네릭 경로)', () => {
    const prev = boardDoc({ strokes: [HL] });
    expect(yDocToDoc(docToYDoc(prev)).strokes?.[0]).toEqual(HL);
  });

  it('굵은 획일수록 경계·히트 허용치가 넓다 — 하이라이터도 같은 기하를 쓴다', () => {
    expect(strokeBounds(HL)).toEqual({ x0: -10, y0: -10, x1: 70, y1: 10 });
    expect(strokeHit(HL, 30, 9, 10)).toBe(true);
  });
});

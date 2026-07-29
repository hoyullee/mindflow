// 마크다운 가져오기(`parseOutline`)와 내보내기(코어 `toMarkdown`)의 **왕복**.
//
// 예전엔 내보낸 `.md`를 다시 가져오면 트리만 남고 노트는 사라지고, `## 개별 주제`·
// `## 메모` 섹션의 항목이 루트의 일반 가지로 들어왔다. 이제 세 가지를 되읽는다.

import { describe, expect, it } from 'vitest';
import { toMarkdown } from '@mindflow/mindmap-core';
import { parseOutline } from './storage';

interface ParsedNode {
  id: string;
  text: string;
  parent: string | null;
  children: string[];
  note?: string;
  free?: boolean;
}
interface ParsedFloat {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
}

/** `parseOutline`의 결과를 읽기 쉬운 형태로. */
function read(md: string, fallback = '폴백') {
  const doc = parseOutline(md, fallback);
  if (!doc) return null;
  const nodes = doc.nodes as unknown as Record<string, ParsedNode>;
  const byId = (id: string) => nodes[id]!;
  const childTexts = (id: string) => (byId(id).children || []).map((c) => byId(c).text);
  return { doc, nodes, byId, childTexts, floats: (doc.floats || []) as unknown as ParsedFloat[] };
}

describe('parseOutline — 기존 동작(회귀 방어)', () => {
  it('# 제목 + 들여쓴 불릿을 트리로 만든다', () => {
    const r = read('# 주제\n- 가지 A\n  - 손자\n- 가지 B')!;
    expect(r.byId('root').text).toBe('주제');
    expect(r.childTexts('root')).toEqual(['가지 A', '가지 B']);
    const a = Object.values(r.nodes).find((n) => n.text === '가지 A')!;
    expect(r.childTexts(a.id)).toEqual(['손자']);
  });

  it('제목이 없으면 폴백 제목을 쓴다', () => {
    expect(read('- 하나\n- 둘')!.byId('root').text).toBe('폴백');
  });

  it('불릿이 하나도 없으면 null (제목만 있는 파일은 개요가 아니다)', () => {
    expect(parseOutline('# 제목만 있음', '폴백')).toBeNull();
    expect(parseOutline('아무 내용 없음', '폴백')).toBeNull();
  });

  it('`*`·`+` 불릿과 탭 들여쓰기도 받는다', () => {
    const r = read('# T\n* 가지\n\t+ 손자')!;
    const a = Object.values(r.nodes).find((n) => n.text === '가지')!;
    expect(r.childTexts(a.id)).toEqual(['손자']);
  });

  it('우리 것이 아닌 ## 제목은 예전처럼 무시하고, 그 아래 불릿은 트리에 계속 쌓인다', () => {
    const r = read('# T\n- 가지\n\n## 참고 자료\n- 링크')!;
    expect(r.childTexts('root')).toEqual(['가지', '링크']);
    expect(r.floats).toHaveLength(0);
  });
});

describe('parseOutline — 되읽기(노트·자유 도형·메모)', () => {
  it('`> 텍스트`는 바로 위 노드의 노트가 된다 (루트 포함)', () => {
    const r = read('# 주제\n  > 루트 노트\n- 가지\n  > 가지 노트')!;
    expect(r.byId('root').note).toBe('루트 노트');
    const a = Object.values(r.nodes).find((n) => n.text === '가지')!;
    expect(a.note).toBe('가지 노트');
  });

  it('노트가 여러 줄이면 줄바꿈으로 이어 붙인다', () => {
    const r = read('# 주제\n- 가지\n  > 첫 줄\n  > 둘째 줄')!;
    const a = Object.values(r.nodes).find((n) => n.text === '가지')!;
    expect(a.note).toBe('첫 줄\n둘째 줄');
  });

  it('`## 개별 주제`의 항목은 트리에 붙지 않는 자유 도형이 된다', () => {
    const r = read('# 주제\n- 가지\n\n## 개별 주제\n- 독립 하나\n- 독립 둘')!;
    expect(r.childTexts('root')).toEqual(['가지']); // 루트 자식으로 새지 않는다
    const frees = Object.values(r.nodes).filter((n) => n.free);
    expect(frees.map((n) => n.text)).toEqual(['독립 하나', '독립 둘']);
    frees.forEach((n) => expect(n.parent).toBeNull());
  });

  it('자유 도형은 루트·서로와 겹치지 않는 자리를 받는다', () => {
    // 레이아웃은 트리만 배치하므로 자유 도형은 자기 좌표가 필요하다. 0,0으로 두면
    // 루트와 겹쳐 한 덩어리로 보였다(실브라우저에서 확인한 실제 증상).
    const r = read('# 주제\n- 가지\n\n## 개별 주제\n- 하나\n- 둘')!;
    const frees = Object.values(r.nodes).filter((n) => n.free) as unknown as { x: number; y: number }[];
    expect(frees).toHaveLength(2);
    frees.forEach((f) => expect(f.x === 0 && f.y === 0).toBe(false)); // 루트(0,0)와 겹치지 않는다
    expect(frees[0]!.y).not.toBe(frees[1]!.y); // 서로도 겹치지 않는다
  });

  it('자유 도형의 하위 항목은 그 도형의 자식이 된다', () => {
    const r = read('# 주제\n- 가지\n\n## 개별 주제\n- 독립\n  - 독립의 자식')!;
    const free = Object.values(r.nodes).find((n) => n.free)!;
    expect(r.childTexts(free.id)).toEqual(['독립의 자식']);
    expect(r.childTexts('root')).toEqual(['가지']);
  });

  it('`## 메모`의 항목은 메모(플로트)가 된다', () => {
    const r = read('# 주제\n- 가지\n\n## 메모\n- 메모 하나\n- 메모 둘')!;
    expect(r.childTexts('root')).toEqual(['가지']);
    expect(r.floats.map((f) => f.text)).toEqual(['메모 하나', '메모 둘']);
    // 위치·폭이 있어야 캔버스에 그려진다(레이아웃은 플로트를 배치하지 않는다).
    r.floats.forEach((f) => {
      expect(f.w).toBeGreaterThan(0);
      expect(Number.isFinite(f.x)).toBe(true);
      expect(Number.isFinite(f.y)).toBe(true);
    });
    expect(r.floats[0]!.y).toBeLessThan(r.floats[1]!.y); // 세로로 쌓인다(겹치지 않게)
  });

  it('메모만 있는 파일도 가져온다', () => {
    const r = read('# 주제\n\n## 메모\n- 메모만')!;
    expect(r.floats.map((f) => f.text)).toEqual(['메모만']);
  });
});

describe('toMarkdown → parseOutline 왕복', () => {
  const doc = {
    v: 1 as const,
    nodes: {
      root: { id: 'root', text: '주제', emoji: '🎯', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0, note: '루트 노트' },
      a: { id: 'a', text: '가지', emoji: '', parent: 'root', children: ['b'], collapsed: false, color: null, x: 0, y: 0, note: '가지 노트' },
      b: { id: 'b', text: '손자', emoji: '', parent: 'a', children: [], collapsed: false, color: null, x: 0, y: 0 },
      f1: { id: 'f1', text: '자유 도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 120, y: 80, free: true },
    },
    floats: [{ id: 'm1', x: 0, y: 0, w: 180, text: '메모 내용' }],
    lines: [],
    zones: [],
    layoutMode: 'radial' as const,
    themeKey: 'coral',
  };

  it('트리·노트·자유 도형·메모가 모두 살아 돌아온다', () => {
    const r = read(toMarkdown(doc as unknown as Parameters<typeof toMarkdown>[0]))!;

    // 트리 (이모지는 라벨에 합쳐져 나간다 — `toMarkdown`의 형식)
    expect(r.byId('root').text).toBe('🎯 주제');
    expect(r.childTexts('root')).toEqual(['가지']);
    const a = Object.values(r.nodes).find((n) => n.text === '가지')!;
    expect(r.childTexts(a.id)).toEqual(['손자']);

    // 노트
    expect(r.byId('root').note).toBe('루트 노트');
    expect(a.note).toBe('가지 노트');

    // 자유 도형 — 루트의 자식으로 새지 않는다
    expect(Object.values(r.nodes).filter((n) => n.free).map((n) => n.text)).toEqual(['자유 도형']);

    // 메모
    expect(r.floats.map((f) => f.text)).toEqual(['메모 내용']);
  });

  it('두 번 왕복해도 같다 (안정적)', () => {
    const once = toMarkdown(doc as unknown as Parameters<typeof toMarkdown>[0]);
    const back = parseOutline(once, '폴백')!;
    const twice = toMarkdown(back as unknown as Parameters<typeof toMarkdown>[0]);
    expect(twice).toBe(once);
  });
});

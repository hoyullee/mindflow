import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toMarkdown } from './markdown';
import { parseDoc } from './serialize';

const readFixture = (relPath: string): string =>
  readFileSync(fileURLToPath(new URL('../test/fixtures/' + relPath, import.meta.url)), 'utf8');

describe('toMarkdown', () => {
  it('matches golden/outline.md exactly (byte-for-byte, no trailing newline) for the mixed fixture', () => {
    const raw = JSON.parse(readFixture('golden/serialize-roundtrip.json')) as unknown;
    const doc = parseDoc(raw);
    expect(doc).not.toBeNull();

    const md = toMarkdown(doc!);
    const golden = readFixture('golden/outline.md');
    expect(md).toBe(golden);
  });

  it('root becomes an H1, deeper levels become indented bullets (MindFlow.dc.html:620-624)', () => {
    const doc = parseDoc({
      nodes: {
        root: { id: 'root', text: '루트', emoji: '🎯', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '자식', emoji: '', parent: 'root', children: ['b'], collapsed: false, color: null, x: 0, y: 0 },
        b: { id: 'b', text: '손자', emoji: '', parent: 'a', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
    });
    expect(toMarkdown(doc!)).toBe('# 🎯 루트\n- 자식\n  - 손자');
  });

  it('emits a note line under a node with a non-blank note (MindFlow.dc.html:625)', () => {
    const doc = parseDoc({
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0, note: '루트 메모' },
        a: { id: 'a', text: '자식', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, note: '  ' },
      },
    });
    // root note is at depth 0 -> Math.max(0, -1) = 0 indentation; blank note on `a` is skipped
    expect(toMarkdown(doc!)).toBe('# 루트\n  > 루트 메모\n- 자식');
  });

  it('appends "## 개별 주제" only when free nodes exist, walking each as its own depth-1 root', () => {
    const withFree = parseDoc({
      nodes: {
        root: { id: 'root', text: 'R', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
        free1: { id: 'free1', text: '자유 도형', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0, free: true, rich: null },
      },
    });
    expect(toMarkdown(withFree!)).toBe('# R\n\n## 개별 주제\n- 자유 도형');

    const noFree = parseDoc({
      nodes: { root: { id: 'root', text: 'R', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    });
    expect(toMarkdown(noFree!)).toBe('# R');
  });

  it('appends "## 메모" only when at least one float has non-blank text, skipping blank ones', () => {
    const doc = parseDoc({
      nodes: { root: { id: 'root', text: 'R', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [
        { id: 'f1', x: 0, y: 0, w: 10, text: '  ' },
        { id: 'f2', x: 0, y: 0, w: 10, text: '메모 내용\n둘째 줄' },
      ],
    });
    expect(toMarkdown(doc!)).toBe('# R\n\n## 메모\n- 메모 내용 둘째 줄');

    const noFloatText = parseDoc({
      nodes: { root: { id: 'root', text: 'R', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [{ id: 'f1', x: 0, y: 0, w: 10, text: '   ' }],
    });
    expect(toMarkdown(noFloatText!)).toBe('# R');
  });
});


describe('toMarkdown — rich 서식 인라인 문법', () => {
  const base = {
    v: 1,
    nodes: {
      root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
      a: {
        id: 'a', text: '굵게 기울임 취소 링크', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0,
        rich: [
          { t: '굵게', b: true, c: null },
          { t: ' ', b: false, c: null },
          { t: '기울임', b: false, c: null, i: true },
          { t: ' ', b: false, c: null },
          { t: '취소', b: false, c: null, s: true },
          { t: ' ', b: false, c: null },
          { t: '링크', b: false, c: null, href: 'https://example.com/' },
        ],
      },
    },
    floats: [{ id: 'f1', x: 0, y: 0, w: 160, text: '메모 강조', rich: [{ t: '메모 ', b: false, c: null }, { t: '강조', b: true, c: null }] }],
    lines: [], zones: [], layoutMode: 'right', themeKey: 'coral',
  };

  it('굵게/기울임/취소선/링크가 마크다운 문법으로 나온다', () => {
    const doc = parseDoc(base)!;
    const md = toMarkdown(doc);
    expect(md).toContain('- **굵게** *기울임* ~~취소~~ [링크](https://example.com/)');
    expect(md).toContain('- 메모 **강조**');
  });

  it('런 가장자리 공백은 마커 밖으로 나온다 (`** 굵게 **` 방지)', () => {
    const doc = parseDoc({
      ...base,
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '앞 굵은뒤', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, rich: [{ t: '앞', b: false, c: null }, { t: ' 굵은', b: true, c: null }, { t: '뒤', b: false, c: null }] },
      },
      floats: [],
    })!;
    expect(toMarkdown(doc)).toContain('- 앞 **굵은**뒤');
  });

  it('색만 있는 런과 평문은 그대로 (rich 없는 문서 무회귀)', () => {
    const doc = parseDoc({
      ...base,
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '빨강 평문', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, rich: [{ t: '빨강', b: false, c: '#d92626' }, { t: ' 평문', b: false, c: null }] },
      },
      floats: [],
    })!;
    expect(toMarkdown(doc)).toContain('- 빨강 평문');
  });

  it('굵게+기울임 조합은 ***…*** 로 나온다', () => {
    const doc = parseDoc({
      ...base,
      nodes: {
        root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['a'], collapsed: false, color: null, x: 0, y: 0 },
        a: { id: 'a', text: '강조', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, rich: [{ t: '강조', b: true, c: null, i: true }] },
      },
      floats: [],
    })!;
    expect(toMarkdown(doc)).toContain('- ***강조***');
  });
});

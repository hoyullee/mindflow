// 표의 클립보드 — 격자를 두 벌로 싣고 다시 읽는다(요청 7·8).

import { describe, expect, it } from 'vitest';
import { textRuns } from '@mindflow/mindmap-core';
import { parseTableClip, tableClipboard, tableGridOf } from './noteTableClip';

const G = [
  [textRuns('A'), textRuns('B'), textRuns('C')],
  [textRuns('a'), textRuns('b'), textRuns('c')],
];

describe('표의 클립보드', () => {
  it('고른 네모만 떠낸다 — 표 밖으로 나간 자리는 빈 칸', () => {
    expect(tableGridOf(G, { r0: 0, c0: 1, r1: 1, c1: 2 }).map((r) => r.map((c) => c[0]?.t))).toEqual([
      ['B', 'C'],
      ['b', 'c'],
    ]);
    // 표 밖까지 골랐다면(있을 수 없지만 방어) 빈 칸으로 메운다.
    expect(tableGridOf(G, { r0: 1, c0: 2, r1: 2, c1: 3 }).map((r) => r.map((c) => c[0]?.t ?? ''))).toEqual([
      ['c', ''],
      ['', ''],
    ]);
  });

  it('평문은 TSV, HTML은 런을 실은 진짜 표', () => {
    const p = tableClipboard(tableGridOf(G, { r0: 0, c0: 0, r1: 1, c1: 2 }));
    expect(p.plain).toBe('A\tB\tC\na\tb\tc');
    expect(p.html.startsWith('<table data-mf-table="1">')).toBe(true);
    expect(p.html).toContain('data-mf-runs=');
  });

  it('칸 안의 줄바꿈은 **평문에서만** 공백으로 접는다 — 격자가 깨지지 않게', () => {
    const p = tableClipboard([[textRuns('한 줄\n두 줄'), textRuns('옆')]]);
    expect(p.plain).toBe('한 줄 두 줄\t옆');
  });

  it('우리가 실은 것을 그대로 되읽는다(서식까지)', () => {
    const grid = [[[{ t: '굵게', b: true, c: null }], textRuns('평범')]];
    const back = parseTableClip(tableClipboard(grid).html, '');
    expect(back?.[0]?.[0]).toEqual([{ t: '굵게', b: true, c: null }]);
    expect(back?.[0]?.[1]?.map((r) => r.t).join('')).toBe('평범');
  });

  it('남의 표(HTML)는 칸의 글을 읽어 온다 — 우리 표식이 없어도', () => {
    const back = parseTableClip('<table><tr><td><b>ㄱ</b></td><td>ㄴ</td></tr></table>', '');
    expect(back?.[0]?.map((c) => c.map((r) => r.t).join(''))).toEqual(['ㄱ', 'ㄴ']);
    expect(back?.[0]?.[0]?.[0]?.b).toBe(true);
  });

  it('HTML이 없으면 TSV로 — 탭·줄바꿈이 격자를 만든다', () => {
    expect(parseTableClip('', '1\t2\n3\t4')?.map((r) => r.map((c) => c[0]?.t))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    // 끝에 붙은 줄바꿈은 빈 행을 만들지 않는다.
    expect(parseTableClip('', '1\t2\n')?.length).toBe(1);
  });

  it('**탭도 줄바꿈도 없는 글은 표가 아니다** — 낱말 하나를 칸에 붙여넣는 일을 가로채지 않는다', () => {
    expect(parseTableClip('', '안녕')).toBeNull();
    expect(parseTableClip('', '')).toBeNull();
    // 표가 없는 HTML도 마찬가지다.
    expect(parseTableClip('<p>안녕</p>', '안녕')).toBeNull();
  });
});

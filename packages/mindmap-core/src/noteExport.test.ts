// 공책 내보내기 — 블록이 세 형식으로 어떻게 펴지는가.
import { describe, expect, it } from 'vitest';
import { noteMarkdown, notePlainText, notePagesFor } from './noteExport';
import type { Doc } from './model';

const run = (t: string) => [{ t, b: false, c: null }];
const DOC = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'note',
  pages: [
    {
      id: 'p1',
      title: '9월 3주 회의록',
      blocks: [
        { id: 'b1', kind: 'p', runs: run('릴리즈 범위를 좁혔습니다.') },
        { id: 'b2', kind: 'h2', runs: run('결정한 것') },
        { id: 'b3', kind: 'ck', items: [{ id: 'i1', runs: run('알림 분리'), done: true }, { id: 'i2', runs: run('위젯 보류') }] },
        { id: 'b4', kind: 'table', rows: [[run('할 일'), run('담당')], [run('검수'), run('박지훈')]] },
        { id: 'b5', kind: 'q', runs: run('인터뷰 지적이 반복됩니다.') },
        { id: 'b6', kind: 'ul', items: [{ id: 'i3', runs: run('첫째') }], indent: 1 },
      ],
    },
    { id: 'p2', title: '주간 회고', blocks: [{ id: 'c1', kind: 'p', runs: run('Keep') }] },
  ],
} as unknown as Doc;

describe('공책 내보내기', () => {
  it('범위가 페이지를 고른다 — 이 페이지 한 장 / 공책 전체', () => {
    expect(notePagesFor(DOC, 'page', 'p2').map((p) => p.id)).toEqual(['p2']);
    expect(notePagesFor(DOC, 'book', 'p2').map((p) => p.id)).toEqual(['p1', 'p2']);
    // 없는 id를 줘도 빈 손으로 돌아가지 않는다 — 첫 장으로 물러선다.
    expect(notePagesFor(DOC, 'page', 'nope').map((p) => p.id)).toEqual(['p1']);
  });

  it('마크다운 — 제목·체크·표·인용·들여쓰기', () => {
    const md = noteMarkdown(DOC, '제품 회의록', 'page', 'p1');
    expect(md).toContain('# 9월 3주 회의록');
    expect(md).toContain('## 결정한 것');
    expect(md).toContain('- [x] 알림 분리');
    expect(md).toContain('- [ ] 위젯 보류');
    expect(md).toContain('| 할 일 | 담당 |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('> 인터뷰 지적이 반복됩니다.');
    // 들여쓴 목록은 두 칸 들어간다.
    expect(md).toContain('  - 첫째');
    // 한 장만 골랐으니 다른 장은 없다.
    expect(md).not.toContain('주간 회고');
  });

  it('공책 전체는 책 제목이 머리가 되고 장마다 `##`이 붙는다', () => {
    const md = noteMarkdown(DOC, '제품 회의록', 'book', 'p1');
    expect(md.startsWith('# 제품 회의록')).toBe(true);
    expect(md).toContain('## 9월 3주 회의록');
    expect(md).toContain('## 주간 회고');
  });

  it('일반 텍스트 — 마크다운 기호 없이 읽히는 글', () => {
    const txt = notePlainText(DOC, '제품 회의록', 'page', 'p1');
    expect(txt).toContain('9월 3주 회의록');
    expect(txt).toContain('[v] 알림 분리');
    expect(txt).toContain('[ ] 위젯 보류');
    expect(txt).toContain('할 일\t담당');
    // `#`이나 `|` 같은 기호를 쓰지 않는다.
    expect(txt).not.toContain('##');
    expect(txt).not.toContain('| 할 일');
  });

  it('빈 공책도 깨지지 않는다', () => {
    const empty = { ...DOC, pages: [] } as unknown as Doc;
    expect(noteMarkdown(empty, 'x', 'book', null)).toBe('# x\n');
    expect(notePlainText(empty, 'x', 'book', null)).toBe('x\n');
  });
});

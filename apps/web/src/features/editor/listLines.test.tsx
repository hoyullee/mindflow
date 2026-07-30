import { describe, expect, it } from 'vitest';
import { listLinesOf, nodeContentLines, plainContentLines } from './listLines';

describe('nodeContentLines', () => {
  it('평문 리스트 줄에서 마커를 떼고 list 해석을 붙인다', () => {
    const lines = nodeContentLines({ text: '- 하나\n평문\n2. 둘', rich: null });
    expect(lines).toHaveLength(3);
    expect(lines[0]!.list?.display).toBe('• ');
    expect(lines[0]!.segs.map((s) => s.t).join('')).toBe('하나');
    expect(lines[1]!.list).toBeNull();
    expect(lines[1]!.segs.map((s) => s.t).join('')).toBe('평문');
    expect(lines[2]!.list?.display).toBe('2. ');
    expect(lines[2]!.segs.map((s) => s.t).join('')).toBe('둘');
  });

  it('rich 런 경계에 마커가 걸쳐 있어도 정확히 떼어낸다', () => {
    // '- 굵' 중 '- '는 첫 런에, 스타일은 내용에만 남아야 한다
    const lines = nodeContentLines({
      text: '- 굵게점',
      rich: [
        { t: '- 굵', b: true, c: null },
        { t: '게점', b: false, c: null },
      ],
    });
    expect(lines[0]!.list?.raw).toBe('- ');
    expect(lines[0]!.segs).toEqual([
      { t: '굵', b: true, c: null, i: undefined, s: undefined },
      { t: '게점', b: false, c: null, i: undefined, s: undefined },
    ]);
  });

  it('빈 줄은 빈 세그 배열', () => {
    const lines = nodeContentLines({ text: 'a\n\nb', rich: null });
    expect(lines).toHaveLength(3);
    expect(lines[1]!.segs).toEqual([]);
    expect(lines[1]!.list).toBeNull();
  });
});

describe('plainContentLines', () => {
  it('메모 텍스트의 리스트 줄을 해석한다', () => {
    const lines = plainContentLines('- 할 일\n1) 순서');
    expect(lines[0]!.list?.display).toBe('• ');
    expect(lines[1]!.list?.display).toBe('1) ');
    expect(lines[1]!.segs[0]!.t).toBe('순서');
  });
});

describe('listLinesOf', () => {
  it('리스트 마커가 없으면 null — 기존 렌더 경로 유지 가드', () => {
    expect(listLinesOf({ text: '그냥 텍스트\n둘째 줄', rich: null })).toBeNull();
    expect(listLinesOf({ text: '- 리스트', rich: null })).not.toBeNull();
  });
});

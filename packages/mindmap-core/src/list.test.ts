import { describe, expect, it } from 'vitest';
import { applyListOp, continueListMarker, listDisplayLine, parseListPrefix, shiftOffset } from './list';

describe('parseListPrefix', () => {
  it('글머리 마커(-, *, •)를 인식하고 표시는 • 로 통일한다', () => {
    expect(parseListPrefix('- 항목')).toEqual({ kind: 'ul', raw: '- ', display: '• ', indent: 0, pad: '' });
    expect(parseListPrefix('* 항목')).toEqual({ kind: 'ul', raw: '* ', display: '• ', indent: 0, pad: '' });
    expect(parseListPrefix('• 항목')).toEqual({ kind: 'ul', raw: '• ', display: '• ', indent: 0, pad: '' });
  });

  it('번호 마커(1. / 1))를 인식하고 표시는 입력 그대로', () => {
    expect(parseListPrefix('1. 첫째')).toEqual({ kind: 'ol', raw: '1. ', display: '1. ', indent: 0, pad: '' });
    expect(parseListPrefix('12) 항목')).toEqual({ kind: 'ol', raw: '12) ', display: '12) ', indent: 0, pad: '' });
  });

  it('raw와 display의 글자 수가 같다 — rich 런 오프셋 보존 계약', () => {
    for (const line of ['- a', '* a', '• a', '3. a', '42) a', '  - a', '    7. a']) {
      const p = parseListPrefix(line)!;
      expect(p.display.length).toBe(p.raw.length);
    }
  });

  it('마커가 아닌 것들은 null — 공백 없는 하이픈, 소수점, 굵게 마커, 일반 텍스트', () => {
    expect(parseListPrefix('-항목')).toBeNull();
    expect(parseListPrefix('3.14 원주율')).toBeNull(); // '3. '이 아니라 '3.1…'
    expect(parseListPrefix('**굵게**')).toBeNull();
    expect(parseListPrefix('일반 텍스트')).toBeNull();
    expect(parseListPrefix('')).toBeNull();
    expect(parseListPrefix('1234. 네자리는 번호가 아니다')).toBeNull();
  });
});

describe('listDisplayLine', () => {
  it('글머리 줄만 글리프를 치환하고 나머지는 그대로', () => {
    expect(listDisplayLine('- 항목')).toBe('• 항목');
    expect(listDisplayLine('2. 둘째')).toBe('2. 둘째');
    expect(listDisplayLine('평문')).toBe('평문');
  });
});

describe('continueListMarker', () => {
  it('내용 있는 글머리 줄 → 같은 마커로 이어쓴다', () => {
    expect(continueListMarker('- 항목')).toEqual({ next: '- ' });
    expect(continueListMarker('* 항목')).toEqual({ next: '* ' });
  });

  it('내용 있는 번호 줄 → 번호 +1', () => {
    expect(continueListMarker('1. 첫째')).toEqual({ next: '2. ' });
    expect(continueListMarker('9) 아홉')).toEqual({ next: '10) ' });
  });

  it('마커만 있고 내용이 비면 end — 리스트 종료(마커 제거) 신호', () => {
    expect(continueListMarker('- ')).toEqual({ end: true, replaceWith: '' });
    expect(continueListMarker('3. ')).toEqual({ end: true, replaceWith: '' });
    expect(continueListMarker('-  ')).toEqual({ end: true, replaceWith: '' }); // 공백뿐인 내용도 빈 것으로
  });

  it('리스트 줄이 아니면 null', () => {
    expect(continueListMarker('평문')).toBeNull();
    expect(continueListMarker('')).toBeNull();
  });
});

describe('들여쓰기 — parseListPrefix.indent / pad', () => {
  it('마커 앞 공백 2칸이 한 단계', () => {
    expect(parseListPrefix('  - 항목')).toMatchObject({ indent: 1, pad: '  ', raw: '  - ', display: '  • ' });
    expect(parseListPrefix('    1. 항목')).toMatchObject({ indent: 2, pad: '    ', raw: '    1. ' });
  });

  it('탭 하나도 한 단계로 센다', () => {
    expect(parseListPrefix('\t- 항목')).toMatchObject({ indent: 1 });
  });

  it('들여쓴 줄도 raw와 display의 길이가 같다 (오프셋 보존 계약 유지)', () => {
    const p = parseListPrefix('    - 항목')!;
    expect(p.display.length).toBe(p.raw.length);
    expect(p.display).toBe('    • ');
  });
});

describe('continueListMarker — 들여쓰기 유지·단계별 종료', () => {
  it('들여쓴 항목은 같은 단계로 이어진다', () => {
    expect(continueListMarker('  - 항목')).toEqual({ next: '  - ' });
    expect(continueListMarker('    3. 항목')).toEqual({ next: '    4. ' });
  });

  it('들여쓴 빈 마커 줄은 한 단계 내어쓰기(바로 사라지지 않는다)', () => {
    expect(continueListMarker('    - ')).toEqual({ end: true, replaceWith: '  - ' });
    expect(continueListMarker('  1. ')).toEqual({ end: true, replaceWith: '1. ' });
  });
});

describe('applyListOp — 들여쓰기 / 내어쓰기', () => {
  const apply = (text: string, edits: { at: number; remove: number; insert: string }[]) => {
    let out = text;
    [...edits].sort((x, y) => y.at - x.at).forEach((e) => {
      out = out.slice(0, e.at) + e.insert + out.slice(e.at + e.remove);
    });
    return out;
  };

  it('캐럿이 놓인 리스트 줄 하나를 들여쓴다', () => {
    const t = '- 하나\n- 둘';
    const edits = applyListOp(t, 8, 8, { type: 'indent', dir: 1 });
    expect(apply(t, edits)).toBe('- 하나\n  - 둘');
  });

  it('선택이 걸친 모든 줄을 함께 들여쓴다', () => {
    const t = '- 하나\n- 둘\n- 셋';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'indent', dir: 1 }))).toBe('  - 하나\n  - 둘\n  - 셋');
  });

  it('내어쓰기는 최상위(0단계)에서 멈춘다', () => {
    const t = '  - 하나';
    const once = apply(t, applyListOp(t, 0, 0, { type: 'indent', dir: -1 }));
    expect(once).toBe('- 하나');
    expect(applyListOp(once, 0, 0, { type: 'indent', dir: -1 })).toEqual([]); // 더 나갈 곳 없음 = 편집 없음
  });

  it('리스트가 아닌 줄은 들여쓰기에 반응하지 않는다', () => {
    expect(applyListOp('그냥 텍스트', 0, 0, { type: 'indent', dir: 1 })).toEqual([]);
  });

  it('들여쓰면 그 단계에서 번호가 새로 매겨진다', () => {
    const t = '1. 하나\n2. 둘\n3. 셋';
    // 둘째 줄만 들여쓰기 → 하위 목록의 첫 항목이므로 1., 남은 상위는 1., 2.로 정리
    const out = apply(t, applyListOp(t, 8, 8, { type: 'indent', dir: 1 }));
    expect(out).toBe('1. 하나\n  2. 둘\n2. 셋');
  });

  it('최대 단계를 넘지 않는다', () => {
    let t = '- 하나';
    for (let i = 0; i < 10; i++) t = apply(t, applyListOp(t, 0, 0, { type: 'indent', dir: 1 }));
    expect(t).toBe('            - 하나'); // 6단계 × 2칸
  });
});

describe('applyListOp — 글머리/번호 토글', () => {
  const apply = (text: string, edits: { at: number; remove: number; insert: string }[]) => {
    let out = text;
    [...edits].sort((x, y) => y.at - x.at).forEach((e) => {
      out = out.slice(0, e.at) + e.insert + out.slice(e.at + e.remove);
    });
    return out;
  };

  it('평문 줄에 글머리를 붙인다', () => {
    const t = '하나\n둘';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ul' }))).toBe('• 하나\n• 둘');
  });

  it('이미 전부 글머리면 마커를 벗긴다 (들여쓰기는 유지)', () => {
    const t = '  • 하나\n  • 둘';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ul' }))).toBe('  하나\n  둘');
  });

  it('번호 매기기는 순번을 자동으로 채운다', () => {
    const t = '하나\n둘\n셋';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ol' }))).toBe('1. 하나\n2. 둘\n3. 셋');
  });

  it('글머리 목록을 번호 목록으로 바꾼다', () => {
    const t = '• 하나\n• 둘';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ol' }))).toBe('1. 하나\n2. 둘');
  });

  it('섞여 있으면(일부만 글머리) 전부 글머리로 통일한다', () => {
    const t = '• 하나\n둘';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ul' }))).toBe('• 하나\n• 둘');
  });

  it('묶음의 시작 번호는 보존된다 (5.부터 시작하면 5,6,7)', () => {
    const t = '5. 다섯\n1. 여섯\n1. 일곱';
    expect(apply(t, applyListOp(t, 0, 0, { type: 'indent', dir: 1 }))).toBe('  5. 다섯\n1. 여섯\n2. 일곱');
  });
});

describe('shiftOffset', () => {
  it('접두가 늘어난 만큼 뒤쪽 오프셋을 민다', () => {
    const edits = [{ at: 0, remove: 2, insert: '    ' }]; // 2칸 → 4칸
    expect(shiftOffset(5, edits)).toBe(7);
    expect(shiftOffset(0, edits)).toBe(0);
  });

  it('접두 안쪽을 가리키던 오프셋은 새 접두 끝으로 모은다', () => {
    const edits = [{ at: 0, remove: 2, insert: '    ' }];
    expect(shiftOffset(1, edits)).toBe(4);
  });

  it('여러 줄 편집이 누적된다', () => {
    const edits = [
      { at: 0, remove: 0, insert: '  ' },
      { at: 10, remove: 0, insert: '  ' },
    ];
    expect(shiftOffset(12, edits)).toBe(16);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyListOp,
  bulletGlyphFor,
  continueListMarker,
  formatOrdinal,
  listBackspaceOp,
  listDisplayLine,
  ordinalStyleFor,
  parseListPrefix,
  parseOrdinal,
  shiftOffset,
} from './list';

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
    // 이어쓸 때는 표시 글리프로 통일한다(화면에 보이는 것과 저장되는 것이 같다).
    expect(continueListMarker('- 항목')).toEqual({ next: '• ' });
    expect(continueListMarker('* 항목')).toEqual({ next: '• ' });
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

// 표시용 들여쓰기는 EN SPACE(0.5em) — 일반 공백은 단계가 안 보일 만큼 좁다(제보).
// `raw`(저장)는 일반 공백 그대로이고 `display`에서만 1:1로 갈아 끼운다.
const EN = '\u2002';

describe('들여쓰기 — parseListPrefix.indent / pad', () => {
  it('마커 앞 공백 2칸이 한 단계', () => {
    expect(parseListPrefix('  - 항목')).toMatchObject({ indent: 1, pad: '  ', raw: '  - ', display: `${EN}${EN}◦ ` });
    expect(parseListPrefix('    1. 항목')).toMatchObject({ indent: 2, pad: '    ', raw: '    1. ' });
  });

  it('탭 하나도 한 단계로 센다', () => {
    expect(parseListPrefix('\t- 항목')).toMatchObject({ indent: 1 });
  });

  it('들여쓴 줄도 raw와 display의 길이가 같다 (오프셋 보존 계약 유지)', () => {
    const p = parseListPrefix('    - 항목')!;
    expect(p.display.length).toBe(p.raw.length);
    expect(p.display).toBe(`${EN.repeat(4)}▪ `); // 2단계 = 채운 사각형, 들여쓰기는 EN SPACE
  });
});

describe('continueListMarker — 들여쓰기 유지·단계별 종료', () => {
  it('들여쓴 항목은 같은 단계로 이어진다', () => {
    expect(continueListMarker('  - 항목')).toEqual({ next: `${EN}${EN}◦ ` }); // 1단계 글리프
    expect(continueListMarker('    iii. 항목')).toEqual({ next: '    iv. ' }); // 2단계 = 로마
  });

  it('들여쓴 빈 마커 줄은 한 단계 내어쓰기(바로 사라지지 않는다)', () => {
    expect(continueListMarker('    - ')).toEqual({ end: true, replaceWith: '  ◦ ' });
    // 비어 있던 `b.`(=2)를 내어쓰면 부모 목록의 2번을 이어받는다
    expect(continueListMarker('  b. ')).toEqual({ end: true, replaceWith: '2. ' });
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
    expect(apply(t, edits)).toBe('- 하나\n  ◦ 둘');
  });

  it('선택이 걸친 모든 줄을 함께 들여쓴다', () => {
    const t = '- 하나\n- 둘\n- 셋';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'indent', dir: 1 }))).toBe('  ◦ 하나\n  ◦ 둘\n  ◦ 셋');
  });

  it('내어쓰기는 최상위(0단계)에서 멈춘다', () => {
    const t = '  - 하나';
    const once = apply(t, applyListOp(t, 0, 0, { type: 'indent', dir: -1 }));
    expect(once).toBe('• 하나'); // 0단계 글리프
    expect(applyListOp(once, 0, 0, { type: 'indent', dir: -1 })).toEqual([]); // 더 나갈 곳 없음 = 편집 없음
  });

  it('리스트가 아닌 줄은 들여쓰기에 반응하지 않는다', () => {
    expect(applyListOp('그냥 텍스트', 0, 0, { type: 'indent', dir: 1 })).toEqual([]);
  });

  it('들여쓰면 그 단계에서 번호가 새로 매겨진다', () => {
    const t = '1. 하나\n2. 둘\n3. 셋';
    // 둘째 줄만 들여쓰기 → 하위 목록의 첫 항목이므로 1., 남은 상위는 1., 2.로 정리
    const out = apply(t, applyListOp(t, 8, 8, { type: 'indent', dir: 1 }));
    expect(out).toBe('1. 하나\n  a. 둘\n2. 셋');
  });

  it('최대 단계를 넘지 않는다', () => {
    let t = '- 하나';
    for (let i = 0; i < 10; i++) t = apply(t, applyListOp(t, 0, 0, { type: 'indent', dir: 1 }));
    expect(t).toBe('            • 하나'); // 6단계 × 2칸, 6 % 3 = 0 → 첫 글리프
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
    // 마지막 줄만 들여쓰고 나면 남은 묶음은 5부터 이어진다.
    const t = '5. 다섯\n1. 여섯\n1. 일곱';
    expect(apply(t, applyListOp(t, t.length, t.length, { type: 'indent', dir: 1 }))).toBe('5. 다섯\n6. 여섯\n  a. 일곱');
  });
});

describe('단계별 마커 — 3단계 주기(네 번째는 첫 번째로)', () => {
  const apply = (text: string, edits: { at: number; remove: number; insert: string }[]) => {
    let out = text;
    [...edits].sort((x, y) => y.at - x.at).forEach((e) => {
      out = out.slice(0, e.at) + e.insert + out.slice(e.at + e.remove);
    });
    return out;
  };

  it('글머리 글리프는 • → ◦ → ▪ 를 반복한다', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(bulletGlyphFor)).toEqual(['•', '◦', '▪', '•', '◦', '▪', '•']);
  });

  it('번호 표기는 decimal → alpha → roman 을 반복한다', () => {
    expect([0, 1, 2, 3].map(ordinalStyleFor)).toEqual(['decimal', 'alpha', 'roman', 'decimal']);
  });

  it('표기 변환: 1,2,3 / a,b,c / i,ii,iii', () => {
    expect([1, 2, 3, 26, 27].map((n) => formatOrdinal(n, 'decimal'))).toEqual(['1', '2', '3', '26', '27']);
    expect([1, 2, 3, 26, 27].map((n) => formatOrdinal(n, 'alpha'))).toEqual(['a', 'b', 'c', 'z', 'aa']);
    expect([1, 2, 3, 4, 9, 14].map((n) => formatOrdinal(n, 'roman'))).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv']);
  });

  it('표기를 다시 값으로 읽는다 (왕복)', () => {
    (['decimal', 'alpha', 'roman'] as const).forEach((style) => {
      for (const n of [1, 2, 3, 7, 12, 26, 27]) expect(parseOrdinal(formatOrdinal(n, style), style)).toBe(n);
    });
  });

  it('단계마다 문자 표기를 인식한다 — a. 는 1단계, i. 는 2단계에서만', () => {
    expect(parseListPrefix('  a. 항목')).toMatchObject({ kind: 'ol', indent: 1, raw: '  a. ' });
    expect(parseListPrefix('    ii. 항목')).toMatchObject({ kind: 'ol', indent: 2, raw: '    ii. ' });
    // 최상위의 평범한 문장이 목록이 되면 안 된다(그 단계 표기가 아니다)
    expect(parseListPrefix('a. 그리고 나서')).toBeNull();
    expect(parseListPrefix('  ii. 로마는 1단계 표기가 아니다')).toMatchObject({ kind: 'ol' }); // 1단계에선 alpha로 읽힘
    expect(parseListPrefix('    az. 로마가 아니다')).toBeNull(); // 2단계에서 잘못된 로마 표기
    // 숫자는 어느 단계에서나 목록이다(옛 문서·마크다운 호환)
    expect(parseListPrefix('    7. 항목')).toMatchObject({ kind: 'ol', indent: 2 });
  });

  it('들여쓸수록 글머리 글리프가 바뀐다 (• → ◦ → ▪ → •)', () => {
    let t = '- 하나';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      t = apply(t, applyListOp(t, t.length, t.length, { type: 'indent', dir: 1 }));
      seen.push(t.trimStart()[0] as string);
    }
    expect(seen).toEqual(['◦', '▪', '•', '◦']);
  });

  it('들여쓸수록 번호 표기가 바뀌고 하위 목록은 1부터 센다', () => {
    const t = '1. 하나\n2. 둘\n3. 셋';
    // 2·3번째 줄을 함께 들여쓰기 → 하위 목록 a, b
    const out = apply(t, applyListOp(t, 8, t.length, { type: 'indent', dir: 1 }));
    expect(out).toBe('1. 하나\n  a. 둘\n  b. 셋');
    // 다시 한 단계 더 → 로마
    const deeper = apply(out, applyListOp(out, 10, out.length, { type: 'indent', dir: 1 }));
    expect(deeper).toBe('1. 하나\n    i. 둘\n    ii. 셋');
  });

  it('내어쓰면 상위 단계 표기로 돌아가 이어 붙는다', () => {
    const t = '1. 하나\n  a. 둘\n  b. 셋';
    const out = apply(t, applyListOp(t, 14, t.length, { type: 'indent', dir: -1 })); // 마지막 줄만
    expect(out).toBe('1. 하나\n  a. 둘\n2. 셋');
  });

  it('들여쓴 자리에서 토글해도 그 단계 표기를 쓴다', () => {
    const t = '  하나\n  둘';
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ul' }))).toBe('  ◦ 하나\n  ◦ 둘');
    expect(apply(t, applyListOp(t, 0, t.length, { type: 'toggle', kind: 'ol' }))).toBe('  a. 하나\n  b. 둘');
  });

  it('단계가 바뀌어도 raw/display 길이 계약이 유지된다', () => {
    for (const line of ['  ◦ a', '    ▪ a', '  b. a', '    viii. a']) {
      const p = parseListPrefix(line)!;
      expect(p.display.length).toBe(p.raw.length);
    }
  });
});

describe('표시용 들여쓰기 폭 (EN SPACE)', () => {
  it('display의 들여쓰기만 EN SPACE로 바뀌고 raw는 일반 공백 그대로다', () => {
    const p = parseListPrefix('    1. 항목')!;
    expect(p.raw).toBe('    1. '); // 저장본은 그대로 — 이미 저장된 문서의 단계가 흔들리지 않는다
    expect(p.display).toBe(`${EN.repeat(4)}1. `); // 번호 표기는 저장된 그대로(치환은 들여쓰기만)
    expect(p.display.length).toBe(p.raw.length); // 1:1 치환 = 오프셋 계약 유지
  });

  it('표시된 그대로 커밋해도(EN SPACE가 저장돼도) 단계가 유지된다 — 왕복 안정', () => {
    const once = parseListPrefix('    - 항목')!;
    const committed = once.display + '항목';
    const again = parseListPrefix(committed)!;
    expect(again.indent).toBe(once.indent);
    expect(again.display).toBe(once.display);
  });

  it('EN SPACE로 들여쓴 줄도 들여쓰기/내어쓰기가 된다', () => {
    const t = `${EN}${EN}◦ 하나`;
    const edits = applyListOp(t, t.length, t.length, { type: 'indent', dir: 1 });
    const out = edits.reduce((acc, e) => acc.slice(0, e.at) + e.insert + acc.slice(e.at + e.remove), t);
    expect(parseListPrefix(out)!.indent).toBe(2);
  });
});

// 제보: 번호 매기기 → 줄바꿈(2. 생성) → Backspace를 누르면 `2. `가 `2.`가 되면서
// 그 줄이 리스트에서 빠지고 평문 정렬을 따라 옆으로 튀어 "Tab이 걸린 것처럼" 보인다.
// 마커는 한 덩어리로 다룬다 — 들여쓴 줄은 내어쓰기, 최상위 줄은 마커 제거.
describe('listBackspaceOp — 마커 안에서의 Backspace', () => {
  it('최상위 마커 뒤에서는 마커를 없앤다', () => {
    const t = '1. 하나\n2. ';
    expect(listBackspaceOp(t, t.length)).toEqual({ type: 'toggle', kind: 'ol' });
    expect(listBackspaceOp('• 하나', 2)).toEqual({ type: 'toggle', kind: 'ul' });
  });

  it('들여쓴 마커 뒤에서는 한 단계 내어쓴다', () => {
    const t = '1. 하나\n  a. ';
    expect(listBackspaceOp(t, t.length)).toEqual({ type: 'indent', dir: -1 });
  });

  it('마커 중간(들여쓰기 공백 안 포함)에서도 같게 동작한다', () => {
    const t = '  a. 하나';
    expect(listBackspaceOp(t, 1)).toEqual({ type: 'indent', dir: -1 }); // 들여쓰기 공백 안
    expect(listBackspaceOp(t, 3)).toEqual({ type: 'indent', dir: -1 }); // 숫자/기호 뒤
  });

  it('줄 맨 앞과 마커 밖에서는 기본 삭제(null)', () => {
    const t = '1. 하나\n2. 둘';
    expect(listBackspaceOp(t, 0)).toBeNull(); // 문서 맨 앞
    expect(listBackspaceOp(t, 6)).toBeNull(); // 둘째 줄 맨 앞(마커 앞) = 앞 줄과 합치기
    expect(listBackspaceOp(t, t.length)).toBeNull(); // 내용 안
    expect(listBackspaceOp('평문', 2)).toBeNull();
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

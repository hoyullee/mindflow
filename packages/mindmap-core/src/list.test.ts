import { describe, expect, it } from 'vitest';
import { continueListMarker, listDisplayLine, parseListPrefix } from './list';

describe('parseListPrefix', () => {
  it('글머리 마커(-, *, •)를 인식하고 표시는 • 로 통일한다', () => {
    expect(parseListPrefix('- 항목')).toEqual({ kind: 'ul', raw: '- ', display: '• ' });
    expect(parseListPrefix('* 항목')).toEqual({ kind: 'ul', raw: '* ', display: '• ' });
    expect(parseListPrefix('• 항목')).toEqual({ kind: 'ul', raw: '• ', display: '• ' });
  });

  it('번호 마커(1. / 1))를 인식하고 표시는 입력 그대로', () => {
    expect(parseListPrefix('1. 첫째')).toEqual({ kind: 'ol', raw: '1. ', display: '1. ' });
    expect(parseListPrefix('12) 항목')).toEqual({ kind: 'ol', raw: '12) ', display: '12) ' });
  });

  it('raw와 display의 글자 수가 같다 — rich 런 오프셋 보존 계약', () => {
    for (const line of ['- a', '* a', '• a', '3. a', '42) a']) {
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
    expect(continueListMarker('- ')).toEqual({ end: true });
    expect(continueListMarker('3. ')).toEqual({ end: true });
    expect(continueListMarker('-  ')).toEqual({ end: true }); // 공백뿐인 내용도 빈 것으로
  });

  it('리스트 줄이 아니면 null', () => {
    expect(continueListMarker('평문')).toBeNull();
    expect(continueListMarker('')).toBeNull();
  });
});

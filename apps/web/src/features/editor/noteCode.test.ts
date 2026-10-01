// 코드 블록의 문법 색칠 — 조각을 나누는 규칙(요청 7).
//
// 여기서 지키는 것 둘: **색은 클래스로만** 실린다(인라인 `color`는 `domToRuns`가
// 문서 값으로 읽어 저장해 버린다) · 글자는 **한 자도 잃지 않는다**(칠은 표시일 뿐이라
// 왕복이 깨지면 코드가 바뀐다).

import { describe, expect, it } from 'vitest';
import { codeHtml, codePieces } from './noteCode';

const kinds = (src: string) => codePieces(src).map((p) => [p.k, p.t]);

describe('코드 조각 나누기', () => {
  it('주석·문자열·수·예약어·부르는 이름을 가른다', () => {
    expect(kinds('const n = 1; // 메모')).toEqual([
      ['kw', 'const'],
      [null, ' n '],
      ['op', '='],
      [null, ' '],
      ['nu', '1'],
      ['op', ';'],
      [null, ' '],
      ['cm', '// 메모'],
    ]);
  });

  it('문자열 **안**의 `//`는 주석이 아니다', () => {
    expect(kinds('"https://a.b"')).toEqual([['st', '"https://a.b"']]);
  });

  it('닫히지 않은 여러 줄 주석은 끝까지 — 고치는 중에는 흔한 상태다', () => {
    expect(kinds('/* 여는 중\n다음 줄')).toEqual([['cm', '/* 여는 중\n다음 줄']]);
  });

  it('부르는 이름은 뒤에 `(`가 올 때만', () => {
    expect(kinds('run(x)')).toEqual([
      ['fn', 'run'],
      ['op', '('],
      [null, 'x'],
      ['op', ')'],
    ]);
    expect(kinds('run x')).toEqual([[null, 'run x']]);
  });

  it('그린 HTML은 **클래스만** 싣고 글자를 잃지 않는다', () => {
    const src = 'if (a < b) { say("<b>") } // 끝';
    const html = codeHtml(src);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('color:');
    // `<`·`>`·`&`는 이스케이프되고 나머지 글자는 그대로다.
    const back = html
      .replace(/<br>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(back).toBe(src);
  });

  it('끝이 줄바꿈이면 **보초 `<br>`**을 하나 더 붙인다 — 그 빈 줄이 그려져야 캐럿이 보인다', () => {
    expect(codeHtml('a\n').endsWith('<br><br>')).toBe(true);
    expect(codeHtml('a').endsWith('<br>')).toBe(false);
  });
});

/**
 * 요청 — 노션의 코드 블록은 한글 메모를 적어도 일부 낱말에 색이 든다(첨부 그림의 KR1·SQA·
 * 분모:·기간( ·'품질검토'·->). 노션(Prism)은 이름 글자에 한글까지 넣는다.
 */
describe('한글 메모도 구조가 색으로 드러난다(노션과 같은 규칙)', () => {
  const pick = (src: string, k: string) => codePieces(src).filter((p) => p.k === k).map((p) => p.t.trim());

  it('대문자 이름은 상수 — `KR1`·`SQA` (한 글자 `I`·`A`는 뺀다)', () => {
    expect(pick('KR1. SQA 등록 건 수 중 I A', 'cn')).toEqual(['KR1', 'SQA']);
  });

  it('뒤가 `(`인 한글 낱말은 부르는 이름 — `기간(`·`품질점검(`·`수(`', () => {
    expect(pick('KR2. SQA 수행 기간(1차~n차)의 평균', 'fn')).toEqual(['기간']);
    expect(pick('분모: 품질점검(SQA) 등록 건수', 'fn')).toEqual(['품질점검']);
    expect(pick('분모: Defect 수(not issue 제외) + 배포후이슈', 'fn')).toEqual(['수']);
  });

  it('줄 머리·쉼표 뒤에 오고 뒤가 `:`면 속성 이름 — `분모:`·`분자:`', () => {
    expect(pick("분모: 품질점검(SQA) 등록 건수, 분자: '품질검토' 필터", 'pr')).toEqual(['분모', '분자']);
    // 문장 가운데의 `:`나 `::`는 속성이 아니다.
    expect(pick('비율은 a: b', 'pr')).toEqual([]);
    expect(pick('std::vector', 'pr')).toEqual([]);
  });

  it('문자열·수·기호는 예전처럼 — 한글 뒤의 수는 이름의 일부다', () => {
    const src = "'수행 못 함'을 제외한 건 -> (1차~n차) 건수1";
    expect(pick(src, 'st')).toEqual(["'수행 못 함'"]);
    expect(pick(src, 'nu')).toEqual(['1']); // `1차`의 1 — `건수1`의 1은 이름에 붙는다
    expect(pick(src, 'op').join('')).toContain('->');
  });

  it('글자는 한 자도 잃지 않는다', () => {
    const src = "KR1. SQA 등록\n분모: 품질점검(SQA), 분자: '품질검토' ->";
    expect(codePieces(src).map((p) => p.t).join('')).toBe(src);
  });
});

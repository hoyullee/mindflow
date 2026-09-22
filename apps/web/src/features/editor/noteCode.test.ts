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

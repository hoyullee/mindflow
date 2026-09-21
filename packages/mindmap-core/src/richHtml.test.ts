import { describe, expect, it } from 'vitest';
import { clipLinesToHtml, runsToClipHtml } from './richHtml';

describe('클립보드 HTML — 나가는 길은 의미 태그와 인라인 style만(제보 12)', () => {
  it('서식은 **클래스가 아니라** 태그·style로 나간다 — 클래스는 클립보드를 따라가지 않는다', () => {
    const html = runsToClipHtml([
      { t: '굵게', b: true, c: null },
      { t: '색', b: false, c: '#E0632F' },
      { t: '형광', b: false, c: null, hl: 'yellow' },
      { t: '코드', b: false, c: null, k: true },
    ]);
    expect(html).toContain('<strong>굵게</strong>');
    expect(html).toContain('color:#E0632F');
    expect(html).toContain('background-color:#');
    expect(html).toContain('<code');
    expect(html).not.toContain('class=');
  });

  it('링크는 **진짜 `<a href>`**다 — 받는 앱이 누를 수 있어야 한다', () => {
    const html = runsToClipHtml([{ t: '여기', b: false, c: null, href: 'geurio.com' }]);
    expect(html).toMatch(/<a href="https:\/\/geurio\.com\/?">여기<\/a>/);
  });

  it('속성값의 따옴표를 막는다 — `escHtml`은 막지 않는다', () => {
    expect(runsToClipHtml([{ t: 'x', b: false, c: '"><script>' }])).not.toContain('"><script>');
  });

  it('목록은 `<ul>`/`<ol>`로 묶이고 단계는 **중첩**이다 — `- ` 글자로는 문장이 된다', () => {
    const html = clipLinesToHtml([
      { kind: 'ul', runs: null, text: '하나', depth: 0 },
      { kind: 'ul', runs: null, text: '하나의 안', depth: 1 },
      { kind: 'ul', runs: null, text: '둘', depth: 0 },
    ]);
    expect(html).toBe('<ul><li>하나</li><ul><li>하나의 안</li></ul><li>둘</li></ul>');
  });

  it('번호 목록은 **이어세던 번호**에서 시작한다', () => {
    expect(clipLinesToHtml([{ kind: 'ol', runs: null, text: '셋째', depth: 0, num: 3 }])).toBe('<ol start="3"><li>셋째</li></ol>');
  });

  it('글머리에서 번호로 바뀌면 목록을 **다시 연다**', () => {
    const html = clipLinesToHtml([
      { kind: 'ul', runs: null, text: 'a', depth: 0 },
      { kind: 'ol', runs: null, text: 'b', depth: 0 },
    ]);
    expect(html).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('체크리스트는 상자 글자를 앞에 둔다 — HTML 목록에 체크 상태가 없다', () => {
    const html = clipLinesToHtml([
      { kind: 'ck', runs: null, text: '했다', depth: 0, done: true },
      { kind: 'ck', runs: null, text: '아직', depth: 0, done: false },
    ]);
    expect(html).toBe('<ul><li>☑ 했다</li><li>☐ 아직</li></ul>');
  });

  it('제목·인용·코드는 제 태그로 — 코드 안의 줄바꿈은 `<br>`이 아니다(두 줄이 된다)', () => {
    expect(clipLinesToHtml([{ kind: 'h2', runs: null, text: '머리' }])).toBe('<h2>머리</h2>');
    expect(clipLinesToHtml([{ kind: 'quote', runs: null, text: '인용' }])).toBe('<blockquote>인용</blockquote>');
    const code = clipLinesToHtml([{ kind: 'code', runs: null, text: 'a\nb' }]);
    expect(code).toContain('<pre');
    expect(code).not.toContain('<br>');
  });

  it('빈 문단도 자리를 지킨다 — 붙여넣으면 줄이 하나 줄어 있으면 안 된다', () => {
    expect(clipLinesToHtml([{ kind: 'p', runs: null, text: '' }])).toBe('<p><br></p>');
  });
});

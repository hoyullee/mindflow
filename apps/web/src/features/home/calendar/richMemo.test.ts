import { describe, expect, it } from 'vitest';
import { looksLikeHtml, memoHtml, memoPlainText, sanitizeMemoHtml, textToMemoHtml } from './richMemo';

// 메모는 HTML로 저장된다(구글의 `description`이 원래 HTML이다) — 남이 만든 일정의
// 메모가 그대로 우리 화면에 들어오므로 **위생 처리가 곧 보안 경계**다.

describe('일정 메모 HTML', () => {
  it('허용 목록 밖 태그는 벗기되 글자는 남긴다', () => {
    expect(sanitizeMemoHtml('<b>굵게</b> <script>alert(1)</script>보통')).toBe('<b>굵게</b> alert(1)보통');
    expect(sanitizeMemoHtml('<ul><li>하나</li></ul>')).toBe('<ul><li>하나</li></ul>');
    // 스타일·클래스 같은 속성은 남기지 않는다.
    expect(sanitizeMemoHtml('<b style="color:red" onclick="x()">굵게</b>')).toBe('<b>굵게</b>');
  });

  it('열 수 없는 주소의 링크는 값에 들어가지 못한다', () => {
    expect(sanitizeMemoHtml('<a href="javascript:alert(1)">눌러</a>')).toBe('눌러');
    const ok = sanitizeMemoHtml('<a href="https://example.com">사이트</a>');
    // `normalizeUrl`이 주소를 정규화한다(끝의 `/`).
    expect(ok).toContain('href="https://example.com/"');
    // 남의 메모에 걸린 링크가 우리 창을 조종하지 못하게.
    expect(ok).toContain('rel="noopener noreferrer"');
    expect(ok).toContain('target="_blank"');
  });

  it('옛 값(평문)은 그대로 평문이다 — 줄바꿈만 옮긴다', () => {
    expect(looksLikeHtml('그냥 메모')).toBe(false);
    expect(textToMemoHtml('한 줄\n두 줄')).toBe('한 줄<br>두 줄');
    expect(memoHtml('a < b')).toBe('a &lt; b');
    expect(memoHtml('<b>굵게</b>')).toBe('<b>굵게</b>');
  });

  it('평문 뽑기 — 목록·미리보기가 태그를 그대로 보여 주지 않게', () => {
    expect(memoPlainText('<ul><li>하나</li><li>둘</li></ul>')).toBe('하나\n둘');
    expect(memoPlainText('평문')).toBe('평문');
  });
});

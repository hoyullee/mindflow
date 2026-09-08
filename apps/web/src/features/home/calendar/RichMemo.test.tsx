import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RichMemo } from './RichMemo';
import { memoHtml, sanitizeMemoHtml } from './richMemo';

// 제보: 메모에 **띄어쓰기**를 치면 화면에 `&nbsp;`가 글자로 나타나고, 그 뒤 한글을
// 입력하면 자음·모음이 분리되어 적혔다.
//
// 원인 둘이 겹쳐 있었다:
//  ① 브라우저는 띄어쓰기를 줄바꿈 없는 공백(U+00A0)으로 넣고 `innerHTML`은 그것을
//     `&nbsp;`로 직렬화한다.
//     그 값에는 태그가 없어서 `looksLikeHtml`이 **평문으로 판정**했고, 되돌릴 때
//     `escapeHtml`이 `&`를 다시 escape해 `&amp;nbsp;` → 화면에 `&nbsp;`가 보였다
//     (게다가 입력마다 한 겹씩 자란다).
//  ② 값이 어긋나니 `value` 효과가 **입력마다 `innerHTML`을 다시 심었고**, 그것이
//     IME 조합을 끊어 한글을 자모로 쪼갰다.

/** 값을 실제로 들고 되돌려 주는 부모 — 제보 흐름은 이 왕복에서 났다. */
function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <RichMemo value={v} onChange={setV} attr="data-note" />
      <output data-value>{v}</output>
    </>
  );
}

// 이 프로젝트의 vitest는 globals를 켜지 않아 자동 정리가 없다 — 남은 DOM이 다음
// 테스트의 `querySelector`에 먼저 잡힌다.
afterEach(cleanup);

const box = (): HTMLElement => document.querySelector('[data-note]') as HTMLElement;
const stored = (): string => (screen.getByText((_, el) => el?.hasAttribute('data-value') === true).textContent ?? '');

/** 브라우저가 하는 일을 흉내 낸다 — 타이핑은 DOM을 바꾸고 `input`을 쏜다. */
function type(html: string): void {
  box().innerHTML = html;
  fireEvent.input(box());
}

describe('일정 메모 편집기 — 띄어쓰기·한글(제보)', () => {
  it('띄어쓰기를 치면 `&nbsp;`가 글자로 보이지 않는다 — 왕복이 항등이다', () => {
    render(<Harness />);
    type('가 '); // 브라우저가 넣는 그 문자
    // 저장된 값은 HTML로 온전하고,
    expect(stored()).toBe('가&nbsp;');
    // 되돌려 심어도 escape가 겹치지 않는다(예전엔 `가&amp;nbsp;`가 됐다).
    expect(memoHtml(stored())).toBe('가&nbsp;');
    // 화면 글자에는 `&nbsp;`라는 문자열이 없다.
    expect(box().textContent).not.toContain('&nbsp;');
    expect(box().textContent).toBe('가 ');
  });

  it('입력이 되돌아와도 DOM을 다시 심지 않는다 — IME 조합이 끊기지 않는 조건', () => {
    render(<Harness />);
    type('\u00A0');
    // 여기서부터는 **브라우저처럼** 기존 텍스트 노드를 고친다(innerHTML 통째 교체가
    // 아니다). 컴포넌트가 값을 되받아 다시 심으면 이 노드가 갈리므로, 노드 동일성이
    // 곧 "다시 심지 않았다"는 증거다 — 그 재심기가 IME 조합을 끊던 원인이다.
    const t = box().firstChild as Text;
    t.data = '가\u00A0나';
    fireEvent.input(box());
    expect(box().firstChild).toBe(t);
    expect(box().textContent).toBe('가\u00A0나');
  });

  it('조합 중에는 밖에서 온 값도 미루고, 확정된 뒤에 반영한다', () => {
    const { rerender } = render(<RichMemo value="처음" onChange={vi.fn()} attr="data-note" />);
    expect(box().innerHTML).toBe('처음');
    fireEvent.compositionStart(box());
    rerender(<RichMemo value="밖에서 바뀜" onChange={vi.fn()} attr="data-note" />);
    expect(box().innerHTML).toBe('처음'); // 조합을 끊지 않는다
    fireEvent.compositionEnd(box());
    expect(box().innerHTML).toBe('밖에서 바뀜');
  });

  it('밖에서 값이 바뀌면(다른 일정을 열었을 때) 다시 심는다', () => {
    const { rerender } = render(<RichMemo value="<b>가</b>" onChange={vi.fn()} attr="data-note" />);
    expect(box().innerHTML).toBe('<b>가</b>');
    rerender(<RichMemo value="<i>나</i>" onChange={vi.fn()} attr="data-note" />);
    expect(box().innerHTML).toBe('<i>나</i>');
  });

  it('위생 처리의 왕복은 항등이다 — 어긋나면 그 자리에서 DOM이 다시 심긴다', () => {
    for (const v of ['가 ', '<b>굵게</b> 뒤', '<ul><li>하나</li></ul>', 'a &lt; b', '가&nbsp;&nbsp;나']) {
      const once = sanitizeMemoHtml(v);
      expect(memoHtml(once)).toBe(once);
    }
  });
});

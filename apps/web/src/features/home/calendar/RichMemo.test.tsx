import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('폰 — 메모 서식 막대(모바일 홈 디자인 N8)', () => {
  // 폰 판은 `matchMedia`(폭)와 `execCommand`(서식을 걸 수 있는가)가 있어야 선다 — jsdom에는 둘 다 없다.
  const realExec = (document as Document & { execCommand?: unknown }).execCommand;
  const realState = (document as Document & { queryCommandState?: unknown }).queryCommandState;
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
    Object.assign(document, { execCommand: vi.fn(() => true), queryCommandState: vi.fn(() => false) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(document, { execCommand: realExec, queryCommandState: realState });
  });

  const dock = (): HTMLElement | null => document.querySelector('[data-memo-dock]');
  const cmd = (k: string): HTMLElement => document.querySelector(`[data-memo-dock] [data-memo-cmd="${k}"]`) as HTMLElement;
  /** 정말로 초점을 준다 — jsdom은 `focus()`가 선택을 상자 맨 앞으로 옮기고 React의 `focusin`은 쏘지 않는다. */
  function focusBox(): void {
    box().focus();
    fireEvent.focusIn(box());
  }
  /** 상자 안의 글자를 고른다 — 브라우저에서 손가락으로 끄는 것과 같은 선택. */
  function select(node: Node, start: number, end = start): void {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  it('커서가 있을 때만 키보드 위에 선다 — 상자 위의 도구 줄은 없고, 키보드 내리기로 닫힌다', () => {
    render(<RichMemo value="" onChange={vi.fn()} attr="data-note" hint="형광펜·체크리스트는 Geurio 안에서만 보여요" />);
    expect(document.querySelector('[data-memo-toolbar]')).toBeNull();
    expect(dock()).toBeNull();
    expect(document.querySelector('[data-memo-hint]')).toBeNull();
    fireEvent.focusIn(box());
    expect(dock()).toBeTruthy();
    expect([...dock()!.querySelectorAll('[data-memo-cmd]')].map((b) => b.getAttribute('aria-label'))).toEqual(['굵게', '기울임', '밑줄', '형광펜', '글머리 목록', '체크리스트', '링크']);
    expect(document.querySelector('[data-memo-hint]')?.textContent).toContain('Geurio 안에서만');
    fireEvent.focusOut(box());
    expect(dock()).toBeNull();
    expect(document.querySelector('[data-memo-hint]')).toBeNull();
  });

  it('형광펜은 고른 글자를 `<mark>`로 감싸고, 다시 누르면 걷는다', () => {
    render(<Harness initial="가나다라" />);
    focusBox();
    select(box().firstChild!, 1, 3);
    fireEvent.click(cmd('mark'));
    expect(box().innerHTML).toBe('가<mark>나다</mark>라');
    expect(stored()).toBe('가<mark>나다</mark>라');
    expect(cmd('mark').getAttribute('aria-pressed')).toBe('true');
    // 칠한 범위가 다시 골라져 있다 — 한 번 더 누르면 걷힌다.
    fireEvent.click(cmd('mark'));
    expect(box().querySelector('mark')).toBeNull();
    expect(box().textContent).toBe('가나다라');
  });

  it('목록 여러 줄을 골라도 `<mark>`가 블록을 감싸지 않는다 — 줄마다 칠한다', () => {
    render(<Harness initial="<ul><li>하나</li><li>둘</li></ul>" />);
    focusBox();
    const [a, b] = [...box().querySelectorAll('li')];
    const r = document.createRange();
    r.setStart(a!.firstChild!, 1);
    r.setEnd(b!.firstChild!, 1);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    fireEvent.click(cmd('mark'));
    expect(box().innerHTML).toBe('<ul><li>하<mark>나</mark></li><li><mark>둘</mark></li></ul>');
  });

  it('체크리스트 — 글머리 목록에 표식을 달고, 네모를 누르면 끝냄이 뒤집힌다(빈 항목은 끝낼 수 없다)', () => {
    render(<Harness initial="<ul><li>하나</li><li>둘</li></ul>" />);
    focusBox();
    const li = box().querySelector('li')!;
    select(li.firstChild!, 1);
    // 글머리 목록 안이다 — 켜진 칸은 `글머리 목록`.
    expect(cmd('ul').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(cmd('check'));
    expect(stored()).toBe('<ul data-check=""><li>하나</li><li>둘</li></ul>');
    expect(cmd('check').getAttribute('aria-pressed')).toBe('true');
    expect(cmd('ul').getAttribute('aria-pressed')).toBe('false');
    // 네모는 항목 상자의 **왼쪽 여백**이다 — 그보다 왼쪽을 누르면 뒤집힌다(jsdom의 상자는 0이라 x<0).
    fireEvent.mouseDown(li, { clientX: -10 });
    expect(stored()).toBe('<ul data-check=""><li data-done="">하나</li><li>둘</li></ul>');
    // 글자 쪽을 누르면 캐럿을 옮길 뿐이다.
    fireEvent.mouseDown(li, { clientX: 5 });
    expect(stored()).toContain('<li data-done="">하나</li>');
    // 글머리 목록으로 되돌리면 표식만 빠진다(줄은 그대로).
    fireEvent.click(cmd('ul'));
    expect(stored()).toBe('<ul><li data-done="">하나</li><li>둘</li></ul>');
    // Enter가 끝낸 항목을 복제해 만든 빈 줄은 끝냄 표식을 잃는다.
    type('<ul data-check=""><li data-done="">하나</li><li data-done=""><br></li></ul>');
    expect(stored()).toBe('<ul data-check=""><li data-done="">하나</li><li><br></li></ul>');
  });

  it('위생 처리 — 형광펜과 체크리스트 표식은 남고, 표식의 값·다른 속성·다른 태그의 표식은 지운다', () => {
    expect(sanitizeMemoHtml('<ul data-check="x" onclick="y"><li data-done="1" class="z">a</li></ul><mark style="color:red">m</mark>')).toBe('<ul data-check=""><li data-done="">a</li></ul><mark>m</mark>');
    expect(sanitizeMemoHtml('<ol data-check=""><li>a</li></ol><p data-done="">b</p>')).toBe('<ol><li>a</li></ol><p>b</p>');
    const once = sanitizeMemoHtml('<ul data-check=""><li data-done="">a</li></ul><mark>m</mark>');
    expect(memoHtml(once)).toBe(once);
  });
});

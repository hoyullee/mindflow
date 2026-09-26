import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypingStyle, stripBrowserFormatting } from './noteRichDom';

/**
 * 브라우저가 기억하는 **타이핑 스타일**을 지우는 일(제보 5).
 *
 * 제보: 빈 줄에 서식을 켜고 글을 친 뒤 Shift+Home으로 그 줄을 통째로 지우면 툴바
 * 단추는 꺼지는데 **다시 치면 서식이 살아나** 끌 방법이 없다. 실브라우저에서 갈라
 * 본 원인은 크로뮴의 타이핑 스타일이다 — 지운 선택의 서식을 "다음에 칠 글자"에
 * 물려준다. 우리 서식은 언제나 `<span style>`인데 되살아난 글자는 `<b>`였다.
 *
 * jsdom에는 `execCommand`가 없다. 여기서 보는 것은 **부르는 규칙**이다:
 * 켜져 있다고 답하는 것만 토글해 끈다 · 접힌 선택이 아니면 손대지 않는다.
 * (실제로 꺼지는지는 프로브가 봤다 — 지운 뒤 다시 친 글자가 `<b>` 없이 들어왔다.)
 */
describe('타이핑 스타일 비우기(제보 5)', () => {
  let exec: ReturnType<typeof vi.fn>;
  let state: Record<string, boolean>;

  beforeEach(() => {
    document.body.innerHTML = '';
    state = {};
    exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    (document as unknown as { queryCommandState: unknown }).queryCommandState = (cmd: string) => !!state[cmd];
  });
  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    delete (document as unknown as { queryCommandState?: unknown }).queryCommandState;
  });

  /** 빈 줄 하나에 접힌 캐럿을 둔다 — 글을 지운 직후의 상태다. */
  function emptyLine(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = '<br>';
    document.body.appendChild(el);
    const r = document.createRange();
    r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return el;
  }

  it('켜져 있는 서식만 토글해 끈다', () => {
    const el = emptyLine();
    state.bold = true;
    state.underline = true;
    resetTypingStyle(el);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['bold', 'underline']);
  });

  it('켜진 것이 없으면 아무 명령도 걸지 않는다 — 멀쩡한 상태를 뒤집지 않는다', () => {
    const el = emptyLine();
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('네 가지를 모두 본다 — 굵게·기울임·밑줄·취소선', () => {
    const el = emptyLine();
    state.bold = true;
    state.italic = true;
    state.underline = true;
    state.strikeThrough = true;
    resetTypingStyle(el);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['bold', 'italic', 'underline', 'strikeThrough']);
  });

  it('**캐럿이 그 줄에 없으면** 손대지 않는다 — 남의 선택을 건드리는 함수가 아니다', () => {
    const el = emptyLine();
    const other = document.createElement('div');
    other.textContent = '다른 곳';
    document.body.appendChild(other);
    const r = document.createRange();
    r.selectNodeContents(other);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    state.bold = true;
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('선택이 **펼쳐져 있으면** 손대지 않는다 — 그건 글에 거는 서식이지 타이핑 스타일이 아니다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.textContent = '가나다';
    document.body.appendChild(el);
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    state.bold = true;
    resetTypingStyle(el);
    expect(exec).not.toHaveBeenCalled();
  });

  it('`execCommand`가 없는 환경에서도 터지지 않는다', () => {
    const el = emptyLine();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    state.bold = true;
    expect(() => resetTypingStyle(el)).not.toThrow();
  });
});

/**
 * 브라우저가 남긴 **서식 잔재**를 걷는 일(제보 6).
 *
 * 실측한 그대로의 DOM으로 잰다 — 인라인 코드를 지우고 다시 친 자리에서 크로뮴이
 * 만들어 놓은 마크업이다(`<font color> + <span style="background-color;font-size">`).
 * 그대로 두면 `domToRuns`가 그 색을 **값**으로 읽어 붉은 글자가 저장된다.
 */
describe('브라우저 잔재 걷기(제보 6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function box(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  /** 크로뮴이 실제로 만든 것 — 프로브가 찍어 온 마크업 그대로다. */
  const JUNK =
    '<font color="#c44b40" face="ui-monospace, SFMono-Regular, monospace">' +
    '<span style="font-size: 13.34px; background-color: rgb(244, 237, 228);">AGAIN</span></font>';

  it('`<font>`을 풀고 인라인 배경·글꼴·크기를 지운다 — 글자는 그대로', () => {
    const el = box(`앞글 ${JUNK}`);
    expect(stripBrowserFormatting(el)).toBe(true);
    expect(el.textContent).toBe('앞글 AGAIN');
    expect(el.querySelector('font')).toBeNull();
    expect(el.innerHTML).not.toContain('background-color');
    expect(el.innerHTML).not.toContain('font-family');
    expect(el.innerHTML).not.toContain('font-size');
    // 값으로 새어 나가던 그 색이 사라졌다 — `domToRuns`가 읽을 `color`가 없다.
    expect(el.innerHTML).not.toContain('#c44b40');
  });

  it('**우리 마크업은 건드리지 않는다** — 고른 글자색·굵게·인라인 코드는 그대로', () => {
    const el = box('<span style="color:#3f8fd0">파란 글</span><span style="font-weight:800">굵게</span><code>코드</code>');
    expect(stripBrowserFormatting(el)).toBe(false);
    expect(el.querySelector('[style*="color"]')?.textContent).toBe('파란 글');
    expect(el.querySelector('[style*="font-weight"]')?.textContent).toBe('굵게');
    expect(el.querySelector('code')?.textContent).toBe('코드');
  });

  it('`<font>` 안의 색만 사라진다 — **우리가 만들지 않는 요소**라 그 안의 값은 잔재다', () => {
    const el = box('<font color="#c44b40">잔재</font><span style="color:#3f8fd0">내 색</span>');
    stripBrowserFormatting(el);
    expect(el.innerHTML).not.toContain('#c44b40');
    expect(el.innerHTML).toContain('#3f8fd0');
  });

  it('선언이 다 사라진 빈 스팬은 통째로 푼다 — 껍데기가 쌓이지 않게', () => {
    const el = box('<span style="background-color: rgb(244,237,228);">글</span>');
    stripBrowserFormatting(el);
    expect(el.querySelector('span')).toBeNull();
    expect(el.textContent).toBe('글');
  });

  it('걷을 것이 없으면 DOM을 만지지 않는다', () => {
    const el = box('그냥 글');
    const before = el.innerHTML;
    expect(stripBrowserFormatting(el)).toBe(false);
    expect(el.innerHTML).toBe(before);
  });
});

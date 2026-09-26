import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypingStyle } from './noteRichDom';

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

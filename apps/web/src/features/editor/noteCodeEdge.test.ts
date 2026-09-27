import { beforeEach, describe, expect, it } from 'vitest';
import { codeEdgeStep } from './noteCodeEdge';
import { runsToHtml } from './richtextDom';
import { charOffset } from './noteTextSelect';

/**
 * 인라인 코드의 **경계에서 캐럿이 서는 자리**(제보 5).
 *
 * 실브라우저로 잰 크로뮴의 성질은 「경계를 한 자리로 접는다」이고(모듈 머리말의 표),
 * 여기서 지키는 것은 **우리가 그 자리를 둘로 벌린다**는 사실이다. jsdom에는 캐럿을
 * 그리는 엔진이 없으므로 재는 것은 하나 — `codeEdgeStep`이 캐럿을 **어느 노드 안에**
 * 놓는가. 그 값이 곧 다음에 칠 글자의 서식이라 사람이 보는 것과 같은 것을 잰다.
 */
const TEXT = (t: string) => ({ t, b: false, c: null });
const CODE = (t: string) => ({ t, b: false, c: null, k: true });

function line(rich: { t: string; b: boolean; c: null; k?: boolean }[]): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = runsToHtml({ text: '', rich });
  document.body.appendChild(el);
  return el;
}

/** 캐럿을 **노드로 지정해** 놓는다 — 값 좌표로 놓으면 안·밖을 고를 수 없다. */
function put(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** 지금 캐럿이 선 자리 — `값 좌표 · 코드 안인가`. */
function where(el: HTMLElement): { at: number; code: boolean } {
  const sel = window.getSelection()!;
  const host = sel.focusNode!.nodeType === 1 ? (sel.focusNode as HTMLElement) : sel.focusNode!.parentElement;
  return { at: charOffset(el, sel.focusNode!, sel.focusOffset), code: !!host?.closest?.('code') };
}

const codeText = (el: HTMLElement): Text => el.querySelector('code')!.firstChild as Text;

describe('인라인 코드 경계의 캐럿 정거장', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('코드 **안의 끝**에서 → 는 코드 **밖**으로(값 좌표는 그대로)', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 2); // 코드 안, 끝
    expect(codeEdgeStep(el, 1)).toBe('out');
    expect(where(el)).toEqual({ at: 4, code: false });
  });

  it('코드 **밖의 뒤 경계**에서 ← 는 코드 **안**으로', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(el.lastChild!, 0); // 코드 바로 뒤(밖)
    expect(codeEdgeStep(el, -1)).toBe('in');
    expect(where(el)).toEqual({ at: 4, code: true });
  });

  it('코드 **밖의 앞 경계**에서 → 는 코드 **안**으로', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(el.firstChild!, 2); // 코드 바로 앞(밖)
    expect(codeEdgeStep(el, 1)).toBe('in');
    expect(where(el)).toEqual({ at: 2, code: true });
  });

  it('코드 **안의 머리**에서 ← 는 코드 **밖**으로', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0);
    expect(codeEdgeStep(el, -1)).toBe('out');
    expect(where(el)).toEqual({ at: 2, code: false });
  });

  it('코드 **안에서 머리로 가는 한 걸음**도 우리가 놓는다 — 브라우저는 밖으로 접는다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 1); // 코드 안 두 번째
    expect(codeEdgeStep(el, -1)).toBe('in');
    // 제보의 그림: 여기서 크로뮴은 **코드 앞**(밖, at=2)으로 갔다. 우리는 안에 세운다.
    expect(where(el)).toEqual({ at: 2, code: true });
  });

  it('코드가 **줄의 마지막**이면 밖에 설 자리가 없다 — `leave`', () => {
    const el = line([TEXT('앞글 '), CODE('CODE')]);
    put(codeText(el), 4);
    expect(codeEdgeStep(el, 1)).toBe('leave');
  });

  it('코드 **한복판**은 브라우저의 것이다 — `null`', () => {
    const el = line([TEXT('안녕'), CODE('코드블록'), TEXT('뒷글')]);
    put(codeText(el), 2);
    expect(codeEdgeStep(el, 1)).toBeNull();
  });

  it('코드가 **없는 줄**은 건드리지 않는다', () => {
    const el = line([TEXT('평범한 줄')]);
    put(el.firstChild!, 2);
    expect(codeEdgeStep(el, 1)).toBeNull();
    expect(codeEdgeStep(el, -1)).toBeNull();
  });

  it('선택이 **접혀 있지 않으면** 건드리지 않는다 — 그때 방향키는 선택을 접는 일이다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(codeText(el), 2);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(codeEdgeStep(el, 1)).toBeNull();
  });
});

/**
 * **정거장이 돌려주는 값은 「다음 글자가 코드인가」다**(제보 5의 재보고).
 *
 * 캐럿을 어느 노드에 두었는지와 별개로, 크로뮴은 **글자를 넣는 자리**를 경계에서
 * 한쪽으로 접는다(모듈 머리말의 표). 그래서 호출부는 이 값으로 그 뜻을 못박는다 —
 * 여기서 지키는 것은 **안/밖이 값으로 구분된다**는 사실이다.
 */
describe('정거장은 안/밖을 말한다', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('머리 경계의 두 정거장은 서로 다른 값이다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 1);
    expect(codeEdgeStep(el, -1)).toBe('in'); // 코드 안 머리
    expect(codeEdgeStep(el, -1)).toBe('out'); // 그 밖
  });

  it('끝 경계의 두 정거장도 서로 다른 값이다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 2); // 코드 안 끝
    expect(codeEdgeStep(el, 1)).toBe('out'); // 그 밖
    expect(codeEdgeStep(el, -1)).toBe('in'); // 되돌아오면 다시 안
  });
});

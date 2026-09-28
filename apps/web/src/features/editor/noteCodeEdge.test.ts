import { beforeEach, describe, expect, it } from 'vitest';
import { codeEdgeCaret, codeEdgeMark, codeEdgeStep } from './noteCodeEdge';
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

/**
 * **그려지는 캐럿**(제보 — 자리·불·친 글자는 맞는데 막대가 반대쪽에 선다).
 *
 * 크로뮴은 「보이기에 같은」 두 자리를 위쪽 하나로 접어 **그린다** — 머리 경계의
 * 안·밖은 둘 다 상자 밖에, 끝 경계의 안·밖은 둘 다 상자 안에. jsdom에는 그 엔진도
 * 레이아웃도 없으므로 여기서 재는 것은 둘이다: **어느 쪽을 약속했는가**
 * (`codeEdgeMark`)와 **그 약속의 자리를 재는가**(`codeEdgeCaret` — 캐럿이 선 노드가
 * 아니라). 픽셀은 실브라우저 프로브가 본다.
 */
/**
 * 제보 3 — **오른쪽에서 끝 경계로 들어오는 한 걸음**은 상자 밖에 서야 한다.
 *
 * 머리 쪽은 크로뮴이 알아서 바깥에 세우는데(경계를 위쪽 자리로 접기 때문이다) 끝 쪽은
 * 그 접기가 반대로 작동해 **한 걸음에 안으로 들어가 버렸다**. 그래서 왕복도 어긋났다:
 * →2로 나갔다가 ←2로 돌아오면 한 글자를 더 들어갔다.
 */
describe('끝 경계로 들어오는 한 걸음(제보 3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('코드 **뒤의 글자**에서 ← 는 코드 **밖**에 선다(안이 아니라)', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    const after = el.lastChild as Text;
    put(after, 1); // `뒷X글` — 코드 끝에서 한 글자 뒤
    expect(codeEdgeStep(el, -1)).toBe('out');
    expect(where(el)).toEqual({ at: 4, code: false });
  });

  it('그 다음 ← 가 **안으로** 들어간다 — 정거장 둘이 한 쌍이다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(el.lastChild as Text, 1);
    codeEdgeStep(el, -1);
    expect(codeEdgeStep(el, -1)).toBe('in');
    expect(where(el)).toEqual({ at: 4, code: true });
  });

  it('→2 로 나갔다 ←2 로 돌아오면 **제자리**다(제보 3-3)', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    const inside = codeText(el);
    put(inside, 2); // 코드 안의 끝
    expect(codeEdgeStep(el, 1)).toBe('out'); // →1 — 상자 밖
    expect(codeEdgeStep(el, 1)).toBeNull(); // →2 — 다음 글자는 브라우저의 것
    put(el.lastChild as Text, 1); // 브라우저가 옮겼을 자리
    expect(codeEdgeStep(el, -1)).toBe('out'); // ←1 — 다시 상자 밖
    expect(codeEdgeStep(el, -1)).toBe('in'); // ←2 — 떠난 그 자리
    expect(where(el)).toEqual({ at: 4, code: true });
  });

  it('코드가 줄의 **끝**이면 그 걸음은 없다 — 밖에 설 자리가 없다', () => {
    const el = line([TEXT('앞'), CODE('코드')]);
    put(el.firstChild as Text, 0);
    expect(codeEdgeStep(el, -1)).toBeNull();
  });
});

describe('코드 경계에 그리는 캐럿', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('예약이 있으면 **그 값**이 약속이다 — 캐럿이 어느 노드에 있든', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0); // 머리 경계 · DOM으로는 코드 **안**
    expect(codeEdgeMark(el, false)).toBe(false); // 예약이 「밖」이면 밖이다
    expect(codeEdgeMark(el, true)).toBe(true);
  });

  it('예약이 없으면 **크로뮴이 글자를 넣는 쪽** — 머리는 밖, 끝은 안', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0); // 머리 경계
    expect(codeEdgeMark(el, undefined)).toBe(false);
    put(codeText(el), 2); // 끝 경계
    expect(codeEdgeMark(el, undefined)).toBe(true);
  });

  it('경계가 아니면 `null`이다 — 그 자리는 브라우저의 것이다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 1); // 코드 가운데
    expect(codeEdgeMark(el, undefined)).toBeNull();
    expect(codeEdgeMark(el, true)).toBeNull();
    put(el.firstChild as Text, 1); // 코드와 멀리 떨어진 본문
    expect(codeEdgeMark(el, undefined)).toBeNull();
  });

  it('코드 **블록** 안에서는 그리지 않는다 — 거기엔 상자가 없다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    const box = document.createElement('div');
    box.setAttribute('data-note-kind', 'code');
    el.parentElement!.appendChild(box);
    box.appendChild(el);
    put(codeText(el), 0);
    expect(codeEdgeMark(el, true)).toBeNull();
    expect(codeEdgeCaret(el, true)).toBeNull();
  });

  it('**약속한 쪽**의 자리를 잰다 — 캐럿이 선 노드가 아니라', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0); // 머리 경계 · 캐럿은 코드 **안**
    const seen: { node: Node; offset: number }[] = [];
    const real = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function stub(this: Range) {
      seen.push({ node: this.startContainer, offset: this.startOffset });
      return { left: 10, top: 20, height: 16, width: 0 } as DOMRect;
    };
    try {
      expect(codeEdgeCaret(el, false)).toEqual({ left: 10, top: 20, height: 16 });
      // 잰 자리는 코드 **밖**의 글자 노드여야 한다(캐럿이 든 코드 글자가 아니라).
      expect(seen.at(-1)!.node).toBe(el.firstChild);
      expect(codeEdgeCaret(el, true)).toEqual({ left: 10, top: 20, height: 16 });
      expect(seen.at(-1)!.node).toBe(codeText(el));
    } finally {
      Range.prototype.getBoundingClientRect = real;
    }
  });

  /**
   * **못 재면 그리지 않는다.** 호출부는 그림이 설 때만 기본 캐럿을 감추므로, 여기서
   * `null`을 내는 것이 곧 "캐럿이 통째로 사라지지 않는다"이다. 못 재는 길은 둘이다.
   */
  it('사각형을 물을 수 없으면 `null` — jsdom에는 `Range.getBoundingClientRect`가 없다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0);
    expect(Range.prototype.getBoundingClientRect).toBeUndefined();
    expect(codeEdgeCaret(el, true)).toBeNull();
  });

  it('높이 0도 「못 쟀다」로 본다 — 요소 경계의 사각형이 그렇게 온다', () => {
    const el = line([TEXT('안녕'), CODE('코드'), TEXT('뒷글')]);
    put(codeText(el), 0);
    const real = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 20, height: 0, width: 0 }) as DOMRect;
    try {
      expect(codeEdgeCaret(el, true)).toBeNull();
    } finally {
      if (real) Range.prototype.getBoundingClientRect = real;
      else delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });
});

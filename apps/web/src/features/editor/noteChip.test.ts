import { beforeEach, describe, expect, it } from 'vitest';
import { applyHolidayMarks, chipAtCaret, chipRange, extendOverChips, headChipCaret, moveOverChips } from './noteChip';
import { runsToHtml, setLinearSelection } from './richtextDom';
import { noteMarksIn } from './noteRichDom';
import { charOffset } from './noteTextSelect';

/**
 * 본문의 **칩**을 한 덩어리로 다루는 규칙 — 여기서는 「행 끝까지 늘리기」를 본다.
 *
 * 제보: 한 줄에 일정 멘션 칩이 셋일 때 줄 끝에서 Shift+Home을 눌러도 앞쪽 칩이
 * 선택에서 빠진다. 원인은 `Selection.modify(..., 'lineboundary')`가
 * `contenteditable="false"` 요소 앞에서 서기 때문이고(실측 — 반복해 불러도 더 가지
 * 않는다), 그 자리를 `extendOverChips`가 메운다.
 *
 * **jsdom에는 `Selection.modify`가 없다.** 그래서 실측한 성질 하나 —
 * *"평범한 글자는 건너가고 칩은 넘지 않는다"* — 만 그대로 세워 둔다. 실브라우저
 * 증거는 프로브 쪽이고(칩 셋이 있는 줄에서 14자·칩 3개가 모두 선택됐다),
 * 이 파일이 지키는 것은 **그 멈춘 자리를 우리가 메운다**는 사실이다.
 */
const CHIP = (t: string, dt: string) => ({ t, b: false, c: null, dt });
const TEXT = (t: string) => ({ t, b: false, c: null });

/** 칩 셋이 있는 줄 — `칩1 가 칩2 나 칩3 끝`(값 좌표 14자). */
function lineWithChips(): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = runsToHtml({
    text: '',
    rich: [CHIP('칩1', '2026-09-28'), TEXT(' 가 '), CHIP('칩2', '2026-09-29'), TEXT(' 나 '), CHIP('칩3', '2026-09-30'), TEXT(' 끝')],
  });
  document.body.appendChild(el);
  return el;
}

/**
 * 크로뮴의 `modify(..., 'lineboundary')` **모델**을 그 선택에 얹는다.
 *
 * 줄 끝(앞)까지 가되 **칩은 넘지 않는다** — 넘어야 할 칩이 있으면 그 칩의 바깥
 * 경계에서 선다. 같은 호출을 되풀이해도 더 가지 않는다(실측한 그 성질이다).
 */
function stubModify(el: HTMLElement, sel: Selection, chipStart: (at: number) => { node: Node; offset: number }): void {
  const chips = [...el.querySelectorAll<HTMLElement>('[data-date]')].map((c) => chipRange(el, c));
  (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify = (alter, dir) => {
    const at = charOffset(el, sel.focusNode!, sel.focusOffset);
    const to =
      dir === 'backward'
        ? Math.max(0, ...chips.filter((c) => c.end <= at).map((c) => c.end))
        : Math.min(el.textContent!.length, ...chips.filter((c) => c.start >= at).map((c) => c.start));
    const p = chipStart(to);
    // `move`는 **접어서** 옮긴다 — 크로뮴과 같다(Home·End가 그쪽이다).
    if (alter === 'move') sel.setBaseAndExtent(p.node, p.offset, p.node, p.offset);
    else sel.extend(p.node, p.offset);
  };
}

/** 값 좌표를 **칩 바깥의** DOM 자리로 푼다 — 모델이 칩 안에 초점을 두지 않도록. */
function outside(el: HTMLElement) {
  return (at: number): { node: Node; offset: number } => {
    const kids = [...el.childNodes];
    let acc = 0;
    for (let i = 0; i < kids.length; i += 1) {
      const len = (kids[i]!.textContent || '').length;
      if (at <= acc) return { node: el, offset: i };
      if (at < acc + len) {
        const n = kids[i]!;
        if (n.nodeType === 3) return { node: n, offset: at - acc };
        return { node: el, offset: at - acc < len / 2 ? i : i + 1 };
      }
      acc += len;
    }
    return { node: el, offset: kids.length };
  };
}

describe('칩을 넘어 행 끝까지 늘리기(제보 4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('브라우저가 첫 칩 앞에서 서도 **줄 전체가** 선택된다', () => {
    const el = lineWithChips();
    const len = el.textContent!.length;
    expect(len).toBe(14);
    el.focus();
    setLinearSelection(el, len, len);
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));

    // 브라우저 몫 — 여기까지만 간다(칩3 바로 뒤 = 12).
    (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify('extend', 'backward', 'lineboundary');
    expect(charOffset(el, sel.focusNode!, sel.focusOffset)).toBe(12);

    // 우리 몫 — 남은 칩들을 넘어 줄 맨 앞까지.
    expect(extendOverChips(el, sel, -1)).toBe(true);
    expect(charOffset(el, sel.focusNode!, sel.focusOffset)).toBe(0);
  });

  it('선택의 **값도** 줄 전체다 — 초점을 칩 안에 두면 `toString()`이 빈다(실측)', () => {
    const el = lineWithChips();
    const len = el.textContent!.length;
    el.focus();
    setLinearSelection(el, len, len);
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));
    (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify('extend', 'backward', 'lineboundary');
    extendOverChips(el, sel, -1);

    // 초점이 편집할 수 없는 섬(칩) 안이면 크로뮴이 빈 문자열을 돌려준다 — 그래서
    // 칩 **바깥의 같은 자리**에 둔다. 복사·삭제가 그 값을 읽는다.
    const focus = sel.focusNode!;
    const holder = focus.nodeType === 1 ? (focus as HTMLElement) : focus.parentElement!;
    expect(charOffset(el, focus, sel.focusOffset)).toBe(0); // 값 좌표로는 줄 맨 앞이고
    expect(holder.closest('[data-date]')).toBeNull(); // 그 자리를 칩 **바깥**에서 가리킨다
  });

  it('반대 방향(End)도 같다 — 끝까지 간다', () => {
    const el = lineWithChips();
    el.focus();
    setLinearSelection(el, 0, 0);
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));
    (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify('extend', 'forward', 'lineboundary');
    expect(extendOverChips(el, sel, 1)).toBe(true);
    expect(charOffset(el, sel.focusNode!, sel.focusOffset)).toBe(14);
  });

  it('칩이 **없는** 줄은 건드리지 않는다 — 브라우저가 이미 다 했다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = runsToHtml({ text: '그냥 글자', rich: [TEXT('그냥 글자')] });
    document.body.appendChild(el);
    el.focus();
    setLinearSelection(el, 5, 0); // 이미 줄 전체가 잡혀 있다
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));
    expect(extendOverChips(el, sel, -1)).toBe(false);
  });

  it('`modify`가 없는 환경(jsdom 기본)에서는 아무 일도 하지 않는다 — 터지지 않는다', () => {
    const el = lineWithChips();
    el.focus();
    setLinearSelection(el, 14, 14);
    const sel = window.getSelection()!;
    expect(extendOverChips(el, sel, -1)).toBe(false);
  });
});

describe('캐럿 옆의 칩(제보 1의 토대)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('칩 바로 뒤·바로 앞을 잡고, 한복판의 글자는 잡지 않는다', () => {
    const el = lineWithChips();
    expect(chipAtCaret(el, 2, -1)?.getAttribute('data-date')).toBe('2026-09-28'); // 칩1 바로 뒤
    expect(chipAtCaret(el, 0, 1)?.getAttribute('data-date')).toBe('2026-09-28'); // 칩1 바로 앞
    expect(chipAtCaret(el, 4, -1)).toBeNull(); // ` 가 ` 안 — 칩이 아니다
  });
});

describe('공휴일이면 요일이 붉다(제보 2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** 날짜 칩 둘이 든 본문 — 토요일 하나(추석), 평범한 월요일 하나. */
  function body(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mf-note-line';
    el.innerHTML = runsToHtml({
      text: '',
      rich: [CHIP('9월 26일 토', '2026-09-26'), TEXT(' 와 '), CHIP('9월 28일 월', '2026-09-28')],
    });
    document.body.appendChild(el);
    return el;
  }

  const holiday = (iso: string) => document.querySelector(`[data-date="${iso}"]`)?.getAttribute('data-holiday') ?? null;

  it('쉬는 공휴일인 날의 칩에만 표를 단다', () => {
    const el = body();
    applyHolidayMarks(el, { '2026-09-26': { dayOff: true } });
    expect(holiday('2026-09-26')).toBe('1');
    expect(holiday('2026-09-28')).toBeNull();
  });

  it('**쉬지 않는** 기념일은 달지 않는다 — 달력의 날짜 숫자와 같은 기준', () => {
    const el = body();
    applyHolidayMarks(el, { '2026-09-26': { dayOff: false } });
    expect(holiday('2026-09-26')).toBeNull();
  });

  it('공휴일이 걷히면 표도 걷는다 — 다시 그리지 않고 속성만 오간다', () => {
    const el = body();
    applyHolidayMarks(el, { '2026-09-26': { dayOff: true } });
    applyHolidayMarks(el, {});
    expect(holiday('2026-09-26')).toBeNull();
  });

  it('**글자도 값도 건드리지 않는다** — 덧입히는 것은 사실 하나뿐이다', () => {
    const el = body();
    const before = el.textContent;
    applyHolidayMarks(el, { '2026-09-26': { dayOff: true } });
    expect(el.textContent).toBe(before);
    // 요일 스팬은 그대로이고(색은 CSS가 준다), 인라인 색이 심기지 않았다.
    expect(el.querySelector('[data-date="2026-09-26"] .mf-datechip-dow')?.textContent).toBe('토');
    expect(el.innerHTML).not.toContain('color:');
  });
});

describe('툴바가 읽는 색·형광(제보 1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** 값을 그려 둔 줄 — `noteMarksIn`은 DOM이 아니라 **그 값**을 읽는다. */
  function line(rich: Record<string, unknown>[]): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = runsToHtml({ text: '', rich: rich as never });
    document.body.appendChild(el);
    return el;
  }

  it('구간이 **같은 색일 때만** 그 색이다 — 섞였으면 말하지 않는다', () => {
    const el = line([{ t: '빨강', b: false, c: '#d92626' }, { t: '파랑', b: false, c: '#2266dd' }]);
    expect(noteMarksIn(el, 0, 2).c).toBe('#d92626');
    expect(noteMarksIn(el, 0, 4).c).toBeNull(); // 두 색이 섞였다
  });

  it('형광도 같은 규칙이다', () => {
    const el = line([{ t: '노랑', b: false, c: null, hl: 'yellow' }, { t: '민', b: false, c: null, hl: 'mint' }]);
    expect(noteMarksIn(el, 0, 2).hl).toBe('yellow');
    expect(noteMarksIn(el, 0, 3).hl).toBeNull();
  });

  it('**접힌 캐럿은 앞 글자를 본다** — 경계에서 어느 쪽 색인지 말할 수 있게', () => {
    const el = line([{ t: '빨강', b: false, c: '#d92626' }, { t: '평문', b: false, c: null }]);
    // 빨강 한복판·끝 → 빨강. 이어 치면 그 색을 물려받는 자리다.
    expect(noteMarksIn(el, 1, 1).c).toBe('#d92626');
    expect(noteMarksIn(el, 2, 2).c).toBe('#d92626');
    // 평문 한복판 → 색 없음.
    expect(noteMarksIn(el, 3, 3).c).toBeNull();
  });

  it('줄 맨 앞에서는 **뒤 글자**를 본다 — 앞이 없으므로', () => {
    const el = line([{ t: '빨강', b: false, c: '#d92626' }]);
    expect(noteMarksIn(el, 0, 0).c).toBe('#d92626');
  });

  it('색이 없으면 `null`이다 — 켜짐(`b`)과 달리 거짓이 아니다', () => {
    const el = line([{ t: '평문', b: false, c: null }]);
    const m = noteMarksIn(el, 0, 2);
    expect(m.c).toBeNull();
    expect(m.hl).toBeNull();
    expect(m.b).toBe(false);
  });
});

/**
 * **캐럿만 옮기는 쪽도 메운다**(제보 3·4).
 *
 * 늘리는 쪽(Shift+Home)만 메워 두었더니 두 제보가 왔다: Home이 줄 머리로 가지
 * 않는다 · 줄 끝에서 ↑가 윗줄로 넘어가지 않는다(「행의 머리인가」가 영영 거짓이라).
 * 사용자가 그 차이를 정확히 짚었다 — "신기하게 shift+home 조합으로는 다 선택된다."
 */
describe('칩을 넘어 행 머리로 캐럿 옮기기(제보 3·4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('브라우저가 첫 칩 앞에서 서도 **줄의 0번**까지 간다', () => {
    const el = lineWithChips();
    const len = el.textContent!.length;
    el.focus();
    setLinearSelection(el, len, len);
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));

    // 브라우저 몫 — 칩3 바로 뒤(12)에서 선다.
    (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify('move', 'backward', 'lineboundary');
    expect(charOffset(el, sel.focusNode!, sel.focusOffset)).toBe(12);

    expect(moveOverChips(el, sel, -1)).toBe(true);
    expect(charOffset(el, sel.focusNode!, sel.focusOffset)).toBe(0);
    // **접혀 있어야 한다** — 캐럿을 옮기는 일이지 고르는 일이 아니다.
    expect(sel.isCollapsed).toBe(true);
  });

  it('칩이 **없으면** 손대지 않는다 — 그 걸음은 브라우저의 것이다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = runsToHtml({ text: '', rich: [TEXT('평범한 한 줄')] });
    document.body.appendChild(el);
    el.focus();
    setLinearSelection(el, 3, 3);
    const sel = window.getSelection()!;
    stubModify(el, sel, outside(el));
    expect(moveOverChips(el, sel, -1)).toBe(false);
  });
});

/**
 * **줄 머리의 칩 앞에 선 캐럿을 우리가 그린다**(제보 2).
 *
 * 줄이 칩으로 시작하면 그 앞에는 글자 노드가 없어 0번 자리의 캐럿이 **줄 상자**에
 * 선다(`(el, 0)`). 값은 멀쩡한데(실측: 그 자리에서 친 글자는 칩 앞으로 들어간다)
 * 크로뮴이 그 자리를 그리지 못해 칩 오른쪽에 있는 것처럼 보였다 — Home을 눌러도
 * 칩 왼쪽으로 가지 않는다는 제보가 그것이다.
 *
 * jsdom에는 레이아웃이 없으므로(사각형이 전부 0이고 `Range`에는 그 메서드가 아예
 * 없다 — `probe-pitfalls` F30) 여기서 재는 것은 **언제 그리고 언제 그리지 않는가**와
 * **어느 자리를 재는가**이다. 픽셀은 실브라우저 프로브가 본다.
 */
describe('줄 머리 칩 앞의 캐럿(제보 2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function chipHead(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = runsToHtml({ text: '', rich: [CHIP('2026-09-30', '2026-09-30'), TEXT(' 뒤에 오는 글')] });
    document.body.appendChild(el);
    return el;
  }
  /** 캐럿을 **줄 상자 자체**에 놓는다 — 칩 앞에는 글자 노드가 없어 그리로 간다. */
  function putAtBox(el: HTMLElement, offset: number): void {
    const range = document.createRange();
    range.setStart(el, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  /** 레이아웃이 없는 환경에 상자를 꽂아 준다 — 칩과 그 뒤 글자의 자리. */
  function withRects(chip: Element, run: (seen: Node[]) => void): void {
    const seen: Node[] = [];
    const realEl = Element.prototype.getBoundingClientRect;
    const realRange = Range.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function stub(this: Element) {
      return (this === chip ? { left: 100, top: 40, height: 22, width: 90 } : { left: 0, top: 0, height: 0, width: 0 }) as DOMRect;
    };
    Range.prototype.getBoundingClientRect = function stub(this: Range) {
      seen.push(this.startContainer);
      return { left: 195, top: 43, height: 16, width: 0 } as DOMRect;
    };
    try {
      run(seen);
    } finally {
      Element.prototype.getBoundingClientRect = realEl;
      if (realRange) Range.prototype.getBoundingClientRect = realRange;
      else delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  }

  it('가로는 **칩의 왼쪽 끝**, 세로는 그 줄의 **글자 높이**다', () => {
    const el = chipHead();
    const chip = el.firstChild as HTMLElement;
    putAtBox(el, 0);
    withRects(chip, (seen) => {
      // 칩 높이(22)가 아니라 글자 높이(16)로 그린다 — 알약 높이면 선택처럼 보인다.
      expect(headChipCaret(el)).toEqual({ left: 100, top: 43, height: 16 });
      // 높이는 칩 **뒤**의 첫 글자에서 잰다.
      expect(seen.at(-1)).toBe(el.lastChild);
    });
  });

  it('줄 머리가 아니면 그리지 않는다 — 그 자리는 브라우저의 것이다', () => {
    const el = chipHead();
    const chip = el.firstChild as HTMLElement;
    putAtBox(el, 1); // 칩 **뒤**의 상자 자리
    withRects(chip, () => expect(headChipCaret(el)).toBeNull());
  });

  it('칩으로 시작하지 않는 줄에서는 그리지 않는다', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = runsToHtml({ text: '', rich: [TEXT('보통 줄')] });
    document.body.appendChild(el);
    putAtBox(el, 0);
    withRects(el, () => expect(headChipCaret(el)).toBeNull());
  });

  /**
   * 한 덩어리 칩이 아닌 요소 — 굵게·기울임 같은 **서식 껍질**. 그 안에는 글자 노드가
   * 있어 크로뮴이 캐럿을 제대로 그린다. 우리가 끼어들어 기본 캐럿을 감추면 오히려
   * 캐럿이 사라진다.
   */
  it('머리가 **칩이 아닌 요소**면 그리지 않는다(굵게 껍질 등)', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = '<b>굵게</b>뒤';
    document.body.appendChild(el);
    putAtBox(el, 0);
    withRects(el.firstChild as Element, () => expect(headChipCaret(el)).toBeNull());
  });

  it('캐럿이 **글자 노드 안**이면 그리지 않는다 — 크로뮴이 제대로 그린다', () => {
    const el = chipHead();
    const chip = el.firstChild as HTMLElement;
    const range = document.createRange();
    range.setStart(el.lastChild as Text, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    withRects(chip, () => expect(headChipCaret(el)).toBeNull());
  });

  it('**못 재면 그리지 않는다** — 자리 없이 기본 캐럿까지 감추면 캐럿이 사라진다', () => {
    const el = chipHead();
    putAtBox(el, 0);
    expect(headChipCaret(el)).toBeNull(); // jsdom의 사각형은 전부 0이다
  });
});

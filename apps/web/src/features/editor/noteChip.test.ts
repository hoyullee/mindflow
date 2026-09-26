import { beforeEach, describe, expect, it } from 'vitest';
import { chipAtCaret, chipRange, extendOverChips } from './noteChip';
import { runsToHtml, setLinearSelection } from './richtextDom';
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
  (sel as Selection & { modify: (a: string, d: string, g: string) => void }).modify = (_alter, dir) => {
    const at = charOffset(el, sel.focusNode!, sel.focusOffset);
    const to =
      dir === 'backward'
        ? Math.max(0, ...chips.filter((c) => c.end <= at).map((c) => c.end))
        : Math.min(el.textContent!.length, ...chips.filter((c) => c.start >= at).map((c) => c.start));
    const p = chipStart(to);
    sel.extend(p.node, p.offset);
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

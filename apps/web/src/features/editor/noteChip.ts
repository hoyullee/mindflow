/**
 * 본문의 **칩**을 한 덩어리로 다루는 규칙 — 날짜 칩·페이지 링크·사람 멘션.
 *
 * 칩은 글이 아니라 **하나의 값**이다(제보: 날짜 칩을 Backspace로 지우면 글자가
 * 하나씩 지워진다). "9월 27일 일"에서 `일`만 지운 상태는 뜻이 없을 뿐 아니라
 * **값과 화면이 어긋난다** — 그 런은 여전히 `dt`를 달고 있어 멀쩡한 칩으로 그려지고,
 * 그 칩이 가리키는 날짜(`data-date`)는 글자와 달라진다.
 *
 * 마크업의 `contenteditable="false"`(`richtextDom`의 `CHIP_ATOMIC`)가 캐럿이 칩
 * 안으로 들어가는 것을 막고, 여기가 **지우는 일**을 못박는다. 둘을 함께 두는 이유:
 * 원자 요소의 경계에서 Backspace가 무엇을 지우는지는 브라우저마다 조금씩 다르고,
 * 우리는 "앞/뒤의 칩을 통째로"를 **보장**해야 한다.
 *
 * DOM만 읽는다 — 지우는 것은 호출부가 한다(`NoteLine`은 DOM을 고친 뒤 다시 읽어
 * 값을 만든다. 그 흐름이 이 화면의 저장 경로다).
 */

import { charOffset, pointAt } from './noteTextSelect';

/** 본문에서 **한 덩어리**로 다루는 인라인들 — 셋 다 `CHIP_ATOMIC`을 달고 있다. */
export const CHIP_SELECTOR = '[data-date],[data-page],[data-mention-email]';

/** 그 칩이 줄의 값 좌표에서 차지하는 구간 `[start, end)`. */
export function chipRange(el: HTMLElement, chip: HTMLElement): { start: number; end: number } {
  const start = charOffset(el, chip, 0);
  return { start, end: start + (chip.textContent || '').length };
}

/**
 * 캐럿 **바로 앞**(`dir: -1`)이나 **바로 뒤**(`dir: 1`)에 붙어 있는 칩.
 *
 * 캐럿이 칩 **안**에 있는 경우도 잡는다 — 옛 문서에는 `contenteditable` 속성이 없는
 * 칩이 남아 있을 수 있고(이 판 이전에 저장된 본문), 그때도 한 덩어리로 지워야 한다.
 */
export function chipAtCaret(el: HTMLElement, at: number, dir: -1 | 1): HTMLElement | null {
  for (const chip of el.querySelectorAll<HTMLElement>(CHIP_SELECTOR)) {
    const { start, end } = chipRange(el, chip);
    if (end === start) continue; // 글자 없는 칩 — 지울 것이 없다
    if (at > start && at < end) return chip; // 안에 서 있다(옛 문서)
    if (dir === -1 ? at === end : at === start) return chip;
  }
  return null;
}

/**
 * **행 끝으로 늘리기가 칩에서 멈추는 것**을 메운다(제보: 칩 셋이 있는 줄에서
 * Shift+Home이 2번째까지만 골라진다).
 *
 * `Selection.modify(..., 'lineboundary')`는 `contenteditable="false"` 요소 앞에서
 * **선다**(실측: 반복해 불러도 더 가지 않는다 — 크로뮴). 칩이 한 덩어리가 되면서
 * 생긴 자리라, 칩만큼은 우리가 건너뛰고 그 앞의 글자들은 다시 `modify`에게 맡긴다
 * (감긴 행의 경계를 아는 것은 브라우저뿐이다 — `lineBoundaryAt` 머리말과 같은 이유).
 *
 * **가장 멀리 간 자리를 지킨다**: 칩을 넘긴 직후의 `modify`는 행 경계를 다시 재면서
 * **도로 칩 뒤로 당겨 놓는 경우가 있다**(실측 — 그래서 첫 판은 `moved: true`인데도
 * 선택 길이가 그대로였다). 그러니 매번 견줘 더 멀리 간 쪽만 남기고, 더 나아가지
 * 못하면 거기서 멈춘다.
 */
export function extendOverChips(el: HTMLElement, sel: Selection, dir: -1 | 1): boolean {
  const modify = (sel as Selection & { modify?: (a: string, d: string, g: string) => void }).modify;
  if (typeof modify !== 'function' || !sel.focusNode || !el.contains(sel.focusNode)) return false;
  const farther = (a: number, b: number) => (dir === -1 ? Math.min(a, b) : Math.max(a, b));
  /**
   * 그 자리로 초점을 늘린다 — 다만 **칩 안에는 두지 않는다**.
   *
   * `pointAt`은 값 좌표를 글자 노드로 푸는데, 칩의 경계는 그 칩의 글자 노드 안이다.
   * 거기에 초점을 두면 선택은 제대로 잡히는데(범위·하이라이트 정상) `Selection.toString()`이
   * **빈 문자열**이 된다 — 초점이 편집할 수 없는 섬 안이라 크로뮴이 그렇게 답한다(실측).
   * 복사·삭제처럼 그 값을 읽는 길이 있으므로, 칩 **바깥의 같은 자리**(부모의 자식
   * 경계)로 옮겨 둔다. 값 좌표로는 같은 지점이다.
   */
  const goTo = (at: number): boolean => {
    const p = pointAt(el, at);
    let node: Node = p.node;
    let offset = p.offset;
    const chip = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest?.(CHIP_SELECTOR) as HTMLElement | null;
    if (chip && chip.parentNode) {
      const kids = [...chip.parentNode.childNodes];
      const i = kids.indexOf(chip as ChildNode);
      if (i >= 0) {
        node = chip.parentNode;
        offset = at <= chipRange(el, chip).start ? i : i + 1;
      }
    }
    try {
      sel.extend(node, offset);
      return true;
    } catch {
      return false; // 떨어져 나간 노드 — 여기까지가 최선이다
    }
  };
  const read = (): number => (sel.focusNode && el.contains(sel.focusNode) ? charOffset(el, sel.focusNode, sel.focusOffset) : best);

  let best = charOffset(el, sel.focusNode, sel.focusOffset);
  const start = best;
  // 칩이 아무리 많아도 줄 하나에 든 수만큼이면 끝난다 — 그 이상 돌 이유가 없다.
  const cap = el.querySelectorAll(CHIP_SELECTOR).length + 1;
  for (let i = 0; i < cap; i += 1) {
    const chip = chipAtCaret(el, best, dir);
    if (!chip) break;
    const range = chipRange(el, chip);
    const over = dir === -1 ? range.start : range.end;
    if (over === best || !goTo(over)) break;
    best = over;
    // 칩을 넘었으니 그 앞(뒤)의 글자는 다시 브라우저가 가장 잘 안다.
    try {
      modify.call(sel, 'extend', dir === -1 ? 'backward' : 'forward', 'lineboundary');
    } catch {
      break;
    }
    const next = farther(best, read());
    if (next === best) {
      // 더 가지 못했다(또는 도로 당겨졌다) — 우리가 잡아 둔 자리로 되돌리고 멈춘다.
      goTo(best);
      break;
    }
    best = next;
  }
  if (best === start) return false;
  goTo(best);
  return true;
}

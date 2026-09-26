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

import { charOffset } from './noteTextSelect';

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

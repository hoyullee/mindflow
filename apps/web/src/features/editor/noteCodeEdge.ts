/**
 * 인라인 코드의 **경계에서 캐럿이 서는 자리**를 우리가 못박는다.
 *
 * ## 무엇이 문제였나(실브라우저 실측)
 *
 * 크로뮴은 인라인 요소의 경계를 **한 자리로 접는다**. 값으로는 같은 좌표라도
 * 사람에게는 두 자리다 — 코드 상자 **안**이냐 **밖**이냐로 다음에 칠 글자의 서식이
 * 갈리기 때문이다. 접어 버리니 이런 일이 났다(제보 5, 그대로 재현했다):
 *
 * | 줄 | 캐럿 | 누른 키 | 크로뮴 | 사람이 바란 것 |
 * | --- | --- | --- | --- | --- |
 * | `` `안녕하세요` `` (줄 전체) | 코드 안 끝 | → | **아무 일도 없음** | 코드 밖으로 |
 * | 안녕`` `안녕하세요` ``안녕 | 코드 안 2번째 | ← | 코드 **밖 앞**(2칸 건너뜀) | 코드 안 첫째 |
 * | 안녕`` `안녕하세요` ``안녕 | 코드 안 끝 | → | 코드 **밖 뒤의 다음 글자**(한 칸 건너뜀) | 코드 바로 밖 |
 *
 * ## 규칙
 *
 * 코드 껍질의 **안쪽 경계와 바깥쪽 경계를 각각 정거장**으로 둔다. →면 안의 끝에서
 * 밖으로 한 번, 밖에서 다시 안으로 한 번. ←도 대칭이다. 값 좌표는 움직이지 않는
 * 걸음이 한 번 섞이지만(같은 자리의 안↔밖), 코드는 **면이 보이는 서식**이라
 * 사람이 그 경계를 눈으로 보고 있다 — 거기서 한 번 서는 편이 건너뛰는 편보다 덜
 * 놀랍다. 이 규칙을 코드에만 두는 이유도 그것이다(굵게·기울임에는 상자가 없다).
 *
 * ## 줄 끝의 코드
 *
 * 코드가 줄의 마지막이면 그 **밖**에는 글자 노드가 없다 — 캐럿이 설 자리가 없어
 * 크로뮴은 아무 일도 하지 않는다. 그때만 `'leave'`를 돌려주고, 호출부가 조합
 * 껍데기(`openArmedAnchor` — 폭 0 글자 하나)를 코드 밖에 세워 캐럿을 그리로 옮긴다.
 * 그 껍데기는 글자가 들어오거나 줄을 떠나면 걷힌다(`closeArmedAnchor`).
 *
 * ## 캐럿을 옮기는 것만으로는 모자란다 — **친 글자가 어디에 떨어지는가**
 *
 * 실측(제보 5의 재보고): 크로뮴은 **글자를 넣는 자리**도 경계에서 한쪽으로 접는다.
 * 캐럿을 어느 노드에 두었든 결과가 같다.
 *
 * | 캐럿 | 친 글자 |
 * | --- | --- |
 * | 코드의 **머리** 경계(안이든 밖이든) | 언제나 코드 **밖** |
 * | 코드의 **끝** 경계(안이든 밖이든) | 언제나 코드 **안** |
 *
 * 그래서 네 정거장 가운데 둘은 캐럿만 옮기면 사람의 뜻과 **반대로** 움직인다. 이
 * 함수는 캐럿을 놓은 뒤 **어느 쪽에 세웠는지**를 돌려주고(`'in'`·`'out'`), 호출부가
 * 그 뜻을 예약으로 못박는다(`armCaretMarkAs(el, 'k', …)`). 정거장이 곧 "다음 글자가
 * 코드인가"라는 약속이 되고, 툴바의 코드 불도 그 약속을 그대로 비춘다.
 */

import { caretText, edgeText, outerTextSpot } from './noteChip';
import { charOffset } from './noteTextSelect';

interface CodeSpan {
  node: HTMLElement;
  start: number;
  end: number;
}

/** 그 줄의 인라인 코드들 — 값 좌표 `[start, end)`. 글자 없는 것은 뺀다. */
function codeSpans(el: HTMLElement): CodeSpan[] {
  const out: CodeSpan[] = [];
  for (const node of el.querySelectorAll<HTMLElement>('code')) {
    const start = charOffset(el, node, 0);
    const end = start + (node.textContent || '').length;
    if (end > start) out.push({ node, start, end });
  }
  return out;
}

/** 코드 껍질 **안**의 값 자리 `at`에 해당하는 글자 노드 자리. */
function insideSpot(span: CodeSpan, at: number): { node: Node; offset: number } | null {
  const want = Math.max(0, Math.min(at - span.start, span.end - span.start));
  const walk = document.createTreeWalker(span.node, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!caretText(n)) continue;
    const len = n.nodeValue?.length ?? 0;
    if (want <= acc + len) return { node: n, offset: want - acc };
    acc += len;
  }
  const last = edgeText(span.node, true);
  return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

function put(spot: { node: Node; offset: number }): boolean {
  try {
    const range = document.createRange();
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/**
 * 방향키 한 번이 **코드 경계를 지나는 걸음**인가 — 맞으면 우리가 캐럿을 놓는다.
 *
 * @returns `'in'` 코드 **안**에 세웠다 · `'out'` 코드 **밖**에 세웠다(둘 다 호출부가
 *          기본 동작을 막고 그 뜻을 예약한다) · `'leave'` 나가야 하는데 밖에 설
 *          자리가 없다(껍데기가 필요하다) · `null` 이 걸음은 브라우저의 것이다.
 */
export function codeEdgeStep(el: HTMLElement, dir: -1 | 1): 'in' | 'out' | 'leave' | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.focusNode || !el.contains(sel.focusNode)) return null;
  const at = charOffset(el, sel.focusNode, sel.focusOffset);
  const host = sel.focusNode.nodeType === 1 ? (sel.focusNode as HTMLElement) : sel.focusNode.parentElement;
  const inside = (host?.closest?.('code') as HTMLElement | null) ?? null;
  const spans = codeSpans(el);
  if (inside) {
    const me = spans.find((s) => s.node === inside);
    if (!me) return null;
    // 껍질의 끝(머리)에 서 있다 — 한 걸음은 **밖으로**.
    if (dir === 1 ? at >= me.end : at <= me.start) {
      const spot = outerTextSpot(me.node, dir);
      if (spot) return put(spot) ? 'out' : null;
      // 밖에 설 자리가 없다 — →면 껍데기를 세워 내보내고(호출부), ←면 줄 머리라
      // 앞 줄로 넘기는 길이 이미 있다(`onEdgeOut`).
      return dir === 1 ? 'leave' : null;
    }
    /**
     * 안쪽 한 걸음이 **머리에 닿는** 경우만 우리가 놓는다 — 브라우저는 그 자리를
     * 껍질 **밖**으로 접어 버린다(실측: 코드 안 2번째에서 ←가 코드 앞으로 갔다).
     */
    if (dir === -1 && at - 1 <= me.start) {
      const spot = insideSpot(me, me.start);
      return spot && put(spot) ? 'in' : null;
    }
    return null;
  }
  // 밖에서 껍질의 경계에 닿아 있다 — 한 걸음은 **안으로**.
  const enter = spans.find((s) => (dir === 1 ? s.start === at : s.end === at));
  if (!enter) return null;
  const spot = insideSpot(enter, at);
  return spot && put(spot) ? 'in' : null;
}

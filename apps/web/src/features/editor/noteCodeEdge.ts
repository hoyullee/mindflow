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
 *
 * ## 그런데 **그려지는 캐럿**은 여전히 한 자리다 (제보 · 이 판)
 *
 * 자리도 불도 친 글자도 전부 맞는데 **눈에 보이는 막대**가 반대쪽에 서 있다는
 * 제보다. 원인은 같은 접기다 — 크로뮴은 서로 「보이기에 같은」 두 자리를 **위쪽
 * 하나로** 정규화해 그린다. 그래서 코드 **머리**의 두 자리는 둘 다 상자 **밖**에,
 * 코드 **끝**의 두 자리는 둘 다 상자 **안**에 그려진다:
 *
 * | 캐럿이 선 자리 | 코드 불 | 그려지는 막대 |
 * | --- | --- | --- |
 * | 머리 · 안 | ON | 상자 **밖**(틀렸다) |
 * | 머리 · 밖 | OFF | 상자 밖 |
 * | 끝 · 안 | ON | 상자 안 |
 * | 끝 · 밖 | OFF | 상자 **안**(틀렸다) |
 *
 * 실측으로 **좌표는 갈린다**(같은 줄에서 492 / 499.06 / 565.7 / 572.77 — 7px 차이다.
 * 코드의 좌우 여백 0.38em + 테두리 + 마진이 그만큼이다). 값이 있는데 크로뮴이 그걸로
 * 그리지 않을 뿐이라, **우리가 그 좌표에 직접 막대를 세운다**(`codeEdgeCaret`).
 * 네 자리 전부에 세워 두 정거장이 늘 다른 x에 보이게 하고, 안쪽은 코드 잉크로,
 * 바깥쪽은 본문 잉크로 칠해 「다음 글자가 코드인가」를 색으로도 알린다.
 * 그 동안만 그 줄의 기본 캐럿을 감춘다(`caret-color: transparent`).
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

/** 코드 경계에 선 캐럿의 **그릴 자리** — 뷰포트 좌표다(`position: fixed`). */
export interface CodeCaretSpot {
  left: number;
  top: number;
  height: number;
}

interface Edge {
  span: CodeSpan;
  /** 코드의 **머리** 경계인가(아니면 끝). */
  head: boolean;
}

/** 캐럿이 선 **코드 경계** — 아니면 `null`. */
function caretEdge(el: HTMLElement): Edge | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (el.closest?.('[data-note-kind="code"]')) return null; // 코드 블록 안은 상자를 그리지 않는다
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.focusNode || !el.contains(sel.focusNode)) return null;
  const at = charOffset(el, sel.focusNode, sel.focusOffset);
  const host = sel.focusNode.nodeType === 1 ? (sel.focusNode as HTMLElement) : sel.focusNode.parentElement;
  const mine = (host?.closest?.('code') as HTMLElement | null) ?? null;
  const spans = codeSpans(el);
  // 캐럿이 **든 코드**를 먼저 본다 — 코드 둘이 맞붙어 있으면 같은 좌표가 앞의 끝이자
  // 뒤의 머리다. 밖에 서 있으면 그 좌표를 경계로 삼는 첫 코드를 쓴다.
  const span = spans.find((s) => s.node === mine && (at === s.start || at === s.end)) ?? spans.find((s) => at === s.start || at === s.end);
  return span ? { span, head: at === span.start } : null;
}

/**
 * 코드 경계에 선 캐럿의 **약속** — 「다음에 칠 글자가 코드인가」. 경계가 아니면 `null`.
 *
 * 이 한 값이 **툴바의 코드 불과 우리가 그리는 막대의 공통 원천**이다. 둘이 다른 것을
 * 보면 사용자에게는 그것이 곧 버그다(제보: 불은 켜졌는데 막대는 밖에 있다).
 *
 * - **예약이 있으면 그것**(`armCaretMarkAs` — 방향키로 경계를 지날 때 우리가 세운다).
 * - 없으면 **크로뮴의 규칙**: 실측으로 머리 경계는 언제나 밖, 끝 경계는 언제나 안에
 *   글자를 넣는다(캐럿을 어느 노드에 두었든 같다). 그래서 머리면 `false`, 끝이면
 *   `true`다 — 눌러서 온 것이 아니라 **눌러서 생길 일**을 적는다.
 */
export function codeEdgeMark(el: HTMLElement, armedK: boolean | undefined): boolean | null {
  const edge = caretEdge(el);
  if (!edge) return null;
  return typeof armedK === 'boolean' ? armedK : !edge.head;
}

/**
 * 캐럿이 **코드 경계에 서 있으면** `inside` 쪽의 자리를 잰다 — 그리는 것은 호출부다.
 *
 * 자리는 캐럿이 선 노드가 아니라 **`inside`가 가리키는 쪽**에서 잰다: 둘이 어긋나도
 * (크로뮴이 자리를 접으므로 흔한 일이다) 그림은 약속을 따른다.
 */
export function codeEdgeCaret(el: HTMLElement, inside: boolean): CodeCaretSpot | null {
  const edge = caretEdge(el);
  if (!edge) return null;
  const { span, head } = edge;
  const spot = inside ? insideSpot(span, head ? span.start : span.end) : outerTextSpot(span.node, head ? -1 : 1);
  if (!spot) return null; // 줄의 처음·끝이라 밖에 글자 노드가 없다 — 그때는 그리지 않는다
  let box: DOMRect | null = null;
  try {
    const range = document.createRange();
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
    box = range.getBoundingClientRect();
  } catch {
    return null;
  }
  // 높이 0은 「잴 수 없었다」는 뜻이다(요소 경계의 사각형 · jsdom) — 그때는 그리지
  // 않는다. 못 그린 자리에 캐럿까지 감추면 캐럿이 통째로 사라진다.
  if (!box || box.height <= 0) return null;
  return { left: box.left, top: box.top, height: box.height };
}

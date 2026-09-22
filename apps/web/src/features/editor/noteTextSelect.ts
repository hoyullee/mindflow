// 공책 본문의 **글자 선택** — 블록 경계를 넘어 끄는 드래그.
//
// ## 왜 따로 만들어야 하나
//
// 블록마다 편집 박스가 따로다(`contentEditable`이 블록 단위 — 비제어 박스라는 결정의
// 뿌리다). 브라우저의 선택은 **한 편집 호스트 안에 갇혀서**, 문단에서 아래 제목으로
// 끌면 그 경계에서 멈춘다(실측: anchor·focus가 둘 다 첫 블록에 남는다). 페이지 전체를
// 편집 박스 하나로 만들면 해결되지만, 그러면 입력·커밋·캐럿 보존을 통째로 다시 짜야
// 하고 여러 블록에 걸친 브라우저의 편집이 우리 모델과 어긋난다.
//
// ## 그래서 — 칠하기만 우리가 한다
//
// 선택의 **모양**은 `CSS.highlights`(Custom Highlight API)로 그린다: DOM을 건드리지
// 않고 임의의 `Range`에 색을 칠하는 표준이라, 비제어 편집 박스의 내용을 우리가 다시
// 쓰지 않아도 된다(첫 줄은 중간부터, 마지막 줄은 중간까지 — **글자 단위**로 칠해져
// 메모장·업노트의 그 선택과 같아 보인다). 브라우저가 그 API를 모르면 호출부가
// 블록 면으로 물러선다(`supportsHighlight`).
//
// 복사·지우기는 이 `Range`들이 말해 주는 **글자**로 한다 — 블록을 통째로 다루지 않는다.

import { linearize, linearPoints } from './richtextDom';

/** 이 선택에 걸린 한 줄 — 어느 편집 박스의 몇 번째 글자부터 몇 번째까지인가. */
export interface LineSel {
  /** `data-note-line` 키(블록·항목·표 칸을 모두 가리킨다). */
  key: string;
  el: HTMLElement;
  /** 이 줄에서 고른 글자 구간(문자 인덱스). */
  from: number;
  to: number;
  /** 줄 전체 글자 수 — 호출부가 "통째로 골랐나"를 판단한다. */
  length: number;
  range: Range;
}

const HIGHLIGHT_NAME = 'mf-note-sel';
/**
 * `/` 커맨드가 **지금 읽고 있는 글자**를 회색으로 — 선택과 **다른 이름**이라야 한다
 * (같은 이름에 넣으면 둘 중 하나가 다른 하나를 지운다).
 *
 * 왜 배경을 그리나(요청): 이미 쓰인 글 앞에서 `/`를 치면 뒤의 글과 지금 치는 질의가
 * 한 줄에 붙어 보여 **어디까지가 명령인지** 알 수 없다. 값은 건드리지 않고 색만
 * 얹으므로(`CSS.highlights`) 취소하면 아무 흔적도 남지 않는다 — 요청의 "텍스트는
 * 그대로 유지"가 곧 이 성질이다.
 */
const SLASH_NAME = 'mf-note-slash';

/** 이 브라우저가 `CSS.highlights`를 아는가 — 모르면 호출부가 블록 면으로 물러선다. */
export function supportsHighlight(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** 좌표 아래의 캐럿 자리 — 브라우저마다 이름이 다르다(WebKit/Blink · Gecko). */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  try {
    if (typeof doc.caretRangeFromPoint === 'function') {
      const r = doc.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    if (typeof doc.caretPositionFromPoint === 'function') {
      const p = doc.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
  } catch {
    /* 좌표 조회가 없는 환경(jsdom) */
  }
  return null;
}

/**
 * 편집 박스 안에서 (노드, 오프셋)이 **몇 번째 글자**인가 — **값과 같은 좌표계**로.
 *
 * 한때 여기서 텍스트 노드만 훑어 세었다. 그러면 `<br>`(부드러운 줄바꿈)이 든 줄에서
 * **값보다 작은 수**가 나온다 — 값(`domToRuns`)은 `<br>`을 `\n` 한 글자로 세기
 * 때문이다. 그 수를 그대로 `applyNoteFormatRange`에 넘기면 **서식이 고른 자리보다
 * 앞에 걸린다**(제보: `2222`를 골랐는데 `222`가 굵어진다 — `<br>` 하나만큼 밀렸다).
 * 지우기·붙여넣기도 같은 좌표를 쓰므로 한 곳에서 맞춘다: `linearize`가 값의 좌표계다.
 */
export function charOffset(el: HTMLElement, node: Node, offset: number): number {
  return linearize(el, [{ container: node, offset }]).pos[0] ?? 0;
}

/** 그 줄에서 **문자 인덱스**가 가리키는 (노드, 오프셋) — `charOffset`의 역이다. */
export function pointAt(el: HTMLElement, index: number): { node: Node; offset: number } {
  return linearPoints(el, [index])[0] ?? { node: el, offset: el.childNodes.length };
}

/** 그 줄의 **값 기준** 글자 수 — `el.textContent.length`는 `<br>`을 세지 않아 어긋난다. */
export function lineLength(el: HTMLElement): number {
  return linearize(el, []).text.length;
}

/** 그 줄의 **값 기준** 글자들 — 자르는 자리가 `charOffset`과 같은 좌표라야 한다. */
export function lineText(el: HTMLElement): string {
  return linearize(el, []).text;
}

/** 본문의 편집 박스들 — 화면에 놓인 순서(= 문서 순서). */
function linesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-note-line]')];
}

/**
 * 두 지점 사이의 선택 — 줄마다 구간 하나. 같은 줄 안이면 `null`(브라우저에 맡긴다).
 *
 * 방향은 상관없다: 아래에서 위로 끌어도 **문서 순서**로 돌려준다.
 */
export function buildSelection(
  root: HTMLElement,
  a: { el: HTMLElement; node: Node; offset: number },
  b: { el: HTMLElement; node: Node; offset: number },
): LineSel[] | null {
  if (a.el === b.el) return null;
  const lines = linesIn(root);
  const ai = lines.indexOf(a.el);
  const bi = lines.indexOf(b.el);
  if (ai < 0 || bi < 0) return null;
  const [first, last] = ai < bi ? [a, b] : [b, a];
  const [fi, li] = ai < bi ? [ai, bi] : [bi, ai];
  const out: LineSel[] = [];
  for (let i = fi; i <= li; i += 1) {
    const el = lines[i]!;
    const key = el.getAttribute('data-note-line') ?? '';
    const length = lineLength(el);
    const from = i === fi ? charOffset(el, first.node, first.offset) : 0;
    const to = i === li ? charOffset(el, last.node, last.offset) : length;
    const range = document.createRange();
    const s = pointAt(el, Math.min(from, length));
    const e = pointAt(el, Math.min(to, length));
    try {
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
    } catch {
      range.selectNodeContents(el);
    }
    out.push({ key, el, from, to, length, range });
  }
  return out;
}

/**
 * **한 줄 안**의 선택 — `buildSelection`이 만들지 않는 모양이다(그쪽은 두 줄 이상만).
 *
 * 왜 필요한가(제보 10): B줄에서 시작해 C줄까지 끌었다가 **다시 B줄로 돌아오면**
 * 드래그가 얼어붙었다. 돌아온 순간 "같은 줄이면 브라우저에 맡긴다"로 빠져나갔는데,
 * 그때는 이미 우리가 칠하는 중이라 브라우저의 선택을 비우고 박스의 초점까지 거둔
 * 뒤였다 — 맡길 상대가 없었다. 한 번 칠하기 시작했으면 되돌아와도 우리가 그린다.
 */
export function buildLineSelection(el: HTMLElement, a: { node: Node; offset: number }, b: { node: Node; offset: number }): LineSel[] | null {
  const key = el.getAttribute('data-note-line') ?? '';
  const length = lineLength(el);
  const p = charOffset(el, a.node, a.offset);
  const q = charOffset(el, b.node, b.offset);
  const from = Math.min(p, q);
  const to = Math.max(p, q);
  if (from === to) return null;
  const range = document.createRange();
  const s = pointAt(el, Math.min(from, length));
  const e = pointAt(el, Math.min(to, length));
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    range.selectNodeContents(el);
  }
  return [{ key, el, from, to, length, range }];
}

/**
 * 줄 여럿을 **통째로** 고른 모양 — Esc로 여는 **블록 선택**(요청 7)이 쓴다.
 *
 * 블록 선택을 따로 만들지 않고 이 그림에 얹는 이유: 복사·잘라내기·지우기·Tab·
 * 드래그로 넓히기가 전부 이 `LineSel[]` 위에 이미 서 있다. 새 상태를 하나 더 두면
 * 두 선택이 동시에 살아 있는 경우를 매번 갈라야 한다.
 */
export function selectWholeLines(els: HTMLElement[]): LineSel[] | null {
  const out: LineSel[] = [];
  for (const el of els) {
    const key = el.getAttribute('data-note-line') ?? '';
    const length = lineLength(el);
    const range = document.createRange();
    try {
      const s = pointAt(el, 0);
      const e = pointAt(el, length);
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
    } catch {
      range.selectNodeContents(el);
    }
    out.push({ key, el, from: 0, to: length, length, range });
  }
  return out.length ? out : null;
}

/** 고른 글자를 칠한다 — DOM은 건드리지 않는다(`::highlight(mf-note-sel)`). */
export function paint(sel: LineSel[]): void {
  paintRanges(sel.map((s) => s.range));
}

/**
 * 구간 그대로 칠한다 — **한 줄 안의 선택도 우리가 그린다**(제보).
 *
 * 브라우저의 `::selection`은 **줄 높이**를 통째로 덮고 `::highlight()`는 **글자
 * 상자**만 덮는다(실측: 같은 문단에서 27px 대 17px). 그래서 한 줄을 고를 때와 여러
 * 줄을 고를 때 같은 동작의 배경 크기가 달라 보였다. 두 경우 모두 이 함수로 칠하고
 * 본문 줄의 `::selection`은 투명하게 두어 한 벌로 맞춘다.
 */
export function paintRanges(ranges: Range[]): void {
  if (!supportsHighlight()) return;
  if (!ranges.length) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

export function clearPaint(): void {
  if (!supportsHighlight()) return;
  CSS.highlights.delete(HIGHLIGHT_NAME);
}

/** `/질의` 구간을 회색으로 — `null`이면 지운다(`::highlight(mf-note-slash)`). */
export function paintSlash(range: Range | null): void {
  if (!supportsHighlight()) return;
  if (!range) {
    CSS.highlights.delete(SLASH_NAME);
    return;
  }
  CSS.highlights.set(SLASH_NAME, new Highlight(range));
}

/**
 * 그 줄의 **글자 구간**을 가리키는 `Range` — 값의 좌표계(`pointAt`)로 잡는다.
 * 잡을 수 없으면(줄이 다시 그려지는 중) `null`이다.
 */
export function rangeOfChars(el: HTMLElement, from: number, to: number): Range | null {
  try {
    const a = pointAt(el, from);
    const b = pointAt(el, to);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch {
    return null;
  }
}

/**
 * 고른 글자 — 줄바꿈으로 잇는다(클립보드에 그대로 간다).
 *
 * **목록의 표식도 함께 간다**(제보: 번호 매기기를 복사해 붙이면 마커가 사라진다).
 * 표식은 그린 쪽이 줄에 적어 둔 값이다(`data-note-mark` — `- ` · `3. ` · `- [x] `,
 * 들여쓴 단계는 공백 둘씩). 마크다운 모양이라 다른 앱에 붙여도 목록으로 읽히고,
 * 우리 본문으로 되돌아올 때는 `parseNoteText`가 그대로 다시 목록으로 세운다.
 *
 * **줄의 처음부터 골랐을 때만** 붙인다 — 문장 가운데부터 끌었다면 그것은 글의 일부지
 * 항목 하나가 아니다.
 */
export function selectionText(sel: LineSel[]): string {
  return sel
    .map((s) => {
      const body = lineText(s.el).slice(s.from, s.to);
      const mark = s.from === 0 ? (s.el.closest('[data-note-mark]')?.getAttribute('data-note-mark') ?? '') : '';
      return mark + body;
    })
    .join('\n');
}

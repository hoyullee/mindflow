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
/**
 * **찾기에 걸린 글자**(요청) — 공책 안 검색어를 열려 있는 페이지의 글에서 짚어 준다.
 * 선택·`/`와 **또 다른 이름**이다: 셋이 동시에 켜질 수 있고(찾아 둔 채로 글을 고른다),
 * 한 이름에 몰아넣으면 나중에 칠한 쪽이 앞의 것을 지운다.
 */
const FIND_NAME = 'mf-note-find';
/**
 * **조합 중인 인라인 코드**(제보) — 켜 둔 코드 서식은 글자가 들어온 **뒤**에야 값에
 * 걸리는데(`armCaretMark`), 한글은 그 "뒤"가 음절을 확정한 다음이다. 그동안 글자는
 * 평문이라 브라우저의 조합 표시만 보여 "선택한 것 같은 배경"으로 읽혔다.
 *
 * 조합 중에는 **DOM을 건드릴 수 없으므로**(`innerHTML`을 갈면 자모가 갈린다) 칠하기로
 * 흉내만 낸다 — 확정되는 순간 진짜 `<code>`가 그 자리를 이어받는다.
 */
const CODE_NAME = 'mf-note-code';

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

/**
 * 그 줄의 **시각 줄 높이**(px) — 감긴 문단의 한 행이다.
 *
 * `line-height`가 `normal`이면 숫자를 낼 수 없으므로 상자 높이로 물러선다(그러면
 * 한 행짜리 줄과 같은 값이라, 행을 세는 쪽이 "더 갈 행이 없다"로 읽는다 — 안전한
 * 방향이다).
 */
export function rowHeight(el: HTMLElement): number {
  if (typeof getComputedStyle !== 'function') return 0;
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  if (lh > 0) return lh;
  const h = el.getBoundingClientRect().height;
  return h > 0 ? h : 0;
}

/**
 * 캐럿이 놓인 **시각 줄의 경계**(글자 자리) — 앞(`-1`)이면 그 행의 머리, 뒤(`1`)면 끝.
 * 잴 수 없으면 `-1`.
 *
 * **브라우저에게 직접 묻는다**(`Selection.modify`). 사각형으로는 알 수 없기 때문이다:
 * 감긴 줄의 랩 지점은 글자 수로는 한 자리인데 화면에는 둘이고(앞 행의 끝 · 뒷 행의
 * 머리), `Range`의 사각형은 그 자리를 **늘 앞 행으로 접어** 돌려준다
 * (`docs/probe-pitfalls.md` E12). 브라우저만이 캐럿이 둘 중 어느 쪽에 서 있는지
 * (affinity) 안다.
 *
 * `modify`는 선택을 움직이므로 두 끝을 적어 두었다 되돌린다(`setBaseAndExtent`는
 * 방향까지 지킨다 — Shift로 고르는 중에도 안전하다).
 */
export function lineBoundaryAt(el: HTMLElement, sel: Selection, dir: -1 | 1): number {
  const probe = (sel as Selection & { modify?: (a: string, d: string, g: string) => void }).modify;
  if (typeof probe !== 'function' || !sel.anchorNode || !sel.focusNode || !el.contains(sel.focusNode)) return -1;
  const keep = { an: sel.anchorNode, ao: sel.anchorOffset, fn: sel.focusNode, fo: sel.focusOffset };
  try {
    probe.call(sel, 'move', dir === -1 ? 'backward' : 'forward', 'lineboundary');
    const at = sel.focusNode && el.contains(sel.focusNode) ? charOffset(el, sel.focusNode, sel.focusOffset) : -1;
    sel.setBaseAndExtent(keep.an, keep.ao, keep.fn, keep.fo);
    return at;
  } catch {
    try {
      sel.setBaseAndExtent(keep.an, keep.ao, keep.fn, keep.fo);
    } catch {
      /* 되돌리지 못해도 값은 그대로다 */
    }
    return -1;
  }
}

/** 그 구간 글자들의 사각형 — 잴 수 없으면 `null`. */
function charsRect(el: HTMLElement, from: number, to: number): DOMRect | null {
  try {
    const s = linearPoints(el, [from])[0];
    const t = linearPoints(el, [to])[0];
    if (!s || !t) return null;
    const r = document.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(t.node, t.offset);
    const box = r.getBoundingClientRect();
    return box.height > 0 ? box : null;
  } catch {
    return null;
  }
}

/**
 * 캐럿이 **화면에서** 놓인 자리 — 세로줄(`x`)과 그 행의 가운데 높이(`y`).
 *
 * 방향키로 줄을 넘을 때 지킬 값이다(요청: "무조건 사용자가 의도한대로 한 칸씩").
 * 접힌 범위의 사각형을 그대로 쓰면 **랩 지점에서 틀린다** — 그 자리를 브라우저가 늘
 * 앞 행으로 접어 주기 때문에(E12), 감긴 문단의 둘째 행 **머리**에 있는 캐럿이 첫 행의
 * **끝**으로 읽혔다(제보 4: 아래로 내려가면 다음 줄의 둘째 행에 선다).
 *
 * 그래서 먼저 **어느 행에 서 있는지**를 브라우저에게 묻고(`lineBoundaryAt`), 그 행
 * 쪽의 **이웃 글자 한 칸**을 재서 좌표를 얻는다: 행의 머리면 뒤 글자의 왼변,
 * 그 밖에는 앞 글자의 오른변이다. 글자가 아예 없는 빈 줄은 상자의 글 시작 자리다
 * (제보 2: 빈 줄에서 ↑를 누르면 윗줄 **끝**으로 갔다 — 잴 글자가 없어 좌표를 내주지
 * 못했고, 좌표가 없으면 "위로 갈 때는 끝"이라는 옛 규칙이 남는다).
 */
export function caretMetrics(el: HTMLElement, sel: Selection): { x?: number; y?: number } {
  try {
    const node = sel.focusNode && el.contains(sel.focusNode) ? sel.focusNode : el;
    const offset = node === sel.focusNode ? sel.focusOffset : 0;
    const len = lineLength(el);
    const box = el.getBoundingClientRect();
    if (!len) {
      if (!box.height) return {};
      const cs = getComputedStyle(el);
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
      return { x: box.left + pad, y: box.top + Math.min(rowHeight(el) || box.height, box.height) / 2 };
    }
    const at = Math.max(0, Math.min(charOffset(el, node, offset), len));
    const head = at <= 0 || lineBoundaryAt(el, sel, -1) === at;
    const r = head && at < len ? charsRect(el, at, at + 1) : charsRect(el, Math.max(0, at - 1), Math.max(1, at));
    if (!r) return {};
    return { x: head && at < len ? r.left : r.right, y: r.top + r.height / 2 };
  } catch {
    return {};
  }
}

/**
 * 같은 줄(블록) **안**에서 한 행 더 간 자리 — 더 갈 행이 없으면 `null`.
 *
 * 감긴 문단을 Shift+위/아래로 **한 행씩** 고르기 위한 것이다(제보 5). 브라우저는
 * 한 편집 박스 안에서만 이 일을 해 주는데, 우리가 칠하기 시작하면 그 박스에 초점이
 * 없어(`paintAndHold`가 캐럿을 접어 둔다) 더는 해 주지 않는다.
 */
/**
 * 이 줄(블록) **안에 그 방향으로 더 갈 행이 있는가** — 좌표만 본다(글자를 짚지 않는다).
 *
 * `rowStepInLine`이 빈손으로 오는 이유는 둘이다: ① 정말 더 갈 행이 없다 ② 행은 있는데
 * **짚지 못했다**(화면 밖이면 `caretRangeFromPoint`가 답하지 않는다). 둘을 가르지 않으면
 * 화면 아래로 이어지는 긴 문단에서 "다음 행" 대신 **다음 블록**으로 건너뛴다.
 */
export function hasRowBeyond(el: HTMLElement, dir: -1 | 1, y: number | undefined): boolean {
  if (typeof y !== 'number') return false;
  const box = el.getBoundingClientRect();
  const lh = rowHeight(el);
  if (!box.height || !lh) return false;
  const ny = y + dir * lh;
  return ny >= box.top && ny <= box.bottom;
}

export function rowStepInLine(el: HTMLElement, dir: -1 | 1, x: number | undefined, y: number | undefined, at: number): { node: Node; offset: number; y: number } | null {
  if (typeof y !== 'number') return null;
  const box = el.getBoundingClientRect();
  const lh = rowHeight(el);
  if (!box.height || !lh) return null;
  const ny = y + dir * lh;
  if (ny < box.top || ny > box.bottom) return null; // 이 블록에는 더 갈 행이 없다
  const cx = Math.min(Math.max(x ?? box.left + 1, box.left + 1), Math.max(box.left + 1, box.right - 1));
  const spot = caretAt(cx, ny);
  if (!spot || !el.contains(spot.node)) return null;
  // 제자리면 행이 아니라 **여백**을 짚은 것이다(위아래 패딩이 있는 블록) — 넘긴다.
  if (charOffset(el, spot.node, spot.offset) === at) return null;
  return { node: spot.node, offset: spot.offset, y: ny };
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

/** 조합 중인 코드 조각을 칠한다 — `null`이면 지운다(`::highlight(mf-note-code)`). */
export function paintCode(range: Range | null): void {
  if (!supportsHighlight()) return;
  if (!range) {
    CSS.highlights.delete(CODE_NAME);
    return;
  }
  CSS.highlights.set(CODE_NAME, new Highlight(range));
}

/** 찾기에 걸린 구간들을 칠한다 — 빈 목록이면 지운다(`::highlight(mf-note-find)`). */
export function paintFind(ranges: Range[]): void {
  if (!supportsHighlight()) return;
  if (!ranges.length) {
    CSS.highlights.delete(FIND_NAME);
    return;
  }
  CSS.highlights.set(FIND_NAME, new Highlight(...ranges));
}

/**
 * 그 줄에서 `needle`이 나오는 **모든 구간**(대소문자 무시) — 값의 좌표계다.
 *
 * 화면의 글이 아니라 **값**을 훑어야 `<br>`이 든 줄에서도 자리가 맞는다
 * (`lineText`가 그 좌표계이고 `pointAt`이 그 자를 되돌린다 — D5·선택과 같은 규칙).
 */
export function findRangesIn(el: HTMLElement, needle: string): Range[] {
  if (!needle) return [];
  const hay = lineText(el).toLowerCase();
  const want = needle.toLowerCase();
  const out: Range[] = [];
  let at = hay.indexOf(want);
  while (at >= 0) {
    const r = rangeOfChars(el, at, at + want.length);
    if (r) out.push(r);
    at = hay.indexOf(want, at + want.length);
  }
  return out;
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

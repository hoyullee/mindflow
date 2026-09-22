// 공책 본문의 **선택 범위 서식** — DOM/Selection 배관.
//
// ## 왜 맵 에디터의 길을 쓰지 않나
//
// 맵·보드에는 편집 박스가 **한 번에 하나**뿐이다(노드를 두 번 눌러 열고 확정하면
// 닫힌다). 그래서 `useEditorState`의 서식 경로는 `richElRef` 하나를 들고 그 박스에
// 대고 동작한다. 공책은 정반대다: 페이지의 **모든 블록이 늘 편집 가능**하고, 사용자가
// 어느 블록 안에서 글자를 고르면 그 블록에 서식이 걸려야 한다.
//
// 그 전제를 하나로 합치면 맵 쪽의 "한 박스" 불변식이 흔들린다(그 위에 리스트 마커·
// 멘션·모바일 키보드 처리가 얹혀 있다). 그래서 공책은 **지금 선택이 들어 있는
// 요소**를 찾아 거기에 대고 동작하는 작은 배관을 따로 쓴다 — 서식 계산 자체는 코어
// (`applyPartialStyle`)에서 같은 함수를 쓰므로 규칙이 두 벌이 되지는 않는다.

import { applyPartialStyle, charsToRuns, isStyledRuns, parseListPrefix, runsToChars } from '@mindflow/mindmap-core';
import type { RichRun } from '@mindflow/mindmap-core';
import { domToRuns, linearize, runsToHtml, setLinearSelection } from './richtextDom';
import { renderListEdit } from './listLines';

/** 공책 본문에서 걸 수 있는 서식 — 코어 `applyPartialStyle`의 종류와 같다. */
export type NoteFormatKind = 'b' | 'i' | 's' | 'u' | 'k' | 'c' | 'hl' | 'link' | 'clear';

/** 편집 박스임을 알리는 표식 — 선택이 이 안에 있는지 판단하는 기준. */
export const NOTE_EDIT_ATTR = 'data-note-edit';

/**
 * 지금 선택(또는 캐럿)이 들어 있는 공책 편집 박스.
 *
 * 툴바 버튼을 누르는 순간 포커스가 버튼으로 옮겨 가므로 **누르기 전에** 잡아 두어야
 * 한다 — 호출부(`NoteEditor`)가 `mousedown`에서 이 값을 기억한다.
 */
export function noteEditBoxInSelection(): HTMLElement | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return el?.closest(`[${NOTE_EDIT_ATTR}]`) ?? null;
}

/** 이 박스 안의 선택 범위를 **값 좌표**로. 선택이 없거나 밖이면 `null`. */
export function noteSelectionRange(el: HTMLElement): { a: number; b: number } | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const rng = sel.getRangeAt(0);
  if (!el.contains(rng.startContainer) || !el.contains(rng.endContainer)) return null;
  const lin = linearize(el, [
    { container: rng.startContainer, offset: rng.startOffset },
    { container: rng.endContainer, offset: rng.endOffset },
  ]);
  const a = lin.pos[0] ?? 0;
  const b = lin.pos[1] ?? 0;
  return a === b ? null : { a: Math.min(a, b), b: Math.max(a, b) };
}

/** 이 박스의 **지금 값**(사용자가 방금 친 것까지). */
export function noteBoxValue(el: HTMLElement): { text: string; rich: RichRun[] | null } {
  return domToRuns(el, true);
}

/**
 * 값을 이 박스에 **다시 그린다** — 서식을 걸거나 링크를 끼운 뒤의 한 자리.
 *
 * 갈래가 둘인 이유: 표의 칸은 마커가 **글자**라 [마커|내용] 행(`renderListEdit`)으로
 * 그려야 한다. 평평한 `runsToHtml`로 덮으면 서식 한 번에 마커 스팬·행잉 인덴트·
 * EN SPACE 들여쓰기가 통째로 풀렸다(제보 9: "칸의 목록에 링크를 걸면 마커가 틀어진다").
 * 맵의 같은 연산(`useEditorState`의 `applyPartialRange`)이 이미 쓰는 규칙이다.
 *
 * 선택 복원은 **어느 갈래든** `setLinearSelection` 하나다. `a`/`b`는 언제나 `linearize`
 * 좌표인데, 예전의 `restoreSelection`은 텍스트 노드만 세어 `<br>`와 블록 경계를
 * 빠뜨렸다 — Shift+Enter로 줄을 바꾼 **본문**에서도 복원 캐럿이 줄바꿈 수만큼 앞으로
 * 밀렸다(값 좌표를 DOM 자리로 푸는 곳이 둘이 되면 규칙이 갈라진다 — `richtextDom`의
 * 경고가 가리키던 바로 그 자리다).
 */
function redrawBox(el: HTMLElement, v: { text: string; rich: RichRun[] | null }, a: number, b: number): void {
  if (typeof window === 'undefined') return;
  if (el.hasAttribute('data-list-box')) {
    // `renderListEdit`가 `data-list-sig`까지 새긴다 — 없으면 다음 입력의 재구성
    // 판정(`cellListSync`)이 어긋난다. 정렬은 칸이 주지 않는다(`cellListHtml`과 같다).
    renderListEdit(el, v, undefined, a, b);
    return;
  }
  el.innerHTML = runsToHtml(v);
  setLinearSelection(el, a, b);
}

/**
 * 표의 칸에서 **마커 글자를 뺀** 조각들 — `[a, b)`를 줄마다 잘라 `- `/`1. ` 뒤부터만 남긴다.
 *
 * 칸의 마커는 스팬이 아니라 **값에 든 글자**다(`noteCellList`). 그래서 ⌘A로 칸을 통째로
 * 고르고 링크를 걸면 `• `에도 `href`가 얹히고, 그 값이 그대로 문서에 저장된다 — 화면은
 * 재렌더가 마커를 평문으로 다시 그려 가려 주지만 저장본은 오염된 채 남는다.
 *
 * 줄마다 잘라야 한다: 첫 줄만 당기면 여러 줄 칸(`- 가나\n- 다라`)의 가운데·끝 줄 마커가
 * 그대로 물린다.
 */
function contentSpans(text: string, a: number, b: number): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    const start = at + (parseListPrefix(line)?.raw.length ?? 0);
    const end = at + line.length;
    const s = Math.max(a, start);
    const e = Math.min(b, end);
    if (e > s) out.push({ a: s, b: e });
    at = end + 1;
  }
  return out;
}

/**
 * 선택 범위에 서식을 걸고 박스를 다시 그린다. 새 런을 돌려주므로 호출부가 문서에
 * 커밋한다(`null`이면 걸 것이 없었다 — 선택이 비었거나 박스 밖).
 *
 * **다시 그린 뒤 선택을 되돌린다**: 서식을 걸면 DOM 구조가 갈리므로 브라우저의
 * 선택이 통째로 풀린다. 그러면 굵게를 누른 뒤 곧바로 형광펜을 누를 수 없다(고른
 * 글자가 사라져서다) — 연달아 거는 것이 가장 흔한 사용이라 그 자리를 지킨다.
 */
/**
 * 지금 선택(또는 캐럿)에 **걸려 있는 서식** — 툴바가 어떤 단추를 켤지 판단한다.
 *
 * 규칙은 "고른 글자 **전부**가 그 서식일 때만 켜짐"이다(부분만 굵으면 꺼짐) — 그래야
 * 단추를 눌렀을 때 "전체에 건다 / 전체에서 뗀다"가 예측된다. 캐럿만 있을 때(범위 0)는
 * **앞뒤 두 글자**를 본다(제보) — 아래 `noteMarksIn` 머리말.
 */
export function noteActiveMarks(el: HTMLElement): NoteMarks {
  // **접힌 캐럿도 받는다**(제보 9) — 여기서 `noteSelectionRange`를 쓰던 것이 버그였다.
  // 그쪽은 고른 글이 없으면 `null`이라, 아래의 "캐럿이면 앞 글자를 본다"는 규칙이
  // 한 번도 닿지 못했다: 굵은 글 **안**에 커서를 둬도 단추가 꺼져 있었다.
  const range = noteCaretSpan(el);
  if (!range) return NO_MARKS;
  return noteMarksIn(el, range.a, range.b);
}

/** 툴바가 보는 다섯 단추의 켜짐. */
export interface NoteMarks { b: boolean; i: boolean; s: boolean; u: boolean; k: boolean }

const NO_MARKS: NoteMarks = { b: false, i: false, s: false, u: false, k: false };

/** 두 켜짐이 같은가 — 값이 같으면 리렌더하지 않기 위해. */
export function sameMarks(x: NoteMarks, y: NoteMarks): boolean {
  return x.b === y.b && x.i === y.i && x.s === y.s && x.u === y.u && x.k === y.k;
}

/**
 * 이 박스의 **값 좌표 [a, b)**에 걸린 서식.
 *
 * 브라우저 선택과 무관하다 — 그래서 **칠해 둔 선택**(`CSS.highlights`로 그리는 우리
 * 선택)에도 그대로 쓸 수 있다. 서식을 걸고 나면 브라우저 선택을 비우므로(겹친 배경을
 * 막기 위해) 선택에 기대는 길로는 단추가 전부 꺼져 보였다 — 제보: "줄 전체를 고르고
 * 서식을 걸어도 툴바 단추가 켜지지 않는다".
 */
export function noteMarksIn(el: HTMLElement, a: number, b: number): NoteMarks {
  const { rich } = noteBoxValue(el);
  if (!rich || rich.length === 0) return NO_MARKS;
  // 런을 글자 단위로 펴서 [a, b) 구간을 본다 — 런 경계와 선택 경계는 어긋날 수 있다.
  const chars: RichRun[] = [];
  for (const r of rich) for (let i = 0; i < r.t.length; i += 1) chars.push(r);
  /**
   * **접힌 캐럿은 앞뒤를 함께 본다**(제보: 서식이 걸린 글이 커서 **뒤**에 있으면
   * 단추가 꺼져 있다).
   *
   * 예전에는 **앞 글자 하나**만 봤다. 굵은 글 끝에서는 맞지만, 굵은 글의 **머리**에
   * 커서를 두면 — 그 자리도 그 서식의 자리인데 — 꺼져 보였다. 두 이웃 중 하나라도
   * 그 서식이면 켠다: "이 자리가 그 서식의 자리인가"가 사람이 묻는 것이고, 경계에
   * 섰을 때 켜 두는 편이 꺼 두는 편보다 덜 놀랍다(꺼져 있으면 "왜 안 켜지지"가 되고,
   * 켜져 있으면 눌러서 끄면 된다).
   */
  if (a === b) {
    const near = [chars[a - 1], chars[a]].filter((r): r is RichRun => !!r);
    if (near.length === 0) return NO_MARKS;
    const any = (pick: (r: RichRun) => boolean): boolean => near.some(pick);
    return { b: any((r) => !!r.b), i: any((r) => !!r.i), s: any((r) => !!r.s), u: any((r) => !!r.u), k: any((r) => !!r.k) };
  }
  const span = chars.slice(a, b);
  if (span.length === 0) return NO_MARKS;
  const all = (pick: (r: RichRun) => boolean): boolean => span.every(pick);
  return {
    b: all((r) => !!r.b),
    i: all((r) => !!r.i),
    s: all((r) => !!r.s),
    u: all((r) => !!r.u),
    k: all((r) => !!r.k),
  };
}

/**
 * **여러 줄**에 걸친 선택의 서식 — 줄마다 보고 **전부 켜져 있을 때만** 켠다.
 *
 * 한 줄 규칙("고른 글자 전부가 그 서식일 때만")을 줄 바깥으로 그대로 늘린 것이다.
 * 글자가 하나도 없는 줄(빈 줄)은 판단에서 뺀다 — 여러 줄을 끌면 중간에 빈 줄이
 * 섞이기 쉬운데, 그 줄 때문에 전부 꺼지면 "왜 안 켜지지"가 된다.
 */
export function noteMarksAcross(spans: { el: HTMLElement; from: number; to: number }[]): NoteMarks {
  const each = spans
    .filter((s) => s.to > s.from)
    .map((s) => noteMarksIn(s.el, s.from, s.to));
  if (each.length === 0) return NO_MARKS;
  return {
    b: each.every((m) => m.b),
    i: each.every((m) => m.i),
    s: each.every((m) => m.s),
    u: each.every((m) => m.u),
    k: each.every((m) => m.k),
  };
}

/**
 * 이 박스의 **캐럿 자리**(선택이 있으면 그 구간) — 접혀 있어도 돌려준다.
 *
 * `noteSelectionRange`는 접힌 캐럿에 `null`을 준다(서식은 고른 글이 있어야 한다).
 * 링크 **넣기**는 반대다 — 고른 글이 없으면 그 자리에 글자를 만들어 건다.
 */
export function noteCaretSpan(el: HTMLElement): { a: number; b: number } | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const rng = sel.getRangeAt(0);
  if (!el.contains(rng.startContainer) || !el.contains(rng.endContainer)) return null;
  const lin = linearize(el, [
    { container: rng.startContainer, offset: rng.startOffset },
    { container: rng.endContainer, offset: rng.endOffset },
  ]);
  const a = lin.pos[0] ?? 0;
  const b = lin.pos[1] ?? 0;
  return { a: Math.min(a, b), b: Math.max(a, b) };
}

/**
 * **글자를 만들어 링크를 건다** — 고른 글이 없을 때의 링크 넣기(제보 1).
 *
 * 예전에는 링크 단추가 `prompt`로 주소만 받아 `applyNoteFormat('link')`로 넘겼는데,
 * 그 함수는 **고른 글이 없으면 아무 일도 하지 않는다**(걸 자리가 없다). 그래서
 * 글을 고르지 않고 누르면 주소를 적고 확인을 눌러도 화면이 그대로였다.
 *
 * 여기서는 캐럿 자리(또는 고른 구간)를 `label`로 **갈아 끼운 뒤** 그 구간에 주소를
 * 건다. 글자 단위로 다루므로 앞뒤에 걸린 굵게·형광펜은 그대로 살아남는다.
 */
export function insertNoteLink(el: HTMLElement, span: { a: number; b: number }, label: string, href: string): RichRun[] | null {
  if (!label) return null;
  const v = noteBoxValue(el);
  // 칸의 캐럿이 마커 글자(`- `/`1. `) 안이면 **내용 앞으로 민다** — 거기에 끼우면
  // 그 줄의 목록 표식이 깨져 줄이 목록에서 풀린다.
  if (el.hasAttribute('data-list-box')) {
    const at = contentSpans(v.text, span.a, Math.max(span.b, span.a + 1))[0];
    if (at && at.a > span.a) span = { a: at.a, b: Math.max(at.a, span.b) };
  }
  const chars = runsToChars(v);
  chars.splice(span.a, span.b - span.a, ...Array.from(label).map((ch) => ({ ch, b: false, c: null })));
  const text = chars.map((c) => c.ch).join('');
  const runs = charsToRuns(chars).filter((r) => r.t);
  const next = applyPartialStyle({ text, rich: isStyledRuns(runs) ? runs : null }, span.a, span.a + label.length, 'link', href);
  const end = span.a + label.length;
  redrawBox(el, next, end, end);
  return next.rich ?? [{ t: next.text, b: false, c: null }];
}

/**
 * **캐럿만 있을 때의 서식** — 고른 글이 없어도 걸린다(제보 2: 빈 줄에서 인라인 코드를
 * 눌러도 아무 일이 없다).
 *
 * ## 왜 빈 요소를 심지 않나 (실브라우저에서 한 번 틀렸다)
 *
 * 처음에는 `<code></code>`를 캐럿 자리에 심고 그 안의 빈 텍스트 노드에 캐럿을 두었다.
 * jsdom에서는 통과했지만 **크롬에서는 다음 글자가 그 요소 **앞**에 떨어진다**(실측:
 * `npm i<code></code>`) — 폭이 0인 인라인 요소 안의 자리는 브라우저가 "보이는 자리"로
 * 치지 않아 바로 앞으로 접어 버린다. 폭을 만들려고 ZWSP를 끼우는 흔한 수법은 값에
 * 없는 글자를 DOM에 남기는데, 이 편집기는 `linearize`와 `domToRuns`가 **같은 글자 수**를
 * 세는 것을 계약으로 삼고 있어(캐럿 좌표가 전부 거기 기댄다) 그 순간 좌표가 어긋난다.
 *
 * ## 그래서 **다음 한 글자를 기다린다**
 *
 * 눌린 서식은 자리(`at`)와 그때의 글자 수(`len`)만 적어 둔다. 글자가 들어오면 그때
 * 비로소 걸 자리가 생기므로, **이미 서 있는 범위 서식 경로**(`applyNoteFormatRange`)에
 * 그 한 글자를 넘긴다. 두 번째 글자부터는 브라우저가 알아서 그 요소 안에서 이어 친다
 * (굵게·기울임이 늘 그렇듯이).
 *
 * 적어 둔 것은 **한 벌뿐**이다 — 서식을 켜 두는 일은 "다음에 칠 글자"에 대한 것이라
 * 동시에 둘이 될 수 없고, 다른 줄에서 다시 누르면 앞의 것은 잊힌다.
 */
let armed: { el: HTMLElement; at: number; len: number; kind: NoteFormatKind; val: string | null } | null = null;

/** 접힌 캐럿에 서식을 **예약한다** — 걸 자리가 없으면(선택이 있으면) `false`. */
export function armCaretMark(el: HTMLElement, kind: NoteFormatKind, val?: string | null): boolean {
  if (kind === 'clear' || kind === 'link') return false;
  const span = noteCaretSpan(el);
  if (!span || span.a !== span.b) return false;
  armed = { el, at: span.a, len: linearize(el, []).text.length, kind, val: val ?? null };
  return true;
}

/** 예약을 버린다 — 줄을 떠나면 그 자리도 사라진다. */
export function disarmCaretMark(el?: HTMLElement): void {
  if (!el || armed?.el === el) armed = null;
}

/** 지금 이 줄에 예약된 서식 — 툴바가 단추를 미리 켜 두는 데 쓴다(없으면 `null`). */
export function armedCaretMark(el: HTMLElement | null): NoteFormatKind | null {
  return el && armed?.el === el ? armed.kind : null;
}

/** 예약이 걸린 **글자 자리** — 조합 중에 그 구간을 칠할 때 쓴다(`paintCode`). */
export function armedCaretAt(el: HTMLElement | null): number | null {
  return el && armed?.el === el ? armed.at : null;
}

/**
 * **방금 들어온 글자에** 예약한 서식을 건다 — 걸었으면 새 런, 아니면 `null`.
 *
 * 자리가 맞을 때만 건다: 캐럿이 앞으로 갔고, 늘어난 글자 수가 그 걸음과 **같아야**
 * 한다. 예약해 놓고 캐럿을 옮겨 다른 데 쳤다면 그 둘이 어긋나므로 조용히 잊는다.
 */
export function fireCaretMark(el: HTMLElement): RichRun[] | null {
  if (!armed || armed.el !== el) return null;
  const { at, len, kind, val } = armed;
  const span = noteCaretSpan(el);
  const now = span && span.a === span.b ? span.a : -1;
  const grew = linearize(el, []).text.length - len;
  armed = null;
  if (now <= at || grew <= 0 || now - at !== grew) return null;
  const runs = applyNoteFormatRange(el, at, now, kind, val);
  // 다시 그린 뒤의 선택은 **친 글자 전체**다 — 캐럿은 그 끝에 접혀 있어야 이어 친다.
  if (runs) setLinearSelection(el, now, now);
  return runs;
}

export function applyNoteFormat(el: HTMLElement, kind: NoteFormatKind, val?: string | null): RichRun[] | null {
  const range = noteSelectionRange(el);
  if (!range) return null;
  return applyNoteFormatRange(el, range.a, range.b, kind, val);
}

/**
 * 같은 일을 **자리를 지정해서** — 팝업이 떠 있는 동안에는 선택을 읽을 수 없다.
 *
 * 입력칸에 초점이 가는 순간 편집 박스의 선택은 사라진다. 그래서 링크 팝업은 **열 때**
 * 구간을 적어 두고 확인할 때 이 함수로 넘긴다(제보 1의 수리에서 갈라 낸 자리다).
 */
export function applyNoteFormatRange(el: HTMLElement, a: number, b: number, kind: NoteFormatKind, val?: string | null): RichRun[] | null {
  if (a === b) return null;
  const parsed = noteBoxValue(el);
  // 칸이면 마커 글자는 건너뛴다 — 서식이 얹히면 그 값이 그대로 저장된다.
  const spans = el.hasAttribute('data-list-box') ? contentSpans(parsed.text, a, b) : [{ a, b }];
  if (!spans.length) return null;
  let next = parsed;
  // 글자 수는 서식으로 달라지지 않으므로 좌표는 조각 사이에서도 그대로다.
  for (const sp of spans) next = applyPartialStyle(next, sp.a, sp.b, kind, val ?? null);
  redrawBox(el, next, a, b);
  return next.rich ?? [{ t: next.text, b: false, c: null }];
}

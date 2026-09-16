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

import { applyPartialStyle } from '@mindflow/mindmap-core';
import type { RichRun } from '@mindflow/mindmap-core';
import { domToRuns, linearize, runsToHtml } from './richtextDom';

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

/** 선택 범위를 값 좌표로 되돌린다 — 서식을 걸어 다시 그린 뒤 캐럿이 튀지 않게. */
function restoreSelection(el: HTMLElement, a: number, b: number): void {
  if (typeof window === 'undefined') return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let start: { node: Node; offset: number } | null = null;
  let end: { node: Node; offset: number } | null = null;
  let node = walker.nextNode();
  while (node) {
    const len = (node.nodeValue || '').length;
    if (!start && seen + len >= a) start = { node, offset: a - seen };
    if (!end && seen + len >= b) end = { node, offset: b - seen };
    if (start && end) break;
    seen += len;
    node = walker.nextNode();
  }
  if (!start || !end) return;
  try {
    const rng = document.createRange();
    rng.setStart(start.node, Math.max(0, Math.min(start.offset, (start.node.nodeValue || '').length)));
    rng.setEnd(end.node, Math.max(0, Math.min(end.offset, (end.node.nodeValue || '').length)));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(rng);
  } catch {
    // 범위를 되돌리지 못해도 서식은 걸렸다 — 캐럿만 잃는다(막을 이유가 없다).
  }
}

/**
 * 선택 범위에 서식을 걸고 박스를 다시 그린다. 새 런을 돌려주므로 호출부가 문서에
 * 커밋한다(`null`이면 걸 것이 없었다 — 선택이 비었거나 박스 밖).
 *
 * **다시 그린 뒤 선택을 되돌린다**: 서식을 걸면 DOM 구조가 갈리므로 브라우저의
 * 선택이 통째로 풀린다. 그러면 굵게를 누른 뒤 곧바로 형광펜을 누를 수 없다(고른
 * 글자가 사라져서다) — 연달아 거는 것이 가장 흔한 사용이라 그 자리를 지킨다.
 */
export function applyNoteFormat(el: HTMLElement, kind: NoteFormatKind, val?: string | null): RichRun[] | null {
  const range = noteSelectionRange(el);
  if (!range) return null;
  const parsed = noteBoxValue(el);
  const next = applyPartialStyle(parsed, range.a, range.b, kind, val ?? null);
  el.innerHTML = runsToHtml(next);
  restoreSelection(el, range.a, range.b);
  return next.rich ?? [{ t: next.text, b: false, c: null }];
}

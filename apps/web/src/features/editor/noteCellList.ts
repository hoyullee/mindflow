// 표 **칸 안의 목록** — 글머리 기호·번호 매기기를 본문과 같은 규칙으로.
//
// ## 왜 칸만 따로인가
//
// 공책 본문의 목록은 **블록**이다(`NoteBlock.items` — 항목마다 편집 박스가 따로고
// 마커는 그 옆에 그려진다). 표의 칸은 그럴 수 없다: 모델이 `RichRun[]` **하나**라
// 한 칸 안에 블록을 담을 자리가 없고, 담게 만들면 표의 행·열 편집이 통째로 달라진다.
//
// 그래서 칸에서는 **마커가 곧 글자**다 — 맵의 도형·메모가 이미 쓰는 그 방식이고
// (코어 `list.ts`: "텍스트 마커가 곧 데이터"), 판정·들여쓰기·번호 매기기·이어쓰기가
// 전부 그 순수 모듈 한 곳에 있다. 이 파일은 그 엔진을 **공책의 편집 박스**에 붙이는
// 접착 코드다(값 읽기 → 코어에 묻기 → 글자 단위로 고쳐 다시 그리기 → 커밋).
//
// 겉모습은 `listEditHtml`이 그린다(마커는 `[data-list-marker]` 스팬) — 색·글꼴은
// `editor.css`가 본문 목록과 같은 값으로 맞춘다.

import type { RichRun, TextEdit } from '@mindflow/mindmap-core';
import {
  applyListOp,
  charsToRuns,
  continueListMarker,
  isStyledRuns,
  listBackspaceOp,
  parseListPrefix,
  renumberEdits,
  runsToChars,
  shiftOffset,
  textRuns,
} from '@mindflow/mindmap-core';
import { linearize, liveEditValue } from './richtextDom';
import { domMarkerSignature, listEditHtml, listSigOf, listSignature, markerSignature, renderListEdit } from './listLines';

/** 편집 박스의 **지금 값과 고른 구간** — `<br>`·블록 줄바꿈을 한 글자로 센다. */
function boxState(el: HTMLElement): { text: string; rich: RichRun[] | null; a: number; b: number } {
  const v = liveEditValue(el);
  const end = v.text.length;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return { text: v.text, rich: v.rich, a: end, b: end };
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return { text: v.text, rich: v.rich, a: end, b: end };
  const lin = linearize(el, [
    { container: r.startContainer, offset: r.startOffset },
    { container: r.endContainer, offset: r.endOffset },
  ]);
  const p0 = lin.pos[0] ?? 0;
  const p1 = lin.pos[1] ?? p0;
  return { text: v.text, rich: v.rich, a: v.clamp(Math.min(p0, p1)), b: v.clamp(Math.max(p0, p1)) };
}

/** 그 자리의 줄(줄바꿈 사이). */
function lineAt(text: string, at: number): { start: number; line: string } {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const nl = text.indexOf('\n', at);
  return { start, line: text.slice(start, nl === -1 ? text.length : nl) };
}

/** 고른 구간에 **리스트 줄이 하나라도** 있는가 — Tab을 우리가 받을지 가른다. */
function rangeHasList(text: string, a: number, b: number): boolean {
  let at = text.lastIndexOf('\n', a - 1) + 1;
  for (;;) {
    const nl = text.indexOf('\n', at);
    const end = nl === -1 ? text.length : nl;
    if (parseListPrefix(text.slice(at, end))) return true;
    if (nl === -1 || nl >= b) return false;
    at = nl + 1;
  }
}

/**
 * 줄 접두 편집들을 **글자 모델에 그대로 splice** 하고 다시 그린 뒤 커밋한다.
 *
 * 글자 단위로 고치는 이유: 코어의 연산은 줄 **접두만** 바꾸므로, 본문에 걸어 둔
 * 굵게·링크·형광펜이 그대로 살아남는다(문자열을 통째로 갈면 전부 잃는다).
 * 고친 뒤에는 이웃 번호를 다시 센다 — 한 줄만 보는 연산이 놓치는 자리다.
 */
function commitEdits(el: HTMLElement, st: { text: string; rich: RichRun[] | null }, edits: TextEdit[], caret: number, onChange: (runs: RichRun[]) => void): void {
  const chars = runsToChars({ text: st.text, rich: st.rich });
  const splice = (list: TextEdit[]): void => {
    [...list]
      .sort((x, y) => y.at - x.at)
      .forEach((ed) => chars.splice(ed.at, ed.remove, ...Array.from(ed.insert).map((ch) => ({ ch, b: false, c: null }))));
  };
  splice(edits);
  const renum = renumberEdits(chars.map((c) => c.ch).join(''));
  splice(renum);
  const text = chars.map((c) => c.ch).join('');
  const runs = charsToRuns(chars).filter((r) => r.t);
  const rich = isStyledRuns(runs) ? runs : null;
  const at = shiftOffset(caret, renum);
  renderListEdit(el, { text, rich }, undefined, at, at);
  onChange(rich ?? textRuns(text));
}

/** 마운트할 때 그릴 HTML — 마커가 있으면 [마커|내용] 행으로. */
export function cellListHtml(v: { text: string; rich: RichRun[] | null }): string {
  return listEditHtml(v);
}

/**
 * 친 글자가 **마커를 만들거나 지웠으면** 그 자리에서 다시 그린다.
 *
 * `- `를 치는 순간 `• `가 되는 것도 여기다(값은 그대로 두고 표시만 그 단계의
 * 글리프로 — 글자 수가 같아 캐럿·오프셋이 흔들리지 않는다. 다음 커밋에서 값도
 * 그 글리프가 된다). 줄 구성이 그대로면 **아무것도 하지 않는다** — 타이핑마다
 * `innerHTML`을 갈면 캐럿이 튀고 한글 조합이 끊긴다.
 */
export function cellListSync(el: HTMLElement): void {
  const v = liveEditValue(el);
  // 마커 스팬 **안에** 글자가 들어갔는지도 본다 — 그 스팬은 `white-space: pre`라
  // 줄바꿈되지 않아 칸을 뚫고 나간다(맵에서 겪은 그 제보와 같은 자리).
  const drifted = domMarkerSignature(el) !== markerSignature(v);
  if (!drifted && listSignature(v) === listSigOf(el)) return;
  const st = boxState(el);
  renderListEdit(el, v, undefined, st.a, st.b);
}

/** Tab · Shift+Tab — 고른 줄들을 들이거나 내민다. 리스트 줄이 없으면 `false`. */
export function cellListTab(el: HTMLElement, back: boolean, onChange: (runs: RichRun[]) => void): boolean {
  const st = boxState(el);
  if (!rangeHasList(st.text, st.a, st.b)) return false;
  const edits = applyListOp(st.text, st.a, st.b, { type: 'indent', dir: back ? -1 : 1 });
  // 더 들어갈 자리가 없어도 **Tab은 우리가 먹는다** — 그러지 않으면 초점이 다음
  // 칸으로 새 버린다(본문 목록에서 이미 겪은 제보와 같은 규칙).
  if (edits.length) commitEdits(el, st, edits, shiftOffset(st.b, edits), onChange);
  return true;
}

/** Shift+Enter — 리스트 줄이면 다음 줄에 마커를 잇는다(빈 항목이면 내어쓰기/종료). */
export function cellListBreak(el: HTMLElement, onChange: (runs: RichRun[]) => void): boolean {
  const st = boxState(el);
  const { start, line } = lineAt(st.text, st.a);
  const cont = continueListMarker(line);
  if (!cont) return false;
  if ('end' in cont) {
    const p = parseListPrefix(line);
    const edits: TextEdit[] = [{ at: start, remove: p ? p.raw.length : 0, insert: cont.replaceWith }];
    commitEdits(el, st, edits, start + cont.replaceWith.length, onChange);
    return true;
  }
  const insert = `\n${cont.next}`;
  commitEdits(el, st, [{ at: st.a, remove: st.b - st.a, insert }], st.a + insert.length, onChange);
  return true;
}

/** 마커 안에서의 Backspace — 한 단계 내어쓰거나 마커를 통째로 걷는다. */
export function cellListBackspace(el: HTMLElement, onChange: (runs: RichRun[]) => void): boolean {
  const st = boxState(el);
  if (st.a !== st.b) return false;
  const act = listBackspaceOp(st.text, st.a);
  if (!act) return false;
  const edits = act.kind === 'op' ? applyListOp(st.text, st.a, st.a, act.op) : act.edits;
  if (!edits.length) return false;
  commitEdits(el, st, edits, shiftOffset(st.a, edits), onChange);
  return true;
}

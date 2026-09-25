// `@질의`를 지우고 그 자리에 **칩 하나**를 끼우는 순수 계산.
//
// DOM을 모른다 — 줄의 글자와 런만 받아 새 런을 돌려준다. 이렇게 갈라 둔 이유는
// 끼우는 규칙(앞뒤 서식을 지킨다 · 뒤에 공백 하나 · 캐럿은 그 뒤)이 **세 갈래로
// 불리기** 때문이다: 멘션 허브, `/날짜`, 그리고 나중에 붙일 붙여넣기. 규칙이 세
// 곳에 흩어지면 "칩 뒤에 공백이 있을 때와 없을 때"가 생긴다.

import { charsToRuns, runsToChars } from '@mindflow/mindmap-core';
import type { RichRun } from '@mindflow/mindmap-core';

/** 칩이 들고 갈 **뜻** — 셋 중 하나만 채운다. */
export interface ChipMark {
  /** 사람 멘션의 이메일(`RichRun.m`). */
  m?: string;
  /** 날짜 칩이 가리키는 날(`RichRun.dt`). */
  dt?: string;
  /** 문서 안 페이지 링크(`RichRun.pg`). */
  pg?: string;
}

/**
 * 칩 **뒤에 놓는 공백**은 보통 칸이 아니라 `\u00A0`(고정 폭 공백)다.
 *
 * 보통 칸이면 줄 끝에서 브라우저가 접어 버려(`white-space` 규칙) 캐럿이 칩에
 * 달라붙고, 이어 친 글자가 칩 **안으로** 들어간다. 폭이 같은 고정 칸을 쓰면 그
 * 자리가 확실히 남는다 — 값에는 한 글자로 남지만 읽기에는 평범한 띄어쓰기다.
 */
export const CHIP_TAIL = '\u00A0';

/**
 * `[at, at + cut)`을 지우고 그 자리에 `label`(칩) + 공백 하나를 끼운다.
 *
 * @param text 그 줄의 지금 글자
 * @param runs 그 줄의 지금 런(빈 배열이면 평문으로 본다)
 * @param at   지울 구간의 시작(보통 `@`가 놓인 자리)
 * @param cut  지울 글자 수(보통 `1 + 질의 길이`)
 * @param label 칩에 보일 글자 — 사람은 `@김서연`, 날짜는 `8월 27일 목`
 * @param mark 칩의 뜻(`m`/`dt`/`pg` 중 하나)
 * @returns 새 글자·런과, **칩 뒤 공백 다음**에 서야 할 캐럿 자리
 */
export function insertChip(
  text: string,
  runs: RichRun[],
  at: number,
  cut: number,
  label: string,
  mark: ChipMark,
): { text: string; runs: RichRun[]; caret: number } {
  const chars = runsToChars({ text, rich: runs.length ? runs : null });
  const from = Math.max(0, Math.min(at, chars.length));
  const to = Math.max(from, Math.min(from + cut, chars.length));
  // 칩의 글자들은 **모두 같은 뜻**을 든다 — `charsToRuns`가 그 뜻으로 한 런을 만든다.
  const chip = [...label].map((ch) => ({ ch, b: false, c: null, ...mark }));
  const tail = { ch: CHIP_TAIL, b: false, c: null };
  const next = charsToRuns([...chars.slice(0, from), ...chip, tail, ...chars.slice(to)]).filter((r) => r.t);
  return { text: next.map((r) => r.t).join(''), runs: next, caret: from + [...label].length + 1 };
}

// Partial (per-character-range) rich-text styling — pure port of
// `Component#applyPartial`'s char-model (MindFlow.dc.html:2700-2727) plus its
// `stripRich` helper (MindFlow.dc.html:2727). The original does this
// execCommand-free: it explodes the node's `rich` runs (or its plain `text`,
// treated as one unstyled run) into one entry per CHARACTER, mutates the
// bold/color of just the `[s0, s1)` slice, then re-merges adjacent
// same-style characters back into runs. This module is the DOM-free half of
// that pipeline — everything except the Selection/Range ↔ text-offset
// plumbing (`linearize`/`setLinearSelection`), which is inherently a browser
// concern and lives in `apps/web` instead (see that package's `richtextDom.ts`).
//
// Kept intentionally decoupled from `Node`: callers pass just the
// `{ text, rich }` slice they care about (a node's own fields, or any other
// rich-text-bearing source) rather than a whole `Node`.

import type { RichRun } from './model';

/** The `{ text, rich }` shape `applyPartialStyle` reads/writes — a structural
 * subset of `Node` (and anything else that carries a rich-text body). */
export interface RichSource {
  text: string;
  rich?: RichRun[] | null;
}

/** One character with its resolved style — the exploded form `applyPartial`
 * operates on before re-merging (MindFlow.dc.html:2710-2711). */
export interface RichChar {
  ch: string;
  b: boolean;
  c: string | null;
  /** 기울임 — post-dc 추가(RichRun.i 참고). 리터럴 편의상 옵션이지만
   * `runsToChars`는 항상 채워 준다(소비부는 `!!`로 읽는다). */
  i?: boolean;
  /** 취소선 — post-dc 추가(RichRun.s 참고). */
  s?: boolean;
}

/** Explodes `src.rich` (or, absent that, `src.text` as one unstyled run) into
 * one `RichChar` per character — port of `applyPartial`'s `chars` build
 * (MindFlow.dc.html:2709-2711). */
export function runsToChars(src: RichSource): RichChar[] {
  const runs: RichRun[] = src.rich && src.rich.length ? src.rich : [{ t: src.text, b: false, c: null }];
  const chars: RichChar[] = [];
  runs.forEach((r) => {
    const t = r.t || '';
    for (let i = 0; i < t.length; i++) chars.push({ ch: t[i]!, b: !!r.b, c: r.c || null, i: !!r.i, s: !!r.s });
  });
  return chars;
}

/** Re-merges adjacent same-style characters back into runs — port of
 * `applyPartial`'s `nruns` build (MindFlow.dc.html:2721-2722). Does NOT
 * decide `null`-vs-array (a caller normally follows up with the
 * `.some(r => r.b || r.c)` "styled?" check, same as the original). */
export function charsToRuns(chars: RichChar[]): RichRun[] {
  const runs: RichRun[] = [];
  chars.forEach((x) => {
    const last = runs[runs.length - 1];
    if (last && !!last.b === x.b && (last.c || null) === x.c && !!last.i === !!x.i && !!last.s === !!x.s) last.t += x.ch;
    else {
      // i/s는 true일 때만 키를 만든다 — 원본(dc) 시절 문서와 같은 직렬화 모양을
      // 유지해 골든/CRDT 무회귀 (RichRun doc 참고).
      const r: RichRun = { t: x.ch, b: x.b, c: x.c };
      if (x.i) r.i = true;
      if (x.s) r.s = true;
      runs.push(r);
    }
  });
  return runs;
}

/**
 * Applies a partial style to the `[s0, s1)` character range (order-agnostic —
 * a reversed selection is normalized just like the original) — pure port of
 * `Component#applyPartial` (MindFlow.dc.html:2701-2725), minus the
 * Selection/DOM plumbing (the caller resolves `s0`/`s1` via `linearize`
 * first, and re-applies the DOM selection via `setLinearSelection` after).
 *
 * - `kind: 'b'`: toggles bold across the WHOLE selected range at once — bold
 *   only if the selection wasn't already all-bold (mirrors `!seg.every(x =>
 *   x.b)`, MindFlow.dc.html:2715), so a mixed selection first turns fully
 *   bold, and only a fully-bold selection un-bolds.
 * - `kind: 'c'`: sets every selected character's color to `val`.
 * - `kind: 'clear'`: strips both bold and color from the selected range.
 *
 * `s0 === s1` (a collapsed/empty selection, or a selection clamped down to
 * nothing past the end of the text) is a no-op — returns `src`'s own
 * text/rich unchanged (normalized: an empty `rich` array collapses to
 * `null`), matching the original's early `if (s0 === s1) return;`.
 */
export function applyPartialStyle(src: RichSource, s0In: number, s1In: number, kind: 'b' | 'i' | 's' | 'c' | 'clear', val?: string | null): { text: string; rich: RichRun[] | null } {
  let s0 = s0In;
  let s1 = s1In;
  if (s1 < s0) {
    const t = s0;
    s0 = s1;
    s1 = t;
  }
  const chars = runsToChars(src);
  s1 = Math.min(s1, chars.length);
  s0 = Math.min(s0, s1);
  if (s0 === s1) {
    return { text: src.text, rich: src.rich && src.rich.length ? src.rich : null };
  }
  const seg = chars.slice(s0, s1);
  // 토글류(b/i/s)는 굵게와 같은 규칙: 전부 켜져 있을 때만 끈다(혼합 선택은 먼저 켠다).
  const target = kind === 'b' ? !seg.every((x) => x.b) : kind === 'i' ? !seg.every((x) => x.i) : kind === 's' ? !seg.every((x) => x.s) : null;
  for (let idx = s0; idx < s1; idx++) {
    const c = chars[idx]!;
    if (kind === 'b') c.b = target as boolean;
    else if (kind === 'i') c.i = target as boolean;
    else if (kind === 's') c.s = target as boolean;
    else if (kind === 'c') c.c = val ?? null;
    else {
      c.b = false;
      c.c = null;
      c.i = false;
      c.s = false;
    }
  }
  const nruns = charsToRuns(chars).filter((r) => r.t);
  const styled = nruns.some((r) => r.b || r.c || r.i || r.s);
  return { text: chars.map((x) => x.ch).join(''), rich: styled ? nruns : null };
}

/** Removes one style key from every run, dropping back to plain (`null`)
 * `rich` if nothing else is styled afterward — pure port of `Component#stripRich`
 * (MindFlow.dc.html:2727), used when a WHOLE-node style toggle (e.g. the
 * bold-everything button) should override any conflicting partial run. */
export function stripRichStyle(rich: RichRun[] | null | undefined, key: 'b' | 'c' | 'i' | 's'): RichRun[] | null {
  if (!rich || !rich.length) return null;
  const next = rich.map((r) => {
    const o = { ...r };
    delete o[key];
    return o;
  });
  return next.some((r) => r.b || r.c || r.i || r.s) ? next : null;
}

// ── 마크다운 단축 문법 ─────────────────────────────────────────────────────

interface MdPattern {
  re: RegExp;
  key: 'b' | 'i' | 's';
  /** 마커 길이(한쪽) — `**`=2, `*`=1. */
  mark: number;
  /** `_`/`__` 변형: 단어 내부(양쪽이 영숫자/밑줄)에서는 발동하지 않는다 —
   * snake_case 식 식별자를 보호하는 CommonMark의 intra-word underscore 규칙. */
  word?: boolean;
}

// 순서 중요: 이중 마커(**, __, ~~)를 단일 마커(*, _)보다 먼저 — `**굵게**`가
// `*…*` 기울임으로 반쪽 해석되지 않게.
const MD_PATTERNS: MdPattern[] = [
  { re: /\*\*([^*\n]+)\*\*/g, key: 'b', mark: 2 },
  { re: /__([^_\n]+)__/g, key: 'b', mark: 2, word: true },
  { re: /~~([^~\n]+)~~/g, key: 's', mark: 2 },
  // 단일 `*`에도 단어 경계 가드 — `2*3=6` 같은 수식/곱셈 표기가 기울임으로
  // 오탐되지 않게(한글·공백·문장부호 옆에서는 정상 발동). intra-word `*` 강조
  // ("un*believ*able")는 포기하는 트레이드오프.
  { re: /\*([^*\n]+)\*/g, key: 'i', mark: 1, word: true },
  { re: /_([^_\n]+)_/g, key: 'i', mark: 1, word: true },
];

const WORD_CH = /[A-Za-z0-9_]/;

/** `p`의 유효한(단어 내부 규칙을 통과한) 첫 매치를 찾는다. */
function findMdMatch(p: MdPattern, text: string): { start: number; innerLen: number } | null {
  p.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = p.re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (p.word) {
      const before = text[start - 1];
      const after = text[end];
      if ((before && WORD_CH.test(before)) || (after && WORD_CH.test(after))) continue;
    }
    return { start, innerLen: m[1]!.length };
  }
  return null;
}

/**
 * 마크다운 단축 문법을 서식으로 변환한다 — 노드 텍스트 **커밋 시** 한 번 적용
 * (에디터 `commitNodeRichText`). 지원: `**굵게**`/`__굵게__`, `*기울임*`/`_기울임_`,
 * `~~취소선~~`. 마커는 제거되고 안쪽 글자에 서식이 켜진다(기존 부분 서식 위에
 * 덧입혀진다 — 색상 등은 보존). 이스케이프(\*)와 줄 걸침 마커는 지원하지 않는다.
 *
 * @returns 바뀐 게 없으면 `null`(호출부는 원본 그대로 커밋), 있으면 새 `{text, rich}`.
 */
export function applyMarkdownShortcuts(src: RichSource): { text: string; rich: RichRun[] | null } | null {
  const chars = runsToChars(src);
  let changed = false;
  let guard = 0;
  // 한 라운드에 매치 하나씩 적용하고 처음부터 다시 — 마커 제거로 오프셋이
  // 움직이므로 항상 새 텍스트에서 다시 찾는 게 안전하다(패턴당 걸어봐야
  // 문서 길이에 비례하는 횟수라 충분히 싸다).
  outer: while (guard++ < 200) {
    const text = chars.map((x) => x.ch).join('');
    for (const p of MD_PATTERNS) {
      const hit = findMdMatch(p, text);
      if (!hit) continue;
      // 뒤쪽 마커부터 제거해 앞 인덱스를 보존한다.
      chars.splice(hit.start + p.mark + hit.innerLen, p.mark);
      chars.splice(hit.start, p.mark);
      for (let idx = hit.start; idx < hit.start + hit.innerLen; idx++) {
        const c = chars[idx]!;
        if (p.key === 'b') c.b = true;
        else if (p.key === 'i') c.i = true;
        else c.s = true;
      }
      changed = true;
      continue outer;
    }
    break;
  }
  if (!changed) return null;
  const runs = charsToRuns(chars).filter((r) => r.t);
  const styled = runs.some((r) => r.b || r.c || r.i || r.s);
  return { text: chars.map((x) => x.ch).join(''), rich: styled ? runs : null };
}

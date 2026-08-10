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
import { findAutoLinks, normalizeUrl } from './url';

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
  /** 하이퍼링크 — post-dc 추가(RichRun.href 참고). */
  href?: string | null;
  /** 인라인 멘션 이메일 — post-dc 추가(RichRun.m 참고). */
  m?: string | null;
}

/** Explodes `src.rich` (or, absent that, `src.text` as one unstyled run) into
 * one `RichChar` per character — port of `applyPartial`'s `chars` build
 * (MindFlow.dc.html:2709-2711). */
export function runsToChars(src: RichSource): RichChar[] {
  const runs: RichRun[] = src.rich && src.rich.length ? src.rich : [{ t: src.text, b: false, c: null }];
  const chars: RichChar[] = [];
  runs.forEach((r) => {
    const t = r.t || '';
    for (let i = 0; i < t.length; i++) chars.push({ ch: t[i]!, b: !!r.b, c: r.c || null, i: !!r.i, s: !!r.s, href: r.href || null, m: r.m || null });
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
    if (last && !!last.b === x.b && (last.c || null) === x.c && !!last.i === !!x.i && !!last.s === !!x.s && (last.href || null) === (x.href || null) && (last.m || null) === (x.m || null)) last.t += x.ch;
    else {
      // i/s/href는 값이 있을 때만 키를 만든다 — 원본(dc) 시절 문서와 같은 직렬화
      // 모양을 유지해 골든/CRDT 무회귀 (RichRun doc 참고).
      const r: RichRun = { t: x.ch, b: x.b, c: x.c };
      if (x.i) r.i = true;
      if (x.s) r.s = true;
      if (x.href) r.href = x.href;
      if (x.m) r.m = x.m;
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
export function applyPartialStyle(
  src: RichSource,
  s0In: number,
  s1In: number,
  kind: 'b' | 'i' | 's' | 'c' | 'link' | 'clear',
  val?: string | null,
): { text: string; rich: RichRun[] | null } {
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
    else if (kind === 'link') c.href = val || null;
    else {
      c.b = false;
      c.c = null;
      c.i = false;
      c.s = false;
      c.href = null;
      c.m = null;
    }
  }
  const nruns = charsToRuns(chars).filter((r) => r.t);
  return { text: chars.map((x) => x.ch).join(''), rich: isStyledRuns(nruns) ? nruns : null };
}

/** 이 런들이 **서식을 담고 있는가** — 아니면 평문이라 `rich`를 `null`로 접어도 된다.
 *
 * 서식 키가 늘 때마다 이 판정을 빠뜨리면 그 서식만 걸린 텍스트가 조용히 평문으로
 * 되돌아간다(링크만 걸린 런이 그랬다). 그래서 판정을 **여기 한 곳**에 둔다 —
 * 웹의 커밋 경로들도 이 함수를 쓴다. */
export function isStyledRuns(runs: RichRun[] | null | undefined): boolean {
  return !!runs && runs.some((r) => r.b || r.c || r.i || r.s || r.href || r.m);
}

/** Removes one style key from every run, dropping back to plain (`null`)
 * `rich` if nothing else is styled afterward — pure port of `Component#stripRich`
 * (MindFlow.dc.html:2727), used when a WHOLE-node style toggle (e.g. the
 * bold-everything button) should override any conflicting partial run. */
export function stripRichStyle(rich: RichRun[] | null | undefined, key: 'b' | 'c' | 'i' | 's' | 'href'): RichRun[] | null {
  if (!rich || !rich.length) return null;
  const next = rich.map((r) => {
    const o = { ...r };
    delete o[key];
    return o;
  });
  return isStyledRuns(next) ? next : null;
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

/**
 * 타이핑한 URL을 링크로 — **커밋 시점**에 한 번 돌린다(마크다운 단축 문법과 같은
 * 자리). 편집 중에 실시간으로 걸면 반쯤 친 주소가 링크가 됐다 풀렸다 하며
 * 캐럿·IME를 흔든다.
 *
 * 이미 링크가 걸린 글자는 건드리지 않는다 — 사용자가 손으로 지정한 주소가
 * 자동 인식에 덮이면 안 된다. 바뀐 게 없으면 `null`(호출부는 원본을 그대로 쓴다).
 */
export function applyAutoLinks(src: RichSource): { text: string; rich: RichRun[] | null } | null {
  const spans = findAutoLinks(src.text);
  if (!spans.length) return null;
  const chars = runsToChars(src);
  let touched = false;
  spans.forEach((sp) => {
    for (let i = sp.start; i < sp.end && i < chars.length; i++) {
      const c = chars[i]!;
      if (c.href || c.m) return; // 이미 링크·멘션이 걸린 구간은 통째로 건너뛴다
    }
    for (let i = sp.start; i < sp.end && i < chars.length; i++) {
      chars[i]!.href = sp.href;
      touched = true;
    }
  });
  if (!touched) return null;
  const runs = charsToRuns(chars).filter((r) => r.t);
  return { text: chars.map((x) => x.ch).join(''), rich: isStyledRuns(runs) ? runs : null };
}

/**
 * `[텍스트](주소)` → 링크가 걸린 텍스트. `richToMarkdown`(내보내기)의 **역방향**이라,
 * 내보낸 `.md`를 다시 가져오면 링크가 문법 그대로 남지 않고 되살아난다.
 *
 * `applyMarkdownShortcuts`(굵게/기울임/취소선)와 나란한 자리에 둔 이유가 그것이다 —
 * 둘을 합치지 않은 것은 주소에 `*`·`_`가 흔해서(쿼리 문자열) 마커 규칙과 섞이면
 * 서로를 갉아먹기 때문이다. 링크를 **먼저** 걷어내고 나머지 마커를 적용하면 안전하다.
 *
 * 주소는 `normalizeUrl`을 통과한 것만 링크가 된다(허용 스킴 밖이면 문법 그대로 둔다) —
 * 저장 시점에 거르는 기존 규칙과 같다.
 */
export function applyMarkdownLinks(src: RichSource): { text: string; rich: RichRun[] | null } | null {
  const chars = runsToChars(src);
  let changed = false;
  let from = 0;
  let guard = 0;
  while (guard++ < 500) {
    const text = chars.map((x) => x.ch).join('');
    const re = /\[([^\]\n]+)\]\(([^)\s]*)\)/g;
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) break;
    const label = m[1] ?? '';
    const href = normalizeUrl(m[2] ?? '');
    if (!href) {
      // 못 쓰는 주소(허용 스킴 밖)는 건드리지 않고 다음 후보로 — 여기서 멈추면
      // 뒤에 있는 멀쩡한 링크까지 놓친다.
      from = m.index + 1;
      continue;
    }
    const start = m.index;
    // 뒤(`](주소)`)부터 지운다 — 앞을 먼저 지우면 인덱스가 밀린다.
    chars.splice(start + 1 + label.length, 3 + (m[2] ?? '').length);
    chars.splice(start, 1);
    for (let i = start; i < start + label.length; i++) {
      const c = chars[i];
      if (c) c.href = href;
    }
    changed = true;
    from = start + label.length;
  }
  if (!changed) return null;
  const runs = charsToRuns(chars).filter((r) => r.t);
  return { text: chars.map((x) => x.ch).join(''), rich: isStyledRuns(runs) ? runs : null };
}

/** rich 런을 마크다운 인라인 문법으로 — `**굵게**`·`*기울임*`·`~~취소선~~`·`[텍스트](주소)`.
 * `applyMarkdownShortcuts`(입력 방향)의 역방향으로, 내보내기(`toMarkdown`)가 쓴다.
 *
 * - 색은 마크다운에 문법이 없어 평문으로 내린다.
 * - 마커는 공백을 감싸면 무효(`** 굵게 **`)라 런 가장자리 공백을 마커 **밖**으로 뺀다.
 * - rich가 없으면 텍스트 그대로 — 옛 문서·평문 무회귀. */
export function richToMarkdown(src: RichSource): string {
  if (!src.rich || !src.rich.length) return src.text || '';
  return src.rich
    .map((r) => {
      const styled = r.b || r.i || r.s || r.href;
      if (!styled) return r.t;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.t);
      const lead = m?.[1] ?? '';
      const core = m?.[2] ?? '';
      const tail = m?.[3] ?? '';
      if (!core) return r.t;
      let out = core;
      if (r.i) out = `*${out}*`;
      if (r.b) out = `**${out}**`;
      if (r.s) out = `~~${out}~~`;
      if (r.href) out = `[${out}](${r.href})`;
      return lead + out + tail;
    })
    .join('');
}

/**
 * 인라인 멘션 삽입(순수) — `[s0, s1)` 자리(입력 중이던 "@토큰")를 "@이름 "으로
 * 갈아 끼우고 "@이름" 글자에만 멘션(`m`=이메일)을 심는다. 뒤의 공백은 평문이라
 * 이어서 치는 글자가 멘션 안으로 자라지 않는다. 캐럿은 공백 바로 뒤.
 */
export function insertMention(src: RichSource, s0In: number, s1In: number, name: string, email: string): { text: string; rich: RichRun[] | null; caret: number } {
  let s0 = Math.min(s0In, s1In);
  let s1 = Math.max(s0In, s1In);
  const chars = runsToChars(src);
  s1 = Math.min(s1, chars.length);
  s0 = Math.min(s0, s1);
  const label = `@${name}`;
  const inserted: RichChar[] = [...label].map((ch) => ({ ch, b: false, c: null, m: email }));
  inserted.push({ ch: ' ', b: false, c: null });
  chars.splice(s0, s1 - s0, ...inserted);
  const nruns = charsToRuns(chars).filter((r) => r.t);
  return { text: chars.map((x) => x.ch).join(''), rich: isStyledRuns(nruns) ? nruns : null, caret: s0 + label.length + 1 };
}

/** 런에 담긴 멘션 이메일들(중복 제거) — 저장 훅과 알림 diff가 쓴다. */
export function mentionEmails(rich: RichRun[] | null | undefined): string[] {
  if (!rich) return [];
  return [...new Set(rich.map((r) => (r.m || '').trim().toLowerCase()).filter(Boolean))];
}

// 줄 단위 리스트(글머리 기호·번호 매기기·들여쓰기) 해석 — 순수 문자열 로직.
//
// 설계: 리스트는 **텍스트 마커가 곧 데이터**다. `- `/`* `/`• `(글머리),
// `1. `/`1) `(번호)로 시작하는 줄을 렌더러가 리스트로 그린다(글머리는 단계 글리프로
// 치환, 번호는 입력 그대로). 들여쓰기도 같은 원칙 — 마커 **앞의 공백**이
// 곧 단계다(`LIST_INDENT_UNIT` 배수). 모델·직렬화·CRDT에는 아무것도 추가하지
// 않는다 — 텍스트가 원본이므로 저장/협업/undo/마크다운 내보내기(들여쓴 `- `가
// 그대로 중첩 목록이 된다)가 전부 공짜로 따라오고, 옛 문서와의 호환 문제도 없다.
//
// 단계별 마커도 같은 원칙을 따른다 — 들여쓰기/내어쓰기는 **텍스트의 마커 자체를**
// 그 단계 표기로 갈아 끼운다(`•`→`◦`→`▪`, `1.`→`a.`→`i.`, 네 번째는 첫 번째로).
// 별도 스타일 필드가 없으므로 저장본만 봐도 무엇이 보일지 알 수 있다.
//
// ⚠️ 파리티 계약: 이 해석(마커 판정·표시 문자열)은 **여기 한 곳**에만 있다.
// 소비처(에디터 렌더 `NodeLayer`/`FloatLayer`, 박스 측정 `metrics.ts`, 홈 썸네일
// `mapPreview.tsx`, PNG 내보내기 `png.ts`)는 반드시 이 모듈을 통해 같은 규칙으로
// 줄을 해석해야 한다 — 한 곳이라도 자체 규칙을 가지면 "측정은 리스트로,
// 렌더는 평문으로" 식의 드리프트가 생겨 텍스트가 도형을 벗어난다.

/** 들여쓰기 한 단계 = 공백 2칸(마크다운 중첩 목록 관례). */
export const LIST_INDENT_UNIT = '  ';
/** 들여쓰기 최대 단계 — 이보다 깊어지면 내용 폭이 남지 않는다. */
export const MAX_LIST_INDENT = 6;

// ── 단계별 마커 스타일 ────────────────────────────────────────────────────
// 요청: 들여쓰기 단계마다 마커가 바뀌고 **네 번째 단계는 첫 번째로 돌아간다**
// (워드프로세서 관례). 그래서 3단계 주기로 순환한다.

/** 글머리 글리프 — 채운 원 → 빈 원 → 채운 사각형, 이후 반복. */
const UL_GLYPHS = ['•', '◦', '▪'] as const;
/** 번호 표기 — 1,2,3 → a,b,c → i,ii,iii, 이후 반복. */
export type OrdinalStyle = 'decimal' | 'alpha' | 'roman';
const OL_STYLES: readonly OrdinalStyle[] = ['decimal', 'alpha', 'roman'];

/** 그 단계의 글머리 글리프(항상 **한 글자** — `raw`/`display` 길이 계약 유지). */
export function bulletGlyphFor(indent: number): string {
  return UL_GLYPHS[((indent % UL_GLYPHS.length) + UL_GLYPHS.length) % UL_GLYPHS.length] as string;
}

/** 그 단계의 번호 표기 방식. */
export function ordinalStyleFor(indent: number): OrdinalStyle {
  return OL_STYLES[((indent % OL_STYLES.length) + OL_STYLES.length) % OL_STYLES.length] as OrdinalStyle;
}

const ROMAN_UNITS: readonly [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];
/** 잘 만들어진 로마 숫자만 — 알파벳 표기와 겹치는 토큰을 걸러 낸다. */
const ROMAN_RE = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

function toRoman(n: number): string {
  let rest = Math.max(1, Math.min(3999, n));
  let out = '';
  for (const [v, s] of ROMAN_UNITS) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

function fromRoman(s: string): number {
  const val: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let out = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = val[s[i] as string] ?? 0;
    const nxt = val[s[i + 1] as string] ?? 0;
    out += cur < nxt ? -cur : cur;
  }
  return out || 1;
}

/** a, b, … z, aa, ab … (스프레드시트 열과 같은 bijective base-26). */
function toAlpha(n: number): string {
  let rest = Math.max(1, n);
  let out = '';
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function fromAlpha(s: string): number {
  let out = 0;
  for (const ch of s) out = out * 26 + (ch.charCodeAt(0) - 96);
  return out || 1;
}

/** 순번 값 → 그 단계의 표기. */
export function formatOrdinal(n: number, style: OrdinalStyle): string {
  if (style === 'alpha') return toAlpha(n);
  if (style === 'roman') return toRoman(n);
  return String(Math.max(1, n));
}

/** 표기 → 순번 값. 단계 스타일과 다른 표기(옛 문서의 숫자 등)도 최대한 읽는다. */
export function parseOrdinal(token: string, style: OrdinalStyle): number {
  if (/^\d+$/.test(token)) return Math.max(1, parseInt(token, 10));
  if (style === 'roman' && ROMAN_RE.test(token)) return fromRoman(token);
  if (/^[a-z]+$/.test(token)) return fromAlpha(token);
  return 1;
}

/** 한 줄의 리스트 마커 해석 결과. */
export interface ListPrefix {
  kind: 'ul' | 'ol';
  /** 텍스트에 실제로 들어 있는 접두 — **들여쓰기 공백 + 마커 + 공백 1칸**.
   * 예: `- `, `3. `, `  a. `(1단계 들여쓰기). */
  raw: string;
  /** 렌더러가 그리는 접두 — 글머리 마커만 그 단계 글리프(`•`/`◦`/`▪`)로 치환
   * (들여쓰기 공백·번호는 그대로). `raw`와 **글자 수가 같아**(글리프 1자 치환)
   * rich 런 오프셋이 흔들리지 않는다. */
  display: string;
  /** 들여쓰기 단계(0 = 최상위). */
  indent: number;
  /** 마커 앞 실제 공백 문자열 — `raw`/`display` 양쪽에 이미 포함돼 있다. */
  pad: string;
}

/** 표시용 들여쓰기 문자 — EN SPACE(0.5em). 일반 공백은 좁아서 단계가 거의
 * 드러나지 않았다(제보: "들여쓰기 간격이 너무 좁다"). `display`에서만 공백 하나를
 * 이 문자 **하나로** 갈아 끼우므로 `raw`와 글자 수가 같아 rich 런 오프셋 계약이
 * 그대로고, 소비처(에디터 렌더·박스 측정·홈 썸네일·PNG)는 전부 `display`를 재기
 * 때문에 폭이 자동으로 함께 넓어진다. 저장 단위(`LIST_INDENT_UNIT`)는 일반 공백
 * 2칸 그대로여서 이미 저장된 문서의 단계도 흔들리지 않는다. */
const DISPLAY_INDENT = '\u2002';

/** 들여쓰기로 인정하는 공백류 — 저장본의 일반 공백/탭과, 편집 화면을 그대로
 * 커밋했을 때 들어오는 표시용 EN SPACE. */
const PAD_CHARS = ' \t\u2002';
const PAD_RE = new RegExp(`^[${PAD_CHARS}]*`);

// 글머리: (들여쓰기) -, *, 그리고 단계 글리프(•, ◦, ▪) 뒤 공백 하나.
// 번호: (들여쓰기) 숫자 1~3자리 **또는 소문자 표기**(a…, i…) + '.'/')' + 공백.
const UL_RE = new RegExp(`^([${PAD_CHARS}]*)([-*•◦▪]) `);
const OL_RE = new RegExp(`^([${PAD_CHARS}]*)(\\d{1,3}|[a-z]{1,7})([.)]) `);

/** 들여쓰기 공백 → 단계. 탭 하나는 한 단계로 센다. */
function indentLevelOf(pad: string): number {
  let cols = 0;
  for (const ch of pad) cols += ch === '\t' ? LIST_INDENT_UNIT.length : 1;
  return Math.min(MAX_LIST_INDENT, Math.floor(cols / LIST_INDENT_UNIT.length));
}

/** 표시용 들여쓰기 — 공백 하나를 EN SPACE 하나로(길이 보존, 탭은 그대로 둔다). */
function displayPad(pad: string): string {
  return pad.replace(/ /g, DISPLAY_INDENT);
}

/** 그 단계에서 번호 표기로 인정할 토큰인가.
 *
 * 숫자는 **어느 단계에서나** 번호 목록이다(옛 문서·마크다운 호환). 문자 표기는
 * 그 단계의 스타일일 때만 인정한다 — 그래야 최상위의 `a. 그리고…` 같은 평범한
 * 문장이 갑자기 목록이 되지 않는다(단계가 곧 문맥이다). */
function isOrdinalToken(token: string, indent: number): boolean {
  if (/^\d{1,3}$/.test(token)) return true;
  const style = ordinalStyleFor(indent);
  if (style === 'alpha') return /^[a-z]{1,3}$/.test(token);
  if (style === 'roman') return token.length > 0 && ROMAN_RE.test(token);
  return false;
}

/** `raw`에서 번호 토큰만 떼어 낸다(`  12. ` → `12`). */
function ordinalTokenOf(p: ListPrefix): string {
  return p.raw.slice(p.pad.length, p.raw.length - 2);
}

/** `raw`가 쓰는 구분자(`.` 또는 `)`). */
function ordinalSepOf(p: ListPrefix): string {
  return p.raw[p.raw.length - 2] === ')' ? ')' : '.';
}

/** 줄 시작의 리스트 마커를 해석한다 — 마커가 없으면 `null`. */
export function parseListPrefix(line: string): ListPrefix | null {
  const ul = UL_RE.exec(line);
  if (ul) {
    const pad = ul[1] ?? '';
    const indent = indentLevelOf(pad);
    return { kind: 'ul', raw: ul[0], display: `${displayPad(pad)}${bulletGlyphFor(indent)} `, indent, pad };
  }
  const ol = OL_RE.exec(line);
  if (ol) {
    const pad = ol[1] ?? '';
    const indent = indentLevelOf(pad);
    if (isOrdinalToken(ol[2] ?? '', indent)) {
      return { kind: 'ol', raw: ol[0], display: displayPad(pad) + ol[0].slice(pad.length), indent, pad };
    }
  }
  return null;
}

/** 한 줄의 **표시** 문자열 — 글머리 마커만 `• `로 치환, 나머지는 그대로.
 *  (접힌 메모의 첫 줄, PNG의 평문 라인 등 단순 소비처용.) */
export function listDisplayLine(line: string): string {
  const p = parseListPrefix(line);
  return p ? p.display + line.slice(p.raw.length) : line;
}

/**
 * Enter 자동 이어쓰기: 리스트 줄에서 줄바꿈할 때 다음 줄에 넣을 마커를 정한다.
 * - 리스트 줄이 아니면 `null` (호출부는 기본 줄바꿈).
 * - 내용이 있는 리스트 줄이면 `{ next }` — 글머리는 같은 마커(들여쓰기 유지),
 *   번호는 +1.
 * - **마커만 있고 내용이 빈** 줄이면 `{ end: true, replaceWith }` — 호출부가 그
 *   줄의 `raw`를 `replaceWith`로 갈아 끼운다. 들여쓴 줄이면 한 단계 **내어쓰기**,
 *   최상위면 빈 문자열(=마커 제거로 리스트 종료). 표준 에디터 관례.
 */
export function continueListMarker(line: string): { next: string } | { end: true; replaceWith: string } | null {
  const p = parseListPrefix(line);
  if (!p) return null;
  if (!line.slice(p.raw.length).trim()) {
    if (p.indent > 0) {
      // 한 단계 내어쓰면 마커도 그 단계의 표기로 바뀐다. 번호는 **값을 유지**한다
      // — 비어 있던 `b.`를 내어쓰면 부모 목록의 2번을 이어받는 게 자연스럽다.
      const level = p.indent - 1;
      const marker =
        p.kind === 'ul'
          ? `${bulletGlyphFor(level)} `
          : `${formatOrdinal(parseOrdinal(ordinalTokenOf(p), ordinalStyleFor(p.indent)), ordinalStyleFor(level))}${ordinalSepOf(p)} `;
      return { end: true, replaceWith: LIST_INDENT_UNIT.repeat(level) + marker };
    }
    return { end: true, replaceWith: '' };
  }
  if (p.kind === 'ul') return { next: p.display };
  const style = ordinalStyleFor(p.indent);
  const num = parseOrdinal(ordinalTokenOf(p), style);
  return { next: `${p.pad}${formatOrdinal(num + 1, style)}${ordinalSepOf(p)} ` };
}

// ── 줄 접두 편집(들여쓰기·내어쓰기·목록 토글) ─────────────────────────────

/** 텍스트의 한 구간을 갈아 끼우는 편집 — 이 모듈의 연산은 **줄 접두만** 바꾸므로
 * 호출부는 이 편집들을 char-model(rich 런)에 그대로 splice 하면 서식이 보존된다. */
export interface TextEdit {
  at: number;
  remove: number;
  insert: string;
}

/** 리스트 연산 종류 — 들여쓰기/내어쓰기, 글머리/번호 토글. */
export type ListOp = { type: 'indent'; dir: 1 | -1 } | { type: 'toggle'; kind: 'ul' | 'ol' };

interface LineInfo {
  start: number;
  text: string;
  prefix: ListPrefix | null;
  /** 이 연산이 만들어 낸 새 접두(`prefix?.raw`를 대체). */
  next: string;
  /** 이 줄이 연산 대상인가(선택 범위와 겹치는가). */
  target: boolean;
}

function splitLines(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      out.push({ start, text: text.slice(start) });
      return out;
    }
    out.push({ start, text: text.slice(start, nl) });
    start = nl + 1;
  }
}

/** 번호 목록 다시 매기기 — 같은 들여쓰기 단계의 연속 항목에 1씩 증가한 번호를
 * 준다. **각 묶음의 시작 번호는 보존**한다(사용자가 `5.`부터 시작했다면 5,6,7…).
 * 리스트가 아닌 줄을 만나면 묶음이 끊긴다. */
function renumber(lines: LineInfo[]): void {
  const counters: (number | undefined)[] = [];
  lines.forEach((ln) => {
    const p = parseListPrefix(ln.next + ln.text.slice(ln.prefix ? ln.prefix.raw.length : 0));
    if (!p) {
      counters.length = 0;
      return;
    }
    for (let i = p.indent + 1; i < counters.length; i++) counters[i] = undefined;
    if (p.kind !== 'ol') {
      counters[p.indent] = undefined;
      return;
    }
    const style = ordinalStyleFor(p.indent);
    const own = parseOrdinal(ordinalTokenOf(p), style);
    const prev = counters[p.indent];
    const num = prev === undefined ? own : prev + 1;
    counters[p.indent] = num;
    ln.next = `${p.pad}${formatOrdinal(num, style)}${ordinalSepOf(p)} `;
  });
}

/**
 * 선택 범위 `[s0, s1]`가 걸친 줄들에 리스트 연산을 적용하고, 필요한 **줄 접두
 * 편집 목록**을 돌려준다(변경이 없으면 빈 배열). 텍스트 전체를 다시 만들지 않고
 * 편집만 돌려주는 이유: 호출부가 rich 런(char-model)에 같은 자리만 splice 해서
 * 부분 서식을 그대로 보존하기 위해서다.
 *
 * - `indent`: 리스트 줄의 들여쓰기 단계를 ±1 (0…`MAX_LIST_INDENT`로 clamp).
 *   리스트가 아닌 줄은 건드리지 않는다.
 * - `toggle`: 대상 줄이 **모두** 그 종류면 마커 제거(들여쓰기는 유지), 아니면
 *   그 종류로 통일. 번호는 이후 `renumber`가 정리한다.
 */
export function applyListOp(text: string, s0: number, s1: number, op: ListOp): TextEdit[] {
  const a = Math.min(s0, s1);
  const b = Math.max(s0, s1);
  const lines: LineInfo[] = splitLines(text).map((l) => {
    const prefix = parseListPrefix(l.text);
    const end = l.start + l.text.length;
    // 캐럿이 줄 끝에 있어도(길이 0 선택) 그 줄은 대상이다.
    const target = l.start <= b && end >= a;
    return { start: l.start, text: l.text, prefix, next: prefix ? prefix.raw : '', target };
  });

  if (op.type === 'indent') {
    lines.forEach((ln) => {
      if (!ln.target || !ln.prefix) return;
      const level = Math.max(0, Math.min(MAX_LIST_INDENT, ln.prefix.indent + op.dir));
      if (level === ln.prefix.indent) return;
      // 단계가 바뀌면 마커도 그 단계 표기로 바뀐다. 번호는 **1부터** 시작해 두고
      // 아래 `renumber`가 앞 형제를 보고 이어 준다 — 값을 그대로 옮기면 `a.`도
      // 없는데 `b.`로 시작하는 하위 목록이 생긴다.
      const marker =
        ln.prefix.kind === 'ul'
          ? `${bulletGlyphFor(level)} `
          : `${formatOrdinal(1, ordinalStyleFor(level))}${ordinalSepOf(ln.prefix)} `;
      ln.next = LIST_INDENT_UNIT.repeat(level) + marker;
    });
  } else {
    const targets = lines.filter((ln) => ln.target);
    const allSame = targets.length > 0 && targets.every((ln) => ln.prefix?.kind === op.kind);
    targets.forEach((ln) => {
      const pad = ln.prefix ? ln.prefix.pad : (PAD_RE.exec(ln.text)?.[0] ?? '');
      if (allSame) {
        ln.next = pad; // 마커만 벗기고 들여쓰기는 남긴다
        return;
      }
      const level = indentLevelOf(pad);
      ln.next = pad + (op.kind === 'ul' ? `${bulletGlyphFor(level)} ` : `${formatOrdinal(1, ordinalStyleFor(level))}. `);
    });
  }

  renumber(lines);
  return prefixEdits(lines);
}

/** 줄별 `next` 접두와 원래 접두의 차이를 편집 목록으로. */
function prefixEdits(lines: LineInfo[]): TextEdit[] {
  const edits: TextEdit[] = [];
  lines.forEach((ln) => {
    const oldPrefix = ln.prefix ? ln.prefix.raw : '';
    // 마커가 없던 줄에 접두를 넣을 땐 원래 있던 들여쓰기 공백까지 대체한다.
    const removeLen = ln.prefix ? oldPrefix.length : (PAD_RE.exec(ln.text)?.[0].length ?? 0);
    const removed = ln.text.slice(0, removeLen);
    if (removed === ln.next) return;
    edits.push({ at: ln.start, remove: removeLen, insert: ln.next });
  });
  return edits;
}

/** 텍스트 전체의 번호를 다시 매기는 편집 목록(다른 건 건드리지 않는다). */
function renumberEdits(text: string): TextEdit[] {
  const lines: LineInfo[] = splitLines(text).map((l) => {
    const prefix = parseListPrefix(l.text);
    return { start: l.start, text: l.text, prefix, next: prefix ? prefix.raw : '', target: false };
  });
  renumber(lines);
  return prefixEdits(lines);
}

/** 마커 안 Backspace의 결과 — 마커만 바꾸는 연산이거나, 빈 항목을 통째로 지우는 편집. */
export type ListBackspace = { kind: 'op'; op: ListOp } | { kind: 'edit'; edits: TextEdit[] };

/** 캐럿이 리스트 **마커 안**(들여쓰기 공백 포함, 마커 바로 뒤까지)에 있을 때
 * Backspace가 해야 할 일 — 아니면 `null`(브라우저 기본 삭제).
 *
 * 마커는 텍스트지만 **한 덩어리**로 다뤄야 한다. 한 글자씩 지우게 두면 `2. `가
 * `2.`가 되면서 그 줄이 리스트에서 빠지고, 남은 `2.`가 평문 정렬을 따라 옆으로
 * 튄다(제보: "Backspace를 눌렀는데 Tab이 걸린 것처럼 보인다").
 *
 * 규칙(표준 에디터 관례 + 제보 반영):
 * - 들여쓴 줄 → 한 단계 **내어쓰기**
 * - 내용이 있는 최상위 줄 → **마커만 제거**(텍스트는 남는다)
 * - **내용이 빈** 최상위 줄이고 앞에 줄이 있으면 → 그 **항목을 통째로 삭제**
 *   (마커 + 앞의 줄바꿈). 마커만 지우면 빈 줄이 남아 캐럿이 도형 하단 가운데로
 *   떨어져 보인다(제보) — 빈 항목을 지우려는 의도이므로 줄까지 없앤다.
 * - 줄 맨 앞(마커 앞) → `null`. 그건 앞 줄과 합치는 평범한 삭제다. */
export function listBackspaceOp(text: string, caret: number): ListBackspace | null {
  if (caret <= 0) return null;
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const nl = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, nl === -1 ? undefined : nl);
  const p = parseListPrefix(line);
  if (!p) return null;
  if (caret <= lineStart || caret > lineStart + p.raw.length) return null;
  if (p.indent > 0) return { kind: 'op', op: { type: 'indent', dir: -1 } };
  if (!line.slice(p.raw.length).trim() && lineStart > 0) {
    // 앞의 줄바꿈까지 지워 항목을 통째로 없앤다. 남은 목록의 번호는 다시 매긴다
    // (가운데 항목을 지우면 1., 3.으로 벌어지므로) — 삭제 후 텍스트에서 계산한
    // 편집을 원래 인덱스로 되돌려 함께 돌려준다(서로 겹치지 않는다).
    const del: TextEdit = { at: lineStart - 1, remove: p.raw.length + 1, insert: '' };
    const after = text.slice(0, del.at) + text.slice(del.at + del.remove);
    const renum = renumberEdits(after).map((e) => (e.at >= del.at ? { ...e, at: e.at + del.remove } : e));
    return { kind: 'edit', edits: [del, ...renum] };
  }
  return { kind: 'op', op: { type: 'toggle', kind: p.kind } };
}

/** 편집 적용 후 커서/선택 오프셋이 어디로 갔는지 — 접두가 늘거나 줄어든 만큼
 * 뒤 오프셋을 민다. 접두 **안쪽**을 가리키던 오프셋은 새 접두 끝으로 모은다. */
export function shiftOffset(pos: number, edits: TextEdit[]): number {
  let out = pos;
  edits.forEach((e) => {
    const delta = e.insert.length - e.remove;
    if (pos >= e.at + e.remove) out += delta;
    else if (pos > e.at) out += Math.max(0, e.at + e.insert.length - pos);
  });
  return Math.max(0, out);
}

// 줄 단위 리스트(글머리 기호·번호 매기기·들여쓰기) 해석 — 순수 문자열 로직.
//
// 설계: 리스트는 **텍스트 마커가 곧 데이터**다. `- `/`* `/`• `(글머리),
// `1. `/`1) `(번호)로 시작하는 줄을 렌더러가 리스트로 그린다(글머리는 `• `
// 글리프로 치환, 번호는 입력 그대로). 들여쓰기도 같은 원칙 — 마커 **앞의 공백**이
// 곧 단계다(`LIST_INDENT_UNIT` 배수). 모델·직렬화·CRDT에는 아무것도 추가하지
// 않는다 — 텍스트가 원본이므로 저장/협업/undo/마크다운 내보내기(들여쓴 `- `가
// 그대로 중첩 목록이 된다)가 전부 공짜로 따라오고, 옛 문서와의 호환 문제도 없다.
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

/** 한 줄의 리스트 마커 해석 결과. */
export interface ListPrefix {
  kind: 'ul' | 'ol';
  /** 텍스트에 실제로 들어 있는 접두 — **들여쓰기 공백 + 마커 + 공백 1칸**.
   * 예: `- `, `3. `, `  - `(1단계 들여쓰기). */
  raw: string;
  /** 렌더러가 그리는 접두 — 글머리 마커만 `• `로 치환(들여쓰기 공백은 그대로).
   * `raw`와 **글자 수가 같아**(글리프 1자 치환) rich 런 오프셋이 흔들리지 않는다. */
  display: string;
  /** 들여쓰기 단계(0 = 최상위). */
  indent: number;
  /** 마커 앞 실제 공백 문자열 — `raw`/`display` 양쪽에 이미 포함돼 있다. */
  pad: string;
}

// 글머리: (들여쓰기) -, *, • 뒤 공백 하나. 번호: (들여쓰기) 1~3자리 + '.'/')' + 공백.
const UL_RE = /^([ \t]*)([-*•]) /;
const OL_RE = /^([ \t]*)(\d{1,3})([.)]) /;

/** 들여쓰기 공백 → 단계. 탭 하나는 한 단계로 센다. */
function indentLevelOf(pad: string): number {
  let cols = 0;
  for (const ch of pad) cols += ch === '\t' ? LIST_INDENT_UNIT.length : 1;
  return Math.min(MAX_LIST_INDENT, Math.floor(cols / LIST_INDENT_UNIT.length));
}

/** 줄 시작의 리스트 마커를 해석한다 — 마커가 없으면 `null`. */
export function parseListPrefix(line: string): ListPrefix | null {
  const ul = UL_RE.exec(line);
  if (ul) {
    const pad = ul[1] ?? '';
    return { kind: 'ul', raw: ul[0], display: `${pad}• `, indent: indentLevelOf(pad), pad };
  }
  const ol = OL_RE.exec(line);
  if (ol) {
    const pad = ol[1] ?? '';
    return { kind: 'ol', raw: ol[0], display: ol[0], indent: indentLevelOf(pad), pad };
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
      const marker = p.raw.slice(p.pad.length);
      return { end: true, replaceWith: LIST_INDENT_UNIT.repeat(p.indent - 1) + marker };
    }
    return { end: true, replaceWith: '' };
  }
  if (p.kind === 'ul') return { next: p.raw };
  const num = parseInt(p.raw.trimStart(), 10);
  const sep = p.raw.includes(')') ? ')' : '.';
  return { next: `${p.pad}${num + 1}${sep} ` };
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
    const own = parseInt(p.raw.trimStart(), 10);
    const prev = counters[p.indent];
    const num = prev === undefined ? own : prev + 1;
    counters[p.indent] = num;
    const sep = p.raw.includes(')') ? ')' : '.';
    ln.next = `${p.pad}${num}${sep} `;
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
      ln.next = LIST_INDENT_UNIT.repeat(level) + ln.prefix.raw.slice(ln.prefix.pad.length);
    });
  } else {
    const targets = lines.filter((ln) => ln.target);
    const allSame = targets.length > 0 && targets.every((ln) => ln.prefix?.kind === op.kind);
    targets.forEach((ln) => {
      const pad = ln.prefix ? ln.prefix.pad : (/^[ \t]*/.exec(ln.text)?.[0] ?? '');
      if (allSame) {
        ln.next = pad; // 마커만 벗기고 들여쓰기는 남긴다
        return;
      }
      ln.next = pad + (op.kind === 'ul' ? '• ' : '1. ');
    });
  }

  renumber(lines);

  const edits: TextEdit[] = [];
  lines.forEach((ln) => {
    const oldPrefix = ln.prefix ? ln.prefix.raw : '';
    // 마커가 없던 줄에 접두를 넣을 땐 원래 있던 들여쓰기 공백까지 대체한다.
    const removeLen = ln.prefix ? oldPrefix.length : (/^[ \t]*/.exec(ln.text)?.[0].length ?? 0);
    const removed = ln.text.slice(0, removeLen);
    if (removed === ln.next) return;
    edits.push({ at: ln.start, remove: removeLen, insert: ln.next });
  });
  return edits;
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

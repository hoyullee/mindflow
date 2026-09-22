// 코드 블록 — **어두운 판과 문법 색칠**(요청 7·9).
//
// ## 색을 클래스로만 준다
//
// 편집 박스는 비제어라, 사용자가 친 글은 DOM이 진실이고 커밋은 `domToRuns`가 그
// DOM을 읽어 만든다. 그런데 그 함수는 **인라인 `style.color`를 런의 `c`로 읽는다** —
// 색을 인라인으로 심으면 문법 색칠이 그대로 **문서 값**이 되어 저장되고, 코드를
// 고칠 때마다 옛 색이 들러붙는다. 그래서 여기서 그리는 조각은 **클래스만** 갖는다
// (링크·멘션이 같은 이유로 클래스를 쓴다 — `richtextDom`의 그 머리말).
//
// ## 언어를 묻지 않는다
//
// 노션은 언어를 고르게 하고 그 문법으로 칠한다. 우리는 고르는 자리가 아직 없으므로
// **여러 언어에 공통인 것들**만 본다: 주석 · 문자열 · 수 · 예약어 · 부르는 이름.
// 틀리게 칠할 수 있는 자리가 있지만(예: 파이썬의 `#`과 CSS의 `#fff`) 그 대가는
// "한 조각의 색이 어긋난다"뿐이고, 언어를 고르게 하는 UI가 생기면 그때 좁힌다.

/** 코드 판의 면 — 따뜻한 먹색(시안). */
export const CODE_BG = '#2B2621';
/** 코드 판의 글 — 옅은 종이색(시안). */
export const CODE_INK = '#EAE1D4';

/** 여러 언어에 공통인 예약어들 — 한 벌로 본다(위 머리말). */
const KEYWORDS = new Set([
  'abstract','and','as','assert','async','await','base','bool','break','by','byte','case','catch','char','class','const','constexpr','continue','crate','data','def','default','defer','del','delete','do','double','dyn','elif','else','end','enum','event','except','export','extends','extern','fals','final','finally','float','fn','for','from','func','function','global','go','goto','if','impl','implements','import','in','include','instanceof','int','interface','internal','is','lambda','let','local','long','loop','match','mod','module','move','mut','namespace','new','nil','nonlocal','not','null','object','operator','or','override','package','pass','private','protected','pub','public','raise','readonly','ref','require','return','select','self','short','signed','sizeof','static','struct','super','switch','synchronized','template','then','this','throw','throws','trait','transient','try','type','typedef','typeof','union','unsafe','unsigned','until','use','using','val','var','virtual','void','volatile','when','where','while','with','yield',
]);

/** 값처럼 읽히는 낱말 — 예약어와 색을 달리한다. */
const LITERALS = new Set(['true', 'false', 'null', 'nil', 'none', 'None', 'True', 'False', 'undefined', 'NaN', 'Infinity']);

/** 조각의 갈래 — 색은 `editor.css`의 `.mf-code-*`가 준다. */
type Tok = 'cm' | 'st' | 'nu' | 'kw' | 'li' | 'fn' | 'op';

interface Piece {
  t: string;
  k: Tok | null;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function esc(t: string): string {
  return t.replace(/[&<>]/g, (c) => ESC[c] ?? c);
}

/**
 * 코드 한 덩어리를 조각으로 — 줄바꿈은 조각 안에 그대로 남는다(호출부가 `<br>`로 그린다).
 *
 * 한 번 훑으면서 자른다: 주석·문자열처럼 **안쪽을 해석하면 안 되는 것**을 먼저 삼키고,
 * 남은 자리에서 수·낱말을 본다. 정규식 하나로 갈래를 나누면 문자열 안의 `//`가 주석이
 * 되는 고전적인 함정에 빠진다.
 */
export function codePieces(src: string): Piece[] {
  const out: Piece[] = [];
  const push = (t: string, k: Tok | null): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.t += t;
    else out.push({ t, k });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const two = src.slice(i, i + 2);
    // 줄 주석 — `//` · `#` · `--`. 줄 끝까지.
    if (two === '//' || two === '--' || ch === '#') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      push(src.slice(i, end), 'cm');
      i = end;
      continue;
    }
    // 여러 줄 주석 — 닫히지 않았으면 끝까지(고치는 중에는 흔한 상태다).
    if (two === '/*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      push(src.slice(i, end), 'cm');
      i = end;
      continue;
    }
    // 문자열 — 따옴표 셋. 이스케이프는 건너뛰고, **줄을 넘지 않는다**(백틱만 예외).
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        const c = src[j]!;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) {
          j += 1;
          break;
        }
        if (c === '\n' && ch !== '`') break;
        j += 1;
      }
      push(src.slice(i, j), 'st');
      i = j;
      continue;
    }
    // 수 — 16진수·소수·지수까지.
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_$]/.test(src[i - 1] ?? '')) {
      const m = /^(0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?)/.exec(src.slice(i));
      if (m) {
        push(m[0], 'nu');
        i += m[0].length;
        continue;
      }
    }
    // 낱말 — 예약어 · 값 · 부르는 이름(뒤가 `(`).
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i))!;
      const word = m[0];
      const after = src.slice(i + word.length);
      const kind: Tok | null = LITERALS.has(word) ? 'li' : KEYWORDS.has(word) ? 'kw' : /^\s*\(/.test(after) ? 'fn' : null;
      push(word, kind);
      i += word.length;
      continue;
    }
    // 기호 — 괄호·연산자. 공백과 글자는 색이 없다.
    push(ch, /[{}[\]()<>=+\-*/%!&|^~?:;,.]/.test(ch) ? 'op' : null);
    i += 1;
  }
  return out;
}

/**
 * 코드 블록의 편집 박스에 심을 HTML — 조각마다 클래스 스팬, 줄바꿈은 `<br>`.
 *
 * 끝이 줄바꿈이면 보초 `<br>`을 하나 더 붙인다 — 블록 끝의 `<br>` 하나는 빈 줄을
 * 그리지 않아, 방금 Enter로 만든 줄에 캐럿이 보이지 않는다(`softBreak`과 같은 처방).
 */
export function codeHtml(text: string): string {
  const body = codePieces(text)
    .map((p) => {
      const html = esc(p.t).replace(/\n/g, '<br>');
      return p.k ? `<span class="mf-code-${p.k}">${html}</span>` : html;
    })
    .join('');
  return body + (text.endsWith('\n') ? '<br>' : '');
}

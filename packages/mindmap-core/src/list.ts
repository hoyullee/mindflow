// 줄 단위 리스트(글머리 기호·번호 매기기) 해석 — 순수 문자열 로직.
//
// 설계: 리스트는 **텍스트 마커가 곧 데이터**다. `- `/`* `/`• `(글머리),
// `1. `/`1) `(번호)로 시작하는 줄을 렌더러가 리스트로 그린다(글머리는 `• `
// 글리프로 치환, 번호는 입력 그대로). 모델·직렬화·CRDT에는 아무것도 추가하지
// 않는다 — 텍스트가 원본이므로 저장/협업/undo/마크다운 내보내기(`- ` 그대로)가
// 전부 공짜로 따라오고, 옛 문서와의 호환 문제가 없다.
//
// ⚠️ 파리티 계약: 이 해석(마커 판정·표시 문자열)은 **여기 한 곳**에만 있다.
// 소비처(에디터 렌더 `NodeLayer`/`FloatLayer`, 박스 측정 `metrics.ts`, 홈 썸네일
// `mapPreview.tsx`, PNG 내보내기 `png.ts`)는 반드시 이 모듈을 통해 같은 규칙으로
// 줄을 해석해야 한다 — 한 곳이라도 자체 규칙을 가지면 "측정은 리스트로,
// 렌더는 평문으로" 식의 드리프트가 생겨 텍스트가 도형을 벗어난다.

/** 한 줄의 리스트 마커 해석 결과. */
export interface ListPrefix {
  kind: 'ul' | 'ol';
  /** 텍스트에 실제로 들어 있는 마커 부분(내용 앞 공백 1개 포함) — 예: `- `, `3. ` */
  raw: string;
  /** 렌더러가 그리는 마커 — 글머리는 `• `로 치환, 번호는 입력 그대로.
   *  `raw`와 글자 수가 같아(글리프 1자 치환) rich 런 오프셋이 흔들리지 않는다. */
  display: string;
}

// 글머리: -, *, • 뒤 공백 하나. 번호: 1~3자리 숫자 + '.' 또는 ')' + 공백 하나.
const UL_RE = /^([-*•])( )/;
const OL_RE = /^(\d{1,3})([.)])( )/;

/** 줄 시작의 리스트 마커를 해석한다 — 마커가 없으면 `null`. */
export function parseListPrefix(line: string): ListPrefix | null {
  const ul = UL_RE.exec(line);
  if (ul) return { kind: 'ul', raw: ul[0], display: '• ' };
  const ol = OL_RE.exec(line);
  if (ol) return { kind: 'ol', raw: ol[0], display: ol[0] };
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
 * - 내용이 있는 리스트 줄이면 `{ next }` — 글머리는 같은 마커, 번호는 +1.
 * - **마커만 있고 내용이 빈** 줄이면 `{ end: true }` — 표준 에디터 관례대로
 *   호출부가 그 마커를 지우고 리스트를 끝낸다(빈 불릿이 무한히 이어지지 않게).
 */
export function continueListMarker(line: string): { next: string } | { end: true } | null {
  const p = parseListPrefix(line);
  if (!p) return null;
  if (!line.slice(p.raw.length).trim()) return { end: true };
  if (p.kind === 'ul') return { next: p.raw };
  const num = parseInt(p.raw, 10);
  const sep = p.raw.includes(')') ? ')' : '.';
  return { next: `${num + 1}${sep} ` };
}

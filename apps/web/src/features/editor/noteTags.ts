// 공책 **태그 판** — 한 벌로 관리한다(요청: "태그는 한판으로 관리됐으면 좋겠어").
//
// ## 왜 문서 밖으로 옮겼나
//
// 태그는 처음에 **공책 한 권의 속성**이었다(`doc.cover.tags` + `doc.tagColors`).
// 그래서 A 공책에서 만든 태그가 B 공책의 고르개에는 없었고, 지우는 것도 그 권에서만
// 지워졌다 — 사용자가 본 것은 "같은 이름의 태그가 공책마다 따로 사는" 모습이다.
//
// 이제 **이름과 색은 이 판 하나**가 들고, 문서에는 "이 페이지가 어떤 태그인가"(`page.tag`)
// 만 남는다. 판은 기기에 적는다(`localStorage`) — 태그 목록을 담을 서버 포트가 아직
// 없고, 문서에 적으면 다시 권마다 갈리기 때문이다. 다른 기기에서는 그 기기의 판을
// 쓰되 **기본 여섯은 어디서나 같고**, 페이지에 붙은 태그 이름은 문서에 있으므로
// 글이 사라지지는 않는다(고르개 목록에만 없을 수 있다 — 아래 `usedTags`가 메운다).
//
// ## 지우기
//
// 기본 여섯은 코드에 박힌 상수라 목록에서 뺄 수 없다 — 대신 **가려 둔다**(`hidden`).
// 그래야 "지웠는데 새로고침하면 돌아온다"가 되지 않는다.

import { NOTE_TAGS, noteTagColor } from '@mindflow/mindmap-core';

const KEY = 'mf_note_tags';
/** 판이 바뀌었다 — 같은 탭의 다른 화면들이 다시 그리도록(`storage`는 다른 탭만 온다). */
const EVENT = 'mf-note-tags';

export interface NoteTagBoard {
  /** 사용자가 만든 태그 이름들(만든 순서). */
  made: string[];
  /** 이름 → 점 색. 고르지 않은 태그는 이름 해시로 정해진다(`noteTagColor`). */
  colors: Record<string, string>;
  /** 지운 **기본 태그**들 — 상수라 뺄 수 없으니 가린다. */
  hidden: string[];
}

const EMPTY: NoteTagBoard = { made: [], colors: {}, hidden: [] };

/**
 * 마지막으로 읽은 판과 **그때의 원본 글자**.
 *
 * 왜 캐시가 필요한가: 블록 하나를 그릴 때마다 색을 묻는 자리가 있어(`pageAccent`)
 * 그대로 두면 한 화면에 `JSON.parse`를 수백 번 한다.
 *
 * 왜 **원본 글자로** 맞춰 보나: 값만 들고 있으면 다른 탭이 고쳤을 때나 테스트가
 * `localStorage.clear()`를 했을 때 낡은 판을 계속 돌려준다(모듈 변수는 그대로 남는다).
 * `getItem`은 싸고 파싱만 비싸므로, 글자가 같을 때만 앞서 만든 값을 되쓴다.
 */
let cacheRaw: string | null = null;
let cache: NoteTagBoard | null = null;

function read(): NoteTagBoard {
  if (typeof localStorage === 'undefined') return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY; // 저장소를 막아 둔 환경 — 기본 여섯으로 산다
  }
  if (cache && cacheRaw === raw) return cache;
  try {
    const v = raw ? (JSON.parse(raw) as Partial<NoteTagBoard>) : {};
    cache = {
      made: Array.isArray(v.made) ? v.made.filter((t): t is string => typeof t === 'string') : [],
      colors: v.colors && typeof v.colors === 'object' ? (v.colors as Record<string, string>) : {},
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((t): t is string => typeof t === 'string') : [],
    };
  } catch {
    cache = EMPTY; // 깨진 값 — 지우지는 않는다(사람이 고칠 여지를 남긴다)
  }
  cacheRaw = raw;
  return cache;
}

function write(next: NoteTagBoard): void {
  const raw = JSON.stringify(next);
  cache = next;
  cacheRaw = raw;
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* 막아 둔 환경 — 이 세션 동안만 화면에 반영된다 */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* 이벤트를 못 쏘는 환경 — 다음 렌더에 읽힌다 */
  }
}

/** 지금 판 — 읽기 전용으로 쓴다. */
export function noteTagBoard(): NoteTagBoard {
  return read();
}

/** 고를 수 있는 태그들 — 기본 여섯(가린 것 제외) 다음에 만든 것들. */
export function noteTagOptions(): string[] {
  const b = read();
  const out = NOTE_TAGS.filter((t) => !b.hidden.includes(t));
  for (const t of b.made) if (!out.includes(t)) out.push(t);
  return out;
}

/** 태그를 만든다 — 색을 골랐으면 함께 적는다(고르지 않으면 이름 해시). */
export function addNoteTag(name: string, color?: string | null): void {
  const t = name.trim();
  if (!t) return;
  const b = read();
  const made = b.made.includes(t) || NOTE_TAGS.includes(t) ? b.made : [...b.made, t];
  const hidden = b.hidden.filter((x) => x !== t); // 가려 둔 기본 태그를 다시 만들면 되살아난다
  const colors = { ...b.colors };
  if (color) colors[t] = color;
  write({ made, colors, hidden });
}

/** 태그를 판에서 지운다 — 기본 여섯은 가리고, 만든 것은 목록에서 뺀다. */
export function removeNoteTag(name: string): void {
  const t = name.trim();
  if (!t) return;
  const b = read();
  const colors = { ...b.colors };
  delete colors[t];
  write({
    made: b.made.filter((x) => x !== t),
    colors,
    hidden: NOTE_TAGS.includes(t) && !b.hidden.includes(t) ? [...b.hidden, t] : b.hidden,
  });
}

/**
 * **옛 문서에 적혀 있던 태그를 판으로 옮긴다**(한 번만) — 태그가 권마다 따로 살던
 * 시절에 만든 것들이다. 문서는 건드리지 않는다(읽기만 한다): 그 값이 남아 있어도
 * 고르개는 이제 판을 보므로 해가 없고, 되돌리기·동기화를 건드리지 않는 편이 안전하다.
 */
export function absorbDocTags(made: readonly string[] | undefined, colors: Record<string, string> | undefined): void {
  if (!made?.length && !colors) return;
  const b = read();
  let changed = false;
  const nextMade = [...b.made];
  for (const t of made ?? []) {
    if (!t || nextMade.includes(t) || NOTE_TAGS.includes(t) || b.hidden.includes(t)) continue;
    nextMade.push(t);
    changed = true;
  }
  const nextColors = { ...b.colors };
  for (const [t, c] of Object.entries(colors ?? {})) {
    if (nextColors[t] || !c) continue;
    nextColors[t] = c;
    changed = true;
  }
  if (changed) write({ made: nextMade, colors: nextColors, hidden: b.hidden });
}

/** 판이 바뀔 때 부른다 — 같은 탭(커스텀 이벤트)과 다른 탭(`storage`) 둘 다. */
export function onNoteTagsChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === KEY) fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * 그 태그의 **점 색** — 판이 먼저, 없으면 그 문서에 남아 있던 옛 값, 그것도 없으면
 * 이름 해시(코어 `noteTagColor`). 화면 여러 곳이 같은 답을 내야 해서 한 함수로 둔다.
 */
export function noteTagInk(tag: string, docColors?: Record<string, string>): string {
  return noteTagColor(tag, { ...(docColors ?? {}), ...read().colors });
}

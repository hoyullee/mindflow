// 공책 **태그 판** — 한 벌로 관리한다(요청: "태그는 한판으로 관리됐으면 좋겠어").
//
// ## 왜 문서 밖으로 옮겼나
//
// 태그는 처음에 **공책 한 권의 속성**이었다(`doc.cover.tags` + `doc.tagColors`).
// 그래서 A 공책에서 만든 태그가 B 공책의 고르개에는 없었고, 지우는 것도 그 권에서만
// 지워졌다 — 사용자가 본 것은 "같은 이름의 태그가 공책마다 따로 사는" 모습이다.
//
// 이제 **이름과 색은 이 판 하나**가 들고, 문서에는 "이 페이지가 어떤 태그인가"(`page.tag`)
// 만 남는다.
//
// ## 판이 사는 곳 — 서버 한 벌 + 기기 캐시 한 벌
//
// 판의 정본은 **계정에 딸린 서버 행**이다(`TagStore` 포트 / `note_tags`, 0042). 기기가
// 바뀌어도 같은 판을 본다 — 이 모듈이 처음 나갔을 때의 한계("다른 기기에서는 그 기기의
// 판을 본다")를 걷어낸 자리다.
//
// 그런데 이 모듈의 함수들은 **동기**다: 블록 하나를 그릴 때마다 색을 묻는 자리가 있어
// (`pageAccent`) 비동기로 만들 수 없다. 그래서 `localStorage`를 **기기 캐시**로 계속
// 둔다 — 화면은 언제나 캐시를 즉시 읽고, 서버는 뒤에서 맞춘다:
//
// - 붙을 때(`attachNoteTagStore`) 서버 판을 읽어 기기 판과 **합친다**(아래 `merge`).
// - 고칠 때(`addNoteTag`/`removeNoteTag`) 캐시를 먼저 쓰고 서버로 던진다(기다리지 않는다).
// - 서버가 없거나 끊겨도 화면은 그대로 돈다(그때는 이 기기의 판으로 산다).
//
// 합치기가 **되살리지 않게** 하려고 지운 태그는 묘비(`hidden`)로 남긴다 — 아래 참고.
//
// ## 지우기
//
// 지운 태그는 목록에서 빼는 것으로 끝내지 않고 `hidden`에 이름을 남긴다. 기본 여섯은
// 코드에 박힌 상수라 **가리는 것 말고 지울 길이 없고**(그래야 "지웠는데 새로고침하면
// 돌아온다"가 되지 않는다), 만든 태그도 같은 표가 필요하다: 묘비가 없으면 아직 그
// 태그를 들고 있는 다른 기기의 판과 합칠 때 **지운 것이 되살아난다**.

import { NOTE_TAGS, noteTagColor } from '@mindflow/mindmap-core';
import type { NoteTagBoard, TagStore } from '../../adapters/ports';

export type { NoteTagBoard };

const KEY = 'mf_note_tags';
/** 판이 바뀌었다 — 같은 탭의 다른 화면들이 다시 그리도록(`storage`는 다른 탭만 온다). */
const EVENT = 'mf-note-tags';

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
/** 캐시에 담긴 판이 **어느 계정의 것인가**(로그인 전에 만든 판이면 `null`). */
let cacheUid: string | null = null;

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
    const v = raw ? (JSON.parse(raw) as Partial<NoteTagBoard> & { uid?: unknown }) : {};
    cache = {
      made: Array.isArray(v.made) ? v.made.filter((t): t is string => typeof t === 'string') : [],
      colors: v.colors && typeof v.colors === 'object' ? (v.colors as Record<string, string>) : {},
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((t): t is string => typeof t === 'string') : [],
    };
    cacheUid = typeof v.uid === 'string' ? v.uid : null;
  } catch {
    cache = EMPTY; // 깨진 값 — 지우지는 않는다(사람이 고칠 여지를 남긴다)
    cacheUid = null;
  }
  cacheRaw = raw;
  return cache;
}

function write(next: NoteTagBoard, opts?: { push?: boolean; uid?: string | null }): void {
  const uid = opts?.uid === undefined ? cacheUid : opts.uid;
  const raw = JSON.stringify({ ...next, ...(uid ? { uid } : {}) });
  cache = next;
  cacheRaw = raw;
  cacheUid = uid;
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* 막아 둔 환경 — 이 세션 동안만 화면에 반영된다 */
  }
  // 서버로도 올린다 — **기다리지 않는다**(태그 하나 만드는 데 네트워크를 태우지
  // 않는다). 실패는 어댑터가 콘솔로 남기고, 이 기기의 판은 그대로 유효하다.
  if (opts?.push !== false) void store?.save(next).catch(() => undefined);
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* 이벤트를 못 쏘는 환경 — 다음 렌더에 읽힌다 */
  }
}

// ── 서버 판과 맞추기 ────────────────────────────────────────────────────────

/** 지금 붙어 있는 저장소(`TagStore`) — 붙기 전에는 `null`이고, 그때도 화면은 돈다. */
let store: TagStore | null = null;
/** 지금 붙어 있는 계정 — 계정이 바뀌면 다시 맞춘다. */
let storeUid: string | null = null;

function uniq(...lists: readonly string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const t of list) if (t && !out.includes(t)) out.push(t);
  return out;
}

function sameBoard(a: NoteTagBoard, b: NoteTagBoard): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 서버 판과 기기 판을 합친다 — **서버가 먼저**고 기기에만 있는 것을 얹는다.
 *
 * 왜 합치나(서버로 덮지 않고): 이 기능이 기기에만 살던 동안 각 기기가 자기 태그를
 * 들고 있다. 서버 판을 처음 내려받는 순간 덮어쓰면 그 기기에서 만든 태그가 소리 없이
 * 사라진다. 반대로 합치기만 하면 **지운 것이 되살아나므로**, 지움은 `hidden`이라는
 * 묘비로 남겨 두고 합친 뒤 한 번 더 걸러 낸다(양쪽 어디서 지웠든 사라진 채로 남는다).
 */
function merge(remote: NoteTagBoard, local: NoteTagBoard): NoteTagBoard {
  const hidden = uniq(remote.hidden, local.hidden);
  return {
    made: uniq(remote.made, local.made).filter((t) => !hidden.includes(t)),
    colors: { ...local.colors, ...remote.colors }, // 색이 다르면 서버 쪽으로 모은다
    hidden,
  };
}

function isBlank(b: NoteTagBoard): boolean {
  return !b.made.length && !b.hidden.length && !Object.keys(b.colors).length;
}

/**
 * 이 계정의 판을 서버와 맞춘다 — 붙을 때 한 번.
 *
 * 세 갈래다:
 * - 서버에 판이 없다(첫 로그인·기능이 나가기 전부터 쓰던 사람) → 이 기기 판을 올린다.
 * - 서버에 판이 있다 → 합쳐서 캐시에 쓰고, 합친 결과가 서버와 다르면 올린다.
 * - 이 기기 캐시가 **다른 계정**의 것이다(공용 PC) → 섞지 않고 서버 판을 그대로 쓴다.
 */
async function sync(s: TagStore, uid: string | null): Promise<void> {
  let remote: NoteTagBoard | null = null;
  try {
    remote = await s.load();
  } catch {
    return; // 서버를 못 읽었다 — 이 기기 판으로 산다(다음 붙을 때 다시 맞춘다)
  }
  if (store !== s || storeUid !== uid) return; // 그 사이 계정/저장소가 바뀌었다
  const mine = read();
  // 로그인 전에 만든 판(`uid` 없음)은 **이 사람의 것으로 본다** — 방금 가입해 그대로
  // 이어 쓰는 흐름이 훨씬 흔하다. 다른 계정 id가 찍혀 있을 때만 섞지 않는다.
  const ours = cacheUid === null || cacheUid === uid;
  const local = ours ? mine : EMPTY;
  const next = remote ? merge(remote, local) : local;
  if (!sameBoard(next, mine) || cacheUid !== uid) write(next, { push: false, uid });
  // 서버에 없던(또는 이 기기가 더 아는) 판만 올린다 — 로그인할 때마다 쓰지 않는다.
  if (remote ? !sameBoard(next, remote) : !isBlank(next)) void s.save(next).catch(() => undefined);
}

/**
 * 태그 판을 서버 저장소에 잇는다 — 로그인한 화면이 뜰 때 `NoteTagsHost`가 부른다.
 * 같은 저장소·같은 계정으로 다시 불러도 아무 일도 하지 않는다.
 *
 * 맞추기가 끝나는 약속을 돌려준다 — 화면은 기다리지 않지만(캐시로 이미 그린다)
 * 테스트는 이것으로 기다린다.
 */
export function attachNoteTagStore(next: TagStore | null, uid: string | null): Promise<void> {
  if (store === next && storeUid === uid) return Promise.resolve();
  store = next;
  storeUid = uid;
  return next ? sync(next, uid) : Promise.resolve();
}

/** 저장소에서 뗀다 — 로그아웃(그리고 테스트 사이). */
export function detachNoteTagStore(): void {
  store = null;
  storeUid = null;
}

/** 지금 판 — 읽기 전용으로 쓴다. */
export function noteTagBoard(): NoteTagBoard {
  return read();
}

/** 고를 수 있는 태그들 — 기본 여섯(가린 것 제외) 다음에 만든 것들. */
export function noteTagOptions(): string[] {
  const b = read();
  const out = NOTE_TAGS.filter((t) => !b.hidden.includes(t));
  // `made`도 `hidden`으로 한 번 거른다 — 다른 기기에서 지운 태그가 합치기로 들어와
  // 있을 수 있다(묘비가 이기는 자리다).
  for (const t of b.made) if (!out.includes(t) && !b.hidden.includes(t)) out.push(t);
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

/**
 * 태그를 판에서 지운다 — 목록에서 빼고 **묘비를 남긴다**(`hidden`).
 *
 * 기본 여섯은 상수라 가리는 것 말고 길이 없고, 만든 태그도 같은 표가 필요하다:
 * 묘비가 없으면 아직 그 태그를 들고 있는 다른 기기의 판과 합칠 때 되살아난다.
 */
export function removeNoteTag(name: string): void {
  const t = name.trim();
  if (!t) return;
  const b = read();
  const colors = { ...b.colors };
  delete colors[t];
  write({
    made: b.made.filter((x) => x !== t),
    colors,
    hidden: b.hidden.includes(t) ? b.hidden : [...b.hidden, t],
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

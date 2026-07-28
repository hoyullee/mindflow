import type { DocMeta } from '../../adapters/ports';
import type { DriveFileData, MapCardData, SpaceData, TrashEntry } from './types';
import { downloadOrShare } from '../../platform/nativeBridge';

/** Home.dc.html:517,824 — `mf_recent` holds the last 4 opened map titles. */
export const RECENT_KEY = 'mf_recent';

/** Per-account LNB display-name overrides (`{ [email]: name }`), so a renamed
 * profile survives a reload instead of reverting to the email-derived default.
 * Keyed by email so switching accounts in one browser doesn't leak the name. */
const PROFILE_NAMES_KEY = 'mf_profile_names';

export function readSavedProfileName(email: string): string | null {
  try {
    const raw = localStorage.getItem(PROFILE_NAMES_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, unknown>;
    const v = map?.[email];
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function writeSavedProfileName(email: string, name: string): void {
  try {
    const raw = localStorage.getItem(PROFILE_NAMES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[email] = name;
    localStorage.setItem(PROFILE_NAMES_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable (private mode, quota, …) — non-fatal */
  }
}

/** Home.dc.html:813 `mapHref` / MindFlow editor `mindflow_doc_<id>` storage convention. */
export function docKey(id: string): string {
  return `mindflow_doc_${id}`;
}

/** Home.dc.html:662 `mapId(title)` — deterministic short hash used as the doc id for
 * maps that were never opened in the editor (so re-opening the same title round-trips
 * to the same storage slot). */
export function mapId(title: string): string {
  let h = 0;
  const s = String(title || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'm' + h.toString(36);
}

export interface StoredDoc {
  v?: number;
  nodes?: Record<string, { text?: string; [key: string]: unknown }>;
  floats?: unknown[];
  lines?: unknown[];
  zones?: unknown[];
  layoutMode?: string;
  themeKey?: string;
  needsLayout?: boolean;
}

export function readDoc(id: string): StoredDoc | null {
  try {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as StoredDoc;
  } catch {
    return null;
  }
}

export function readDocRaw(id: string): string | null {
  try {
    return localStorage.getItem(docKey(id));
  } catch {
    return null;
  }
}

export function rootTextOf(doc: StoredDoc | null): string {
  const root = doc?.nodes?.root;
  return (root && typeof root.text === 'string' ? root.text : '').trim();
}

/** Home.dc.html `docRawForTitle` — finds a saved doc by matching its root node text,
 * for maps that were opened under a `new-…` id rather than `mapId(title)`. */
export function docRawForTitle(title: string): string | null {
  const direct = readDocRaw(mapId(title));
  if (direct) return direct;
  const wanted = (title || '').trim();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mindflow_doc_')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw) as StoredDoc;
        if (rootTextOf(d) === wanted) return raw;
      } catch {
        /* ignore malformed doc */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as unknown;
    return Array.isArray(r) ? r.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode, quota, ...) — non-fatal */
  }
}

/**
 * Card identity key for the title-keyed legacy states (`mapFolders`, `favs`,
 * `recent`): the map's DOC ID when it has one, its title otherwise
 * (workspace-only cards, Drive demo files). Title keys are what let same-named
 * maps capture each other's folder assignment/favorite/recent entry — docId
 * keys can't collide across docs, and a rename no longer orphans the state.
 */
export function cardKeyOf(title: string, docId?: string): string {
  return docId ?? title;
}

/**
 * 제목 키를 **현재 소유하고 있는** 제목들 — docId 없는 카드의 제목.
 *
 * `cardKeyOf(title, undefined) === title`이므로, docId 없는 카드의 상태(폴더 배정·
 * 최근 항목)는 지금도 제목 키로 해석된다. 아래 두 마이그레이션이 그 키를 "같은 제목의
 * doc 카드"에게 넘겨 버리면 **살아 있는 카드의 상태를 빼앗는 것**이다.
 *
 * 실제로 그렇게 터졌다: 폴더 안에서 파일을 가져오면(가져온 카드는 docId가 없다)
 * `mapFolders['가져온 제목'] = 폴더id`가 되는데, 다른 스페이스에 같은 제목의 doc 카드가
 * 하나라도 있으면 다음 홈 진입의 마이그레이션이 그 키를 그 카드의 docId로 옮겨 버렸다.
 * 가져온 맵은 배정을 잃고 스페이스 최상위로 떨어졌다 — "처음엔 폴더에 있었는데 나중에
 * 스페이스로 옮겨져 있다"는 제보 그대로. (제목이 같은 카드가 같은 스페이스에 있으면
 * 가져오기가 "제목 (2)"로 바꾸므로, 다른 스페이스에 있을 때만 부딪힌다.)
 */
function titlesOwnedByKeylessCards(spaces: SpaceData[]): Set<string> {
  const owned = new Set<string>();
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (!m.docId) owned.add(m.title);
  }));
  return owned;
}

/**
 * One-time key migration for stored workspaces: `mapFolders` was historically
 * keyed by TITLE; move each entry whose title matches a doc-backed map onto
 * that map's docId key. Title keys with no matching doc-backed map (docId-less
 * cards) are kept as-is — `cardKeyOf` still resolves them by title.
 */
export function migrateMapFolderKeys(
  spaces: SpaceData[],
  mapFolders: Record<string, string>,
): { mapFolders: Record<string, string>; changed: boolean } {
  const docIdByTitle = new Map<string, string>();
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId && !docIdByTitle.has(m.title)) docIdByTitle.set(m.title, m.docId);
  }));
  const owned = titlesOwnedByKeylessCards(spaces);
  let changed = false;
  const out: Record<string, string> = {};
  for (const key of Object.keys(mapFolders)) {
    const docId = docIdByTitle.get(key);
    // Move title → docId only when the docId key isn't already taken (an
    // existing docId entry is newer truth — don't clobber it) AND no docId-less
    // card still resolves by this title (that card owns the key — see
    // `titlesOwnedByKeylessCards`).
    if (docId && docId !== key && mapFolders[docId] === undefined && !owned.has(key)) {
      out[docId] = mapFolders[key]!;
      changed = true;
    } else {
      out[key] = mapFolders[key]!;
    }
  }
  return { mapFolders: changed ? out : mapFolders, changed };
}

/**
 * ② 예전에 가져온 맵을 자기 문서에 **묶어 준다**(docId 부여).
 *
 * 배경: 가져오기가 백엔드에 올리지 않던 시절의 카드는 docId가 없다. 그래서
 *  - 본문이 이 기기의 localStorage에만 있어 다른 기기에서 열면 빈 맵이 되고,
 *  - 폴더 배정·즐겨찾기·최근 항목이 **제목**으로 키잉돼 제목이 겹치면 서로 가로챈다(#220).
 *
 * 어떤 카드를 묶는가 — 세 조건을 모두 만족할 때만:
 *  1. 카드에 docId가 없다.
 *  2. 이 기기에 본문이 있다(`mindflow_doc_<mapId(제목)>`). 없으면 올릴 게 없다
 *     — 그 맵은 다른 기기 소유이므로 건드리지 않는다.
 *  3. 백엔드에 그 id의 문서가 아직 없다(`metas`에 없다). 이미 있으면 **손대지 않는다**
 *     — 다른 기기가 올린 것일 수 있고, 덮어쓰면 그쪽 내용을 지운다.
 *
 * 그래서 각 맵은 "본문을 실제로 가진 기기" 하나만 올리고, 사본이 둘로 늘지 않는다.
 * id는 이미 로컬 캐시가 놓여 있는 `mapId(제목)`을 그대로 쓴다 — 새 id를 발급하면
 * 옛 키가 고아로 남아 로컬 모드에서 카드가 하나 더 생긴다.
 *
 * 순수 함수다: 어떤 카드를 어떤 id로 묶을지만 계산하고, 실제 업로드는 호출부가 한다.
 * (호출부는 업로드 성공 여부와 무관하게 묶어도 안전하다 — 실패하면 다음 진입에서
 * 조건 3이 여전히 참이라 다시 시도한다.)
 */
export function planImportBinding(
  spaces: SpaceData[],
  metas: DocMeta[],
  /**
   * 그 id의 문서가 이미 **있어도** 묶는다(업로드는 `createOnly`가 알아서 건너뛴다).
   *
   * 로컬/데모 모드에서만 켠다. 그 모드의 저장소는 localStorage 자신이라, 그 id의
   * 문서가 있다 = **바로 이 카드의 본문**이다(다른 기기라는 개념이 없다). 그래서
   * 조건 3이 항상 깨져 로컬 모드에서는 묶기가 통째로 무효였다.
   *
   * 백엔드 모드에서는 절대 켜지 않는다 — 거기서 같은 id의 행은 *다른 기기가 올린
   * 같은 제목의 다른 맵*일 수 있고, 거기에 카드를 묶으면 남의 내용을 우리 맵으로
   * 보여 주게 된다(그 다음 열기에서 우리 로컬 본문까지 덮인다).
   */
  adoptExisting = false,
): Array<{ title: string; docId: string }> {
  const backendIds = new Set(metas.map((m) => m.id));
  const out: Array<{ title: string; docId: string }> = [];
  const taken = new Set<string>();
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId) taken.add(m.docId);
  }));
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId) return;
    const id = mapId(m.title);
    // 다른 카드가 이미 그 id를 쓰고 있으면 비켜난다(같은 제목의 카드가 둘일 때).
    if (taken.has(id)) return;
    if (backendIds.has(id) && !adoptExisting) return;
    if (!readDocRaw(id)) return;
    taken.add(id);
    out.push({ title: m.title, docId: id });
  }));
  return out;
}

/** `planImportBinding`의 결과를 카드에 반영한다(순수). 제목이 같은 카드가 여러 개면
 * docId 없는 **첫** 카드에만 붙인다 — 계획도 제목당 하나만 만든다. */
export function applyImportBinding(spaces: SpaceData[], plan: Array<{ title: string; docId: string }>): SpaceData[] {
  if (!plan.length) return spaces;
  const byTitle = new Map(plan.map((p) => [p.title, p.docId]));
  return spaces.map((s) => ({
    ...s,
    maps: (Array.isArray(s.maps) ? s.maps : []).map((m) => {
      if (m.docId) return m;
      const id = byTitle.get(m.title);
      if (!id) return m;
      byTitle.delete(m.title);
      return { ...m, docId: id };
    }),
  }));
}

/** How many recent titles to RETAIN (localStorage + the cross-device synced
 * workspace blob). Effectively unlimited for display purposes — the tray never
 * shows more than fits one row (~27 cards even on 4K, see RECENT_RENDER_MAX) —
 * this is only a safety bound so the synced blob can't grow without end. */
export const RECENT_CAP = 100;

/** How many recent CARDS the view materializes (sketch build + thumbnail
 * prefetch). Must cover the widest realistic single row (4K ≈ 27 cards) and the
 * mobile swipe depth — beyond that, entries exist in history (RECENT_CAP) but
 * aren't rendered, keeping sketch work and doc-body fan-out bounded. */
export const RECENT_RENDER_MAX = 32;

/**
 * Prepend a card key (`cardKeyOf` — the doc id, or a title for docId-less
 * entries) to the persisted recent list (dedup, cap), returning the new list.
 * The editor calls this with its doc id the moment a doc loads, so "최근 항목"
 * reflects maps you actually opened — regardless of HOW (Home click, a direct
 * link, a mobile tap, a freshly created map). docId entries pin the EXACT doc,
 * so same-titled maps in different spaces each get their own recent entry and
 * a rename can't orphan one. Home syncs the list to the backend on its next
 * visit (and migrates legacy title entries — see `migrateRecentKeys`).
 */
export function pushRecentEntry(entry: string, cap = RECENT_CAP): string[] {
  const t = String(entry || '').trim();
  if (!t) return loadRecent();
  const next = [t, ...loadRecent().filter((x) => x !== t)].slice(0, cap);
  saveRecent(next);
  return next;
}

/**
 * One-time key migration for recent lists: historical entries were TITLES;
 * move each entry that matches a live doc-backed map onto that map's docId
 * (first occurrence wins — the one unavoidable legacy ambiguity), and collapse
 * aliases of the same doc (a docId entry + its title entry) into one. Entries
 * matching nothing (trashed docs' titles, docId entries, docId-less cards'
 * titles) pass through unchanged.
 */
export function migrateRecentKeys(spaces: SpaceData[], recent: string[]): { recent: string[]; changed: boolean } {
  const docIdByTitle = new Map<string, string>();
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId && !docIdByTitle.has(m.title)) docIdByTitle.set(m.title, m.docId);
  }));
  // 같은 함정(`titlesOwnedByKeylessCards` 참고): docId 없는 카드가 제목으로 해석되는
  // 항목이면 그 항목은 그 카드의 것이다. 옮기면 최근 항목이 **다른 맵**을 가리킨다.
  const owned = titlesOwnedByKeylessCards(spaces);
  let changed = false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of recent) {
    const key = owned.has(entry) ? entry : (docIdByTitle.get(entry) ?? entry);
    if (key !== entry) changed = true;
    if (seen.has(key)) {
      changed = true; // an alias collapsed away
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return { recent: changed ? out : recent, changed };
}

/**
 * Folds the per-device localStorage recents (`primary`) together with the
 * per-user synced recents from the backend (`secondary`), most-recent first,
 * de-duplicated and capped. `primary` wins ordering so a map just opened on THIS
 * device stays at the top, while the synced list fills in history opened on
 * OTHER devices (so recents follow the user from e.g. a work PC to a home PC).
 */
export function mergeRecent(primary: string[], secondary: string[] | undefined, cap = RECENT_CAP): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...primary, ...(secondary || [])]) {
    if (typeof t !== 'string' || !t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** The currently-viewed space/folder, persisted per TAB (sessionStorage) so
 * opening a map in the editor and coming back to Home returns to the space you
 * left from, instead of resetting to the default 일반 공간. Tab-scoped on purpose:
 * it's transient view state, not a synced preference. */
export const ACTIVE_VIEW_KEY = 'mf_active_view';

export interface ActiveView {
  activeSpace: string;
  curFolder: string | null;
}

export function saveActiveView(view: ActiveView): void {
  try {
    sessionStorage.setItem(ACTIVE_VIEW_KEY, JSON.stringify(view));
  } catch {
    /* storage unavailable — non-fatal (Home just won't restore the space) */
  }
}

export function loadActiveView(): ActiveView | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ActiveView>;
    if (v && typeof v.activeSpace === 'string') {
      return { activeSpace: v.activeSpace, curFolder: typeof v.curFolder === 'string' ? v.curFolder : null };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates a loaded-from-backend `spaces` blob (opaque `unknown[]` at the
 * `SpaceStore` boundary) into well-formed `SpaceData[]`, dropping anything
 * without a string id/name. Persistence itself now lives behind the
 * `SpaceStore` port (Local/Supabase adapters) so a user's spaces sync across
 * devices — see `useHomeController`'s mount/save effects. */
export function coerceSpaces(raw: unknown[]): SpaceData[] {
  return raw.filter((s): s is SpaceData => {
    const o = s as Partial<SpaceData> | null;
    return !!o && typeof o.id === 'string' && typeof o.name === 'string';
  });
}

/** Seeds the default "일반 공간" ONLY when there are no spaces at all (a fresh
 * account or missing/corrupt data). If the user has spaces but deleted the home
 * one, that deletion is respected — we do NOT resurrect 일반 공간 on reload.
 * (The rest of Home falls back to `spaces[0]` where a home space was assumed.) */
export function ensureHomeSpace(spaces: SpaceData[]): SpaceData[] {
  if (spaces.length) return spaces;
  return [{ id: 'general', name: '일반 공간', home: true as const, color: '#f0663f', maps: [] }];
}

/** Home.dc.html `syncDocsToCards()` — pick up maps saved from the editor under
 * `mindflow_doc_new-…` ids that aren't registered as a card yet, and keep existing
 * card titles in sync with their doc's root text. */
export function syncDocsToCards(spaces: SpaceData[]): { spaces: SpaceData[]; changed: boolean } {
  if (!spaces.length) return { spaces, changed: false };
  const known = new Set<string>();
  spaces.forEach((s) => (s.maps || []).forEach((m) => {
    known.add(m.title);
    if (m.docId) known.add('id:' + m.docId);
  }));

  const adds: MapCardData[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mindflow_doc_new-')) continue;
      const docId = k.slice('mindflow_doc_'.length);
      if (known.has('id:' + docId)) continue;
      const d = readDoc(docId);
      const t = rootTextOf(d);
      if (!t || known.has(t)) continue;
      adds.push({ title: t, when: '내 맵', hue: '#f0663f', docId });
      known.add(t);
      known.add('id:' + docId);
    }
  } catch {
    /* localStorage unavailable */
  }

  let changed = adds.length > 0;
  let next = spaces.map((s) => ({
    ...s,
    maps: (s.maps || []).map((m) => {
      if (!m.docId) return m;
      const d = readDoc(m.docId);
      const t = rootTextOf(d);
      if (t && t !== m.title) {
        changed = true;
        return { ...m, title: t };
      }
      return m;
    }),
  }));
  if (adds.length) {
    next = next.map((s, i) => (i === 0 ? { ...s, maps: [...(s.maps || []), ...adds] } : s));
  }
  return { spaces: next, changed };
}

/**
 * M4: the `DocStore`-backed replacement for `syncDocsToCards`'s localStorage
 * scan — same algorithm (any persisted doc not yet represented by a card, by
 * id OR by title, becomes a new card in the first space; a doc-backed card's
 * title is refreshed from its current doc), but driven by `DocStore.list()`
 * metadata instead of re-reading/parsing raw `mindflow_doc_*` localStorage
 * entries directly. Trashed docs (`deletedAt` set) don't reappear as cards —
 * Home's own trash list is a separate, editor-independent concept for now.
 */
export function mergeDocMetasIntoSpaces(spaces: SpaceData[], metas: DocMeta[]): { spaces: SpaceData[]; changed: boolean; renamed: Array<{ from: string; to: string }> } {
  if (!spaces.length) return { spaces, changed: false, renamed: [] };
  // Dedupe by docId; titles only block a meta when the matching card is
  // DOCID-LESS (that title match is what binds a legacy workspace-only card to
  // its backend doc). Duplicate titles across distinct docs are fully allowed
  // (XMind-style) — two same-titled metas each get their own card.
  const known = new Set<string>();
  spaces.forEach((s) => (s.maps || []).forEach((m) => {
    if (m.docId) known.add('id:' + m.docId);
    else known.add('t:' + m.title);
  }));

  const metaByDocId = new Map(metas.map((m) => [m.id, m]));
  const adds: MapCardData[] = [];
  metas.forEach((meta) => {
    if (meta.deletedAt || !meta.title) return;
    if (known.has('id:' + meta.id) || known.has('t:' + meta.title)) return;
    adds.push({ title: meta.title, when: '내 맵', hue: '#f0663f', docId: meta.id });
    known.add('id:' + meta.id);
  });

  let changed = adds.length > 0;
  // Cards renamed to match their backend title. Title-keyed state (mapFolders)
  // must be migrated by the caller, else a card's folder assignment is orphaned
  // (folder count still sees the old key while the card renders at the top level).
  const renamed: Array<{ from: string; to: string }> = [];
  let next = spaces.map((s) => ({
    ...s,
    maps: (s.maps || []).map((m) => {
      if (!m.docId) return m;
      const meta = metaByDocId.get(m.docId);
      if (meta && meta.title && meta.title !== m.title) {
        changed = true;
        renamed.push({ from: m.title, to: meta.title });
        return { ...m, title: meta.title };
      }
      return m;
    }),
  }));
  if (adds.length) {
    next = next.map((s, i) => (i === 0 ? { ...s, maps: [...(s.maps || []), ...adds] } : s));
  }
  return { spaces: next, changed, renamed };
}

/**
 * Home ticket ("favorites/trash don't survive reload"): seeds the title-keyed
 * `favs`/`deleted`/`trash` UI state from `DocStore.list()`'s `DocMeta[]` —
 * `meta.isFavorite` → favorites, `meta.deletedAt` → trash — so a doc-backed
 * map's favorite/deleted status (persisted by the backend, LocalDocStore or
 * SupabaseDocStore alike) is restored on mount instead of resetting to
 * "regular space" every refresh. Additive only (never un-favorites/un-trashes
 * something the current session already flipped locally): mirrors
 * `mergeDocMetasIntoSpaces`'s merge style right above.
 */
export function seedFavAndTrashFromMetas(
  favs: Record<string, boolean>,
  deleted: Record<string, boolean>,
  trash: TrashEntry[],
  metas: DocMeta[],
): { favs: Record<string, boolean>; deleted: Record<string, boolean>; trash: TrashEntry[]; changed: boolean } {
  let changed = false;
  const nextFavs = { ...favs };
  const nextDeleted = { ...deleted };
  const nextTrash = [...trash];
  for (const meta of metas) {
    if (!meta.title) continue;
    if (meta.deletedAt) {
      // Deleted takes precedence: a trashed map belongs only in the trash, not
      // in favorites — mirrors the live-session delete handlers, which clear
      // the favorite flag when a map is deleted. (The backend meta may still
      // carry isFavorite=true because `remove()` only sets deletedAt; seeding
      // it into favs here is what put the map in BOTH LNB lists after reload.)
      if (!nextDeleted[meta.title]) {
        nextDeleted[meta.title] = true;
        changed = true;
      }
      // Dedupe by docId, NOT title: trash policy allows two trashed maps (or a
      // trashed + live map) to share a title, so a same-titled entry for a
      // DIFFERENT doc must still get its own row.
      if (!nextTrash.some((t) => (t.docId ? t.docId === meta.id : t.title === meta.title))) {
        nextTrash.push({ title: meta.title, source: 'local', docId: meta.id });
        changed = true;
      }
      continue;
    }
    // Favorites are keyed by `cardKeyOf` — the doc ID for doc-backed maps — so
    // same-titled maps in different spaces keep independent stars and a rename
    // can't orphan the flag. (Drive demo files keep title keys via toggleFav's
    // fallback; they never appear in metas.)
    if (meta.isFavorite && !nextFavs[meta.id]) {
      nextFavs[meta.id] = true;
      changed = true;
    }
  }
  return { favs: nextFavs, deleted: nextDeleted, trash: nextTrash, changed };
}

// M7: see features/editor/download.ts's `downloadFile` for the native-shell
// rationale — same `downloadOrShare` gate, same unchanged web fallback.
export function downloadFile(name: string, text: string, mime?: string): void {
  downloadOrShare(name, text, mime || 'application/json;charset=utf-8', () => {
    const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

export function safeFileName(title: string): string {
  return String(title).replace(/[\\/:*?"<>|]/g, '_');
}

interface OutlineNode {
  [key: string]: unknown;
  id: string;
  text: string;
  emoji: string;
  parent: string | null;
  children: string[];
  collapsed: boolean;
  color: null;
  x?: number;
  y?: number;
}

/** Home.dc.html `parseOutline` — a markdown outline ("# title" root, "-" list items
 * indented by 2 spaces per level) becomes a minimal MindFlow doc. */
export function parseOutline(text: string, fallbackTitle: string): StoredDoc | null {
  const lines = String(text).split(/\r?\n/);
  let uid = 0;
  const mk = (t: string, parent: string | null): OutlineNode => ({
    id: 'n' + (++uid),
    text: t,
    emoji: '',
    parent,
    children: [],
    collapsed: false,
    color: null,
  });
  const nodes: Record<string, OutlineNode> = {};
  let rootText = fallbackTitle || '가져온 맵';
  const items: { depth: number; text: string }[] = [];
  for (const ln of lines) {
    const h = ln.match(/^#\s+(.+)/);
    if (h && items.length === 0) {
      rootText = (h[1] ?? '').trim();
      continue;
    }
    const m = ln.match(/^(\s*)[-*+]\s+(.+)/);
    if (m) items.push({ depth: Math.floor((m[1] ?? '').replace(/\t/g, '  ').length / 2) + 1, text: (m[2] ?? '').trim() });
  }
  const root: OutlineNode = { id: 'root', text: rootText, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 };
  nodes.root = root;
  const stack: { depth: number; id: string }[] = [{ depth: 0, id: 'root' }];
  for (const it of items) {
    while (stack.length > 1 && (stack[stack.length - 1]?.depth ?? 0) >= it.depth) stack.pop();
    const parent = stack[stack.length - 1]?.id ?? 'root';
    const n = mk(it.text, parent);
    nodes[n.id] = n;
    nodes[parent]?.children.push(n.id);
    stack.push({ depth: it.depth, id: n.id });
  }
  if (!root.children.length && !items.length) return null;
  return { v: 1, nodes, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral', needsLayout: true };
}

export function sourceOf(title: string, driveFiles: DriveFileData[]): 'drive' | 'local' {
  return driveFiles.some((f) => f.name === title) ? 'drive' : 'local';
}

export function hexA(hex: string, a: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.charAt(0) + c.charAt(0) + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2);
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function tintBg(hex: string): string {
  return hexA(hex, 0.07);
}

/** Home.dc.html `mapHref(title, docId)`. */
export function mapHref(title: string, docId?: string): string {
  return `/editor?map=${docId || mapId(title)}&title=${encodeURIComponent(title || '')}`;
}

/** Home.dc.html `newMapHref()`. Optional `title` seeds the new map's name —
 * duplicate names are allowed (identity is the fresh `new-…` doc id). */
/**
 * 새 문서 id. 내용·제목과 무관한 **유일 id**라, 같은 제목의 맵이 여러 기기에서
 * 만들어져도 서로 다른 문서가 된다. (예전에 가져오기가 쓰던 `mapId(제목)`은 제목이
 * 같으면 같은 id여서, 두 기기가 같은 행에 써 뒤에 저장한 쪽이 앞의 내용을 지웠다.)
 */
export function newDocId(): string {
  return `new-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export function newMapHref(title?: string): string {
  const base = `/editor?map=${newDocId()}&new=1`;
  const t = (title || '').trim();
  return t ? `${base}&title=${encodeURIComponent(t)}` : base;
}

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
 * Folder-assignment key for `mapFolders`: the map's DOC ID when it has one,
 * its title otherwise (workspace-only cards, Drive demo files). Title keys are
 * what let a trashed map's folder assignment "capture" a new live map that
 * happened to reuse the title — docId keys can't collide across docs, and a
 * rename no longer orphans the assignment.
 */
export function folderKeyOf(title: string, docId?: string): string {
  return docId ?? title;
}

/**
 * One-time key migration for stored workspaces: `mapFolders` was historically
 * keyed by TITLE; move each entry whose title matches a doc-backed map onto
 * that map's docId key. Title keys with no matching doc-backed map (docId-less
 * cards) are kept as-is — `folderKeyOf` still resolves them by title.
 */
export function migrateMapFolderKeys(
  spaces: SpaceData[],
  mapFolders: Record<string, string>,
): { mapFolders: Record<string, string>; changed: boolean } {
  const docIdByTitle = new Map<string, string>();
  spaces.forEach((s) => (Array.isArray(s.maps) ? s.maps : []).forEach((m) => {
    if (m.docId && !docIdByTitle.has(m.title)) docIdByTitle.set(m.title, m.docId);
  }));
  let changed = false;
  const out: Record<string, string> = {};
  for (const key of Object.keys(mapFolders)) {
    const docId = docIdByTitle.get(key);
    // Move title → docId only when the docId key isn't already taken (an
    // existing docId entry is newer truth — don't clobber it).
    if (docId && docId !== key && mapFolders[docId] === undefined) {
      out[docId] = mapFolders[key]!;
      changed = true;
    } else {
      out[key] = mapFolders[key]!;
    }
  }
  return { mapFolders: changed ? out : mapFolders, changed };
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
 * Prepend `title` to the persisted recent list (dedup, cap), returning the new
 * list. The editor calls this the moment a doc loads, so "최근 항목" reflects maps
 * you actually opened — regardless of HOW (Home double-click, a direct link, a
 * mobile tap, a freshly created map) — not just Home double-clicks. Title-keyed
 * to match Home's card titles; Home syncs it to the backend on its next visit.
 */
export function pushRecentTitle(title: string, cap = RECENT_CAP): string[] {
  const t = String(title || '').trim();
  if (!t) return loadRecent();
  const next = [t, ...loadRecent().filter((x) => x !== t)].slice(0, cap);
  saveRecent(next);
  return next;
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
  const known = new Set<string>();
  spaces.forEach((s) => (s.maps || []).forEach((m) => {
    known.add(m.title);
    if (m.docId) known.add('id:' + m.docId);
  }));

  const metaByDocId = new Map(metas.map((m) => [m.id, m]));
  const adds: MapCardData[] = [];
  metas.forEach((meta) => {
    if (meta.deletedAt || !meta.title) return;
    if (known.has('id:' + meta.id) || known.has(meta.title)) return;
    adds.push({ title: meta.title, when: '내 맵', hue: '#f0663f', docId: meta.id });
    known.add(meta.title);
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
    if (meta.isFavorite && !nextFavs[meta.title]) {
      nextFavs[meta.title] = true;
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
  const root: OutlineNode = { id: 'root', text: rootText, emoji: '🎯', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 };
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

/**
 * Appends "_1", "_2", … to `base` until the result doesn't collide with an
 * existing title (exact, trimmed match) — so a new map never shares a filename
 * with another map (which Home dedups by title, hiding the duplicate). Returns
 * `base` unchanged when it's already free.
 */
export function uniqueTitle(base: string, taken: Iterable<string>): string {
  const set = new Set<string>();
  for (const t of taken) {
    const norm = String(t || '').trim();
    if (norm) set.add(norm);
  }
  const b = String(base || '').trim() || '새 마인드맵';
  if (!set.has(b)) return b;
  let i = 1;
  while (set.has(`${b}_${i}`)) i += 1;
  return `${b}_${i}`;
}

/** Home.dc.html `newMapHref()`. Optional `title` seeds the new map's name (and
 * is auto-uniquified by the caller so it doesn't collide with an existing map). */
export function newMapHref(title?: string): string {
  const base = `/editor?map=new-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}&new=1`;
  const t = (title || '').trim();
  return t ? `${base}&title=${encodeURIComponent(t)}` : base;
}

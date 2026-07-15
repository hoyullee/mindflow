import type { DocMeta } from '../../adapters/ports';
import type { DriveFileData, MapCardData, SpaceData } from './types';
import { downloadOrShare } from '../../platform/nativeBridge';

/** Home.dc.html:517,824 — `mf_recent` holds the last 3 opened map titles. */
export const RECENT_KEY = 'mf_recent';

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
export function mergeDocMetasIntoSpaces(spaces: SpaceData[], metas: DocMeta[]): { spaces: SpaceData[]; changed: boolean } {
  if (!spaces.length) return { spaces, changed: false };
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
  let next = spaces.map((s) => ({
    ...s,
    maps: (s.maps || []).map((m) => {
      if (!m.docId) return m;
      const meta = metaByDocId.get(m.docId);
      if (meta && meta.title && meta.title !== m.title) {
        changed = true;
        return { ...m, title: meta.title };
      }
      return m;
    }),
  }));
  if (adds.length) {
    next = next.map((s, i) => (i === 0 ? { ...s, maps: [...(s.maps || []), ...adds] } : s));
  }
  return { spaces: next, changed };
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

/** Home.dc.html `newMapHref()`. */
export function newMapHref(): string {
  return `/editor?map=new-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}&new=1`;
}

// Doc load/seed for the editor route — thin localStorage wrapper around
// `@mindflow/mindmap-core`'s `parseDoc`/`serializeDoc`. Mirrors
// `Component#docKey` / `#loadDoc` / `#buildInitial` (MindFlow.dc.html:533,
// 792-808, 487-504) but simplified per the M3-Editor-a task: when nothing is
// saved yet, seed a single root node rather than the original's full demo
// tree (that demo-seed only ever fired for the legacy no-`mapId` route, which
// this app's Home always avoids by minting a `map=` id — see
// `apps/web/src/features/home/storage.ts` `newMapHref`/`mapHref`).

import type { Doc } from '@mindflow/mindmap-core';
import { DEFAULT_EDGE_STYLE, DEFAULT_LAYOUT_MODE, DEFAULT_THEME_KEY, ROOT_ID, parseDoc } from '@mindflow/mindmap-core';

/** Port of `Component#docKey` (MindFlow.dc.html:533). */
export function docStorageKey(mapId: string | null): string {
  return mapId ? `mindflow_doc_${mapId}` : 'mindflow_doc';
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A fresh single-root document — the `new` / never-saved case. */
export function seedDoc(title: string): Doc {
  return {
    v: 1,
    nodes: {
      [ROOT_ID]: {
        id: ROOT_ID,
        text: title || '새 마인드맵',
        emoji: '🎯',
        parent: null,
        children: [],
        collapsed: false,
        color: null,
        x: 0,
        y: 0,
      },
    },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: DEFAULT_LAYOUT_MODE,
    themeKey: DEFAULT_THEME_KEY,
    edgeStyle: DEFAULT_EDGE_STYLE,
  };
}

/** Whether a saved doc body exists in localStorage for `mapId`. When false, the
 * editor's synchronous seed is a PLACEHOLDER (`seedDoc`) that a backend load may
 * replace — the caller uses this to hold the canvas until that load resolves,
 * so the placeholder never flashes before the real tree. */
export function hasStoredDoc(mapId: string | null): boolean {
  return !!readRaw(docStorageKey(mapId));
}

/** Loads the saved doc for `mapId`, or seeds a fresh one titled `title`. */
export function loadOrSeedDoc(mapId: string | null, title: string): Doc {
  const raw = readRaw(docStorageKey(mapId));
  if (raw) {
    try {
      const parsed = parseDoc(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // malformed localStorage entry — fall through to a fresh seed
    }
  }
  return seedDoc(title);
}

/** Persists the doc (best-effort; storage may be unavailable in private mode). */
export function saveDoc(mapId: string | null, doc: Doc): void {
  try {
    localStorage.setItem(docStorageKey(mapId), JSON.stringify(doc));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

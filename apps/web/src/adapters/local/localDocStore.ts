// Demo/local doc store — the `DocStore` port over the SAME localStorage
// scheme the app already used pre-M4: `mindflow_doc_<id>` holds exactly
// `serializeDoc(doc)`'s JSON (nothing extra mixed in, so existing readers —
// `features/home/storage.ts`'s `readDoc`/`rootTextOf`/`docRawForTitle` and the
// editor's own `storage.ts` — keep working unchanged, and the reverse: a doc
// saved directly via those legacy helpers is loadable here too).
//
// Version/favorite/trash bookkeeping (things the original demo never had) is
// kept in a SEPARATE `mindflow_doc_meta_<id>` key rather than inside the doc
// JSON itself, so the doc payload never gains fields legacy code doesn't
// expect. A doc that exists without a meta entry (created by legacy code, or
// imported) is treated as version 1 the first time it's loaded/saved through
// this store.

import type { Doc } from '@mindflow/mindmap-core';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import type { DocMeta, DocStore, LoadedDoc, SaveOptions, SaveResult } from '../ports';

const DOC_PREFIX = 'mindflow_doc_';
const META_PREFIX = 'mindflow_doc_meta_';

function docKey(id: string): string {
  return DOC_PREFIX + id;
}
function metaKey(id: string): string {
  return META_PREFIX + id;
}

interface StoredMeta {
  version: number;
  updatedAt: string;
  title: string;
  isFavorite: boolean;
  deletedAt: string | null;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readMeta(id: string): StoredMeta | null {
  const raw = readRaw(metaKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMeta>;
    if (typeof parsed.version !== 'number') return null;
    return {
      version: parsed.version,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      title: parsed.title ?? '',
      isFavorite: Boolean(parsed.isFavorite),
      deletedAt: parsed.deletedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeMeta(id: string, meta: StoredMeta): void {
  writeRaw(metaKey(id), JSON.stringify(meta));
}

function rootTitleOf(doc: Doc): string {
  const root = doc.nodes?.root;
  return (root && typeof root.text === 'string' ? root.text : '').trim();
}

function listDocIds(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DOC_PREFIX) || k.startsWith(META_PREFIX)) continue;
      ids.push(k.slice(DOC_PREFIX.length));
    }
  } catch {
    /* localStorage unavailable */
  }
  return ids;
}

/**
 * `DocStore` backed by `localStorage` — the default/fallback adapter
 * (`adapters/factory.ts`) whenever Supabase env vars aren't configured.
 */
export class LocalDocStore implements DocStore {
  async list(): Promise<DocMeta[]> {
    const ids = listDocIds();
    const out: DocMeta[] = [];
    for (const id of ids) {
      const raw = readRaw(docKey(id));
      if (!raw) continue;
      let doc: Doc | null = null;
      try {
        doc = parseDoc(JSON.parse(raw));
      } catch {
        doc = null;
      }
      if (!doc) continue;
      const meta = readMeta(id);
      const title = meta?.title || rootTitleOf(doc) || '(제목 없음)';
      out.push({
        id,
        title,
        version: meta?.version ?? 1,
        updatedAt: meta?.updatedAt ?? new Date(0).toISOString(),
        isFavorite: meta?.isFavorite ?? false,
        deletedAt: meta?.deletedAt ?? null,
      });
    }
    return out;
  }

  async load(id: string): Promise<LoadedDoc | null> {
    const raw = readRaw(docKey(id));
    if (!raw) return null;
    let doc: Doc | null = null;
    try {
      doc = parseDoc(JSON.parse(raw));
    } catch {
      doc = null;
    }
    if (!doc) return null;
    const meta = readMeta(id);
    return { doc, version: meta?.version ?? 1, title: meta?.title || rootTitleOf(doc) };
  }

  async save(id: string, doc: Doc, opts: SaveOptions = {}): Promise<SaveResult> {
    const existing = readMeta(id);
    const currentVersion = existing?.version ?? (readRaw(docKey(id)) ? 1 : 0);
    if (opts.prevVersion !== undefined && opts.prevVersion !== currentVersion) {
      return { ok: false, reason: 'conflict', currentVersion };
    }
    const nextVersion = currentVersion + 1;
    const payload = JSON.stringify(serializeDoc(doc));
    if (!writeRaw(docKey(id), payload)) {
      return { ok: false, reason: 'error', message: '저장 공간을 사용할 수 없어요 (localStorage unavailable).' };
    }
    writeMeta(id, {
      version: nextVersion,
      updatedAt: new Date().toISOString(),
      title: opts.title || existing?.title || rootTitleOf(doc),
      isFavorite: existing?.isFavorite ?? false,
      deletedAt: existing?.deletedAt ?? null,
    });
    return { ok: true, version: nextVersion };
  }

  async remove(id: string): Promise<void> {
    const meta = readMeta(id) ?? { version: 1, updatedAt: new Date().toISOString(), title: '', isFavorite: false, deletedAt: null };
    writeMeta(id, { ...meta, deletedAt: new Date().toISOString() });
  }

  async restore(id: string): Promise<void> {
    const meta = readMeta(id);
    if (!meta) return;
    writeMeta(id, { ...meta, deletedAt: null });
  }

  async purge(id: string): Promise<void> {
    try {
      localStorage.removeItem(docKey(id));
      localStorage.removeItem(metaKey(id));
    } catch {
      /* storage unavailable — nothing to purge */
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const meta = readMeta(id) ?? { version: 1, updatedAt: new Date().toISOString(), title: '', isFavorite: false, deletedAt: null };
    writeMeta(id, { ...meta, title });
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    const meta = readMeta(id) ?? { version: 1, updatedAt: new Date().toISOString(), title: '', isFavorite: false, deletedAt: null };
    writeMeta(id, { ...meta, isFavorite: favorite });
  }
}

// Real doc store — `DocStore` implemented against the `documents` Postgres
// table (`supabase/migrations/0001_init.sql`). RLS restricts every
// query to `owner = auth.uid()`, so this adapter doesn't need to (and
// shouldn't) filter by owner itself — a stray missing `WHERE owner = ...`
// here is not a security hole, RLS is the actual enforcement boundary.
//
// Doc bodies are stored as-is in the `data` JSONB column, exactly as
// `serializeDoc` produces them — `load()` runs them back through `parseDoc`
// so a malformed/legacy row degrades to `null` rather than throwing.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Doc } from '@mindflow/mindmap-core';
import { parseDoc, serializeDoc } from '@mindflow/mindmap-core';
import type { DocMeta, DocStore, LoadedDoc, SaveOptions, SaveResult } from '../ports';

const TABLE = 'documents';

interface DocumentRow {
  id: string;
  title: string | null;
  version: number;
  data: unknown;
  updated_at: string;
  is_favorite: boolean | null;
  deleted_at: string | null;
}

export class SupabaseDocStore implements DocStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<DocMeta[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('id,title,version,updated_at,is_favorite,deleted_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as DocumentRow[]).map((row) => ({
      id: row.id,
      title: row.title ?? '(제목 없음)',
      version: row.version,
      updatedAt: row.updated_at,
      isFavorite: Boolean(row.is_favorite),
      deletedAt: row.deleted_at,
    }));
  }

  async load(id: string): Promise<LoadedDoc | null> {
    const { data, error } = await this.client.from(TABLE).select('id,title,version,data').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as DocumentRow;
    const doc: Doc | null = parseDoc(row.data);
    if (!doc) return null;
    return { doc, version: row.version, title: row.title ?? '' };
  }

  async save(id: string, doc: Doc, opts: SaveOptions = {}): Promise<SaveResult> {
    const payload = serializeDoc(doc);
    const nowIso = new Date().toISOString();

    if (opts.prevVersion === undefined) {
      // No known prior version: create-or-force-overwrite at version 1. Used
      // for a brand-new map's first save; callers that DO want locking on an
      // existing doc must pass the version `load()` returned.
      const { data, error } = await this.client
        .from(TABLE)
        .upsert({ id, title: opts.title ?? '', data: payload, version: 1, updated_at: nowIso }, { onConflict: 'id' })
        .select('version')
        .single();
      if (error) return { ok: false, reason: 'error', message: error.message };
      return { ok: true, version: (data as { version: number } | null)?.version ?? 1 };
    }

    const nextVersion = opts.prevVersion + 1;
    const update: Record<string, unknown> = { data: payload, version: nextVersion, updated_at: nowIso };
    if (opts.title !== undefined) update.title = opts.title;

    const { data, error } = await this.client.from(TABLE).update(update).eq('id', id).eq('version', opts.prevVersion).select('version').maybeSingle();
    if (error) return { ok: false, reason: 'error', message: error.message };
    if (!data) {
      // `UPDATE ... WHERE id = ? AND version = ?` matched no row: either the
      // doc doesn't exist, or someone else saved first — fetch the current
      // version so the caller can report *which* conflict this is.
      const { data: cur } = await this.client.from(TABLE).select('version').eq('id', id).maybeSingle();
      return { ok: false, reason: 'conflict', currentVersion: (cur as { version: number } | null)?.version ?? nextVersion };
    }
    return { ok: true, version: (data as { version: number }).version };
  }

  async remove(id: string): Promise<void> {
    await this.client.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }

  async restore(id: string): Promise<void> {
    await this.client.from(TABLE).update({ deleted_at: null }).eq('id', id);
  }

  async rename(id: string, title: string): Promise<void> {
    await this.client.from(TABLE).update({ title }).eq('id', id);
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.client.from(TABLE).update({ is_favorite: favorite }).eq('id', id);
  }
}

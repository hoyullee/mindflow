// Real spaces store — `SpaceStore` over the `workspaces` Postgres table
// (`supabase/migrations/0004_workspaces.sql`): exactly one row per user
// (`owner` PK, defaulted to `auth.uid()`), holding the whole workspace
// structure in a `data` JSONB column. RLS restricts every row to
// `owner = auth.uid()`, so this adapter never filters by owner itself — the
// user's own row is the only one any query can touch. Because it's per-user
// (not per-device), the workspace syncs across every device the user logs into.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpaceStore, WorkspaceData } from '../ports';

const TABLE = 'workspaces';

interface WorkspaceRow {
  data: { spaces?: unknown; mapFolders?: unknown } | null;
}

export class SupabaseSpaceStore implements SpaceStore {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<WorkspaceData | null> {
    // RLS scopes this to the current user's single row; no explicit owner filter.
    const { data, error } = await this.client.from(TABLE).select('data').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as WorkspaceRow;
    const body = row.data;
    if (!body || !Array.isArray(body.spaces)) return null;
    const mapFolders = body.mapFolders && typeof body.mapFolders === 'object' ? (body.mapFolders as Record<string, string>) : {};
    return { spaces: body.spaces, mapFolders };
  }

  async save(data: WorkspaceData): Promise<void> {
    // `owner` is omitted → the column default (`auth.uid()`) fills it on insert,
    // and `onConflict: 'owner'` upserts the user's existing row on subsequent
    // saves (mirrors `documents.owner`'s default — migration 0004/RLS enforce it).
    const { error } = await this.client
      .from(TABLE)
      .upsert({ data: { spaces: data.spaces, mapFolders: data.mapFolders }, updated_at: new Date().toISOString() }, { onConflict: 'owner' });
    if (error) throw new Error(error.message);
  }
}

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
  data: { spaces?: unknown; mapFolders?: unknown; recent?: unknown; theme?: unknown; homeLanding?: unknown; dashboards?: unknown; google?: unknown } | null;
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
    const recent = Array.isArray(body.recent) ? body.recent.filter((t): t is string => typeof t === 'string') : undefined;
    const theme = typeof body.theme === 'string' ? body.theme : undefined;
    // 첫 화면(요청) — 로컬 어댑터와 **같은 규칙**이다. ⚠️ 블롭을 필드별로 다시 짓는
    // 자리라 새 필드를 빠뜨리면 그 설정이 로드마다 지워진다(두 어댑터를 함께 고칠 것).
    const homeLanding = typeof body.homeLanding === 'string' ? body.homeLanding : undefined;
    const dashboards = Array.isArray(body.dashboards) ? body.dashboards : undefined;
    // 구글 캘린더 겹치기 설정(PR5) — 모양이 어긋나면 없는 것으로 본다.
    const g = body.google as { calendars?: unknown; extra?: unknown; holiday?: unknown } | undefined;
    // 그리오 목록에만 더한 캘린더(요청) — 모양이 어긋난 항목은 버린다(정본 검증은
    // `calendar/googleCalendar.ts`의 `coerceExtraCalendars`가 한다).
    const extra = g && Array.isArray(g.extra)
      ? (g.extra as unknown[]).filter((e): e is { id: string; name: string } => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' && typeof (e as { name?: unknown }).name === 'string')
      : undefined;
    // `holiday`(공휴일 국가)도 함께 실어 보낸다 — 여기서 필드별로 다시 지으면서
    // 빠뜨리면 사용자가 고른 나라가 **로드마다 지워진다**(`extra`에서 이미 겪은
    // 것과 같은 계열). 값 검증은 `googlePrefsOf`가 한다(모르는 값은 거른다).
    const google = g && Array.isArray(g.calendars)
      ? { calendars: g.calendars.filter((c): c is string => typeof c === 'string'), ...(extra?.length ? { extra } : {}), ...(typeof g.holiday === 'string' ? { holiday: g.holiday } : {}) }
      : undefined;
    return { spaces: body.spaces, mapFolders, recent, theme, homeLanding, dashboards, google };
  }

  async save(data: WorkspaceData): Promise<void> {
    // `owner` is omitted → the column default (`auth.uid()`) fills it on insert,
    // and `onConflict: 'owner'` upserts the user's existing row on subsequent
    // saves (mirrors `documents.owner`'s default — migration 0004/RLS enforce it).
    const { error } = await this.client
      .from(TABLE)
      .upsert({ data: { spaces: data.spaces, mapFolders: data.mapFolders, recent: data.recent ?? [], theme: data.theme, ...(data.homeLanding ? { homeLanding: data.homeLanding } : {}), dashboards: data.dashboards ?? [], ...(data.google ? { google: data.google } : {}) }, updated_at: new Date().toISOString() }, { onConflict: 'owner' });
    if (error) throw new Error(error.message);
  }
}

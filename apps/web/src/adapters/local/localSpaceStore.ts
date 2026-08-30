// Demo/local `SpaceStore` — the per-browser fallback used whenever Supabase
// isn't configured (plain checkout/CI). Persists the workspace structure as a
// single `mf_spaces` localStorage entry (same key the pre-backend version
// used, so an existing local workspace is picked up unchanged).

import type { SpaceStore, WorkspaceData } from '../ports';

const SPACES_KEY = 'mf_spaces';

export class LocalSpaceStore implements SpaceStore {
  async load(): Promise<WorkspaceData | null> {
    try {
      const raw = localStorage.getItem(SPACES_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { spaces?: unknown; mapFolders?: unknown; recent?: unknown; theme?: unknown; dashboards?: unknown; google?: unknown };
      if (!Array.isArray(parsed.spaces)) return null;
      const mapFolders = parsed.mapFolders && typeof parsed.mapFolders === 'object' ? (parsed.mapFolders as Record<string, string>) : {};
      const recent = Array.isArray(parsed.recent) ? parsed.recent.filter((t): t is string => typeof t === 'string') : undefined;
      const theme = typeof parsed.theme === 'string' ? parsed.theme : undefined;
      const dashboards = Array.isArray(parsed.dashboards) ? parsed.dashboards : undefined;
      // 구글 캘린더 겹치기 설정(PR5) — 모양이 어긋나면 없는 것으로 본다.
      const g = parsed.google as { calendars?: unknown } | undefined;
      const google = g && Array.isArray(g.calendars) ? { calendars: g.calendars.filter((c): c is string => typeof c === 'string') } : undefined;
      return { spaces: parsed.spaces, mapFolders, recent, theme, dashboards, google };
    } catch {
      return null;
    }
  }

  async save(data: WorkspaceData): Promise<void> {
    try {
      localStorage.setItem(SPACES_KEY, JSON.stringify({ v: 1, spaces: data.spaces, mapFolders: data.mapFolders, recent: data.recent ?? [], theme: data.theme, dashboards: data.dashboards ?? [], ...(data.google ? { google: data.google } : {}) }));
    } catch {
      /* storage unavailable (private mode, quota, ...) — non-fatal */
    }
  }
}

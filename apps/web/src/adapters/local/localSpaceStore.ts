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
      const parsed = JSON.parse(raw) as { spaces?: unknown; mapFolders?: unknown; recent?: unknown };
      if (!Array.isArray(parsed.spaces)) return null;
      const mapFolders = parsed.mapFolders && typeof parsed.mapFolders === 'object' ? (parsed.mapFolders as Record<string, string>) : {};
      const recent = Array.isArray(parsed.recent) ? parsed.recent.filter((t): t is string => typeof t === 'string') : undefined;
      return { spaces: parsed.spaces, mapFolders, recent };
    } catch {
      return null;
    }
  }

  async save(data: WorkspaceData): Promise<void> {
    try {
      localStorage.setItem(SPACES_KEY, JSON.stringify({ v: 1, spaces: data.spaces, mapFolders: data.mapFolders, recent: data.recent ?? [] }));
    } catch {
      /* storage unavailable (private mode, quota, ...) — non-fatal */
    }
  }
}

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
      const parsed = JSON.parse(raw) as { spaces?: unknown; mapFolders?: unknown; recent?: unknown; theme?: unknown; homeLanding?: unknown; dashboards?: unknown; google?: unknown };
      if (!Array.isArray(parsed.spaces)) return null;
      const mapFolders = parsed.mapFolders && typeof parsed.mapFolders === 'object' ? (parsed.mapFolders as Record<string, string>) : {};
      const recent = Array.isArray(parsed.recent) ? parsed.recent.filter((t): t is string => typeof t === 'string') : undefined;
      const theme = typeof parsed.theme === 'string' ? parsed.theme : undefined;
      // 첫 화면(요청) — 값 검증은 홈의 `homeLandingOf`가 한다. ⚠️ 이 `load()`는 블롭을
      // **필드별로 다시 짓는다**: 새 필드를 여기 빠뜨리면 그 설정이 로드마다 조용히
      // 지워진다(`google.extra`·`google.holiday`에서 두 번 겪었다).
      const homeLanding = typeof parsed.homeLanding === 'string' ? parsed.homeLanding : undefined;
      const dashboards = Array.isArray(parsed.dashboards) ? parsed.dashboards : undefined;
      // 구글 캘린더 겹치기 설정(PR5) — 모양이 어긋나면 없는 것으로 본다.
      const g = parsed.google as { calendars?: unknown; extra?: unknown; holiday?: unknown } | undefined;
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
      return { spaces: parsed.spaces, mapFolders, recent, theme, homeLanding, dashboards, google };
    } catch {
      return null;
    }
  }

  async save(data: WorkspaceData): Promise<void> {
    try {
      localStorage.setItem(SPACES_KEY, JSON.stringify({ v: 1, spaces: data.spaces, mapFolders: data.mapFolders, recent: data.recent ?? [], theme: data.theme, ...(data.homeLanding ? { homeLanding: data.homeLanding } : {}), dashboards: data.dashboards ?? [], ...(data.google ? { google: data.google } : {}) }));
    } catch {
      /* storage unavailable (private mode, quota, ...) — non-fatal */
    }
  }
}

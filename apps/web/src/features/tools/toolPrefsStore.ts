import { useSyncExternalStore } from 'react';
import { getSupabaseClient } from '../../adapters/supabase/supabaseClient';
import { isSupabaseConfigured, readViteEnv } from '../../adapters/env';
import { coerceToolPrefs, DEFAULT_TOOL_PREFS, type ToolPrefs } from './toolPrefs';

/**
 * 도구 설정의 **한 벌뿐인 사본** — LNB·설정·작업 현황이 같은 값을 본다(도구 스펙 §9
 * "어디서 바꿔도 즉시 서로 반영").
 *
 * 정본은 `user_tool_prefs`(0044)이고, 로컬·데모 모드는 이 기기의 localStorage다.
 * 첫 페인트용으로 사용자별 캐시를 따로 둔다 — 그게 없으면 LNB의 `작업 현황` 행이
 * 조회가 끝난 뒤에야 튀어나온다.
 */

const TABLE = 'user_tool_prefs';
const LOCAL_KEY = 'mf_tool_prefs';
const CACHE_PREFIX = 'mf_tool_prefs_cache:';
/** 이름 입력·토글이 연달아 와도 저장은 한 번 — 마지막 값만 나간다. */
const SAVE_DELAY_MS = 500;

interface Snapshot {
  prefs: ToolPrefs;
  /** 정본을 한 번이라도 읽었는가 — 읽기 전에는 저장하지 않는다(기본값으로 덮지 않게). */
  loaded: boolean;
}

let snap: Snapshot = { prefs: DEFAULT_TOOL_PREFS, loaded: false };
let userKey: string | null = null;
let loadSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot): void {
  snap = next;
  listeners.forEach((l) => l());
}

const remote = () => isSupabaseConfigured(readViteEnv());

function client() {
  const env = readViteEnv();
  return getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
}

function readCache(key: string): ToolPrefs | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? coerceToolPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, prefs: ToolPrefs): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(prefs));
  } catch {
    /* 캐시일 뿐 — 없으면 첫 페인트가 한 박자 늦을 뿐이다 */
  }
}

async function loadRemote(): Promise<ToolPrefs | null> {
  const { data, error } = await client().from(TABLE).select('data').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? coerceToolPrefs((data as { data: unknown }).data) : null;
}

function loadLocal(): ToolPrefs | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? coerceToolPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * 이 사용자의 설정을 불러온다 — 같은 사용자면 한 번만. 계정이 바뀌면 캐시로 곧바로
 * 갈아 끼우고 정본을 다시 읽는다.
 */
export function ensureToolPrefs(key: string): void {
  if (!key || key === userKey) return;
  userKey = key;
  const seq = ++loadSeq;
  emit({ prefs: readCache(key) ?? DEFAULT_TOOL_PREFS, loaded: false });
  const run = remote() ? loadRemote() : Promise.resolve(loadLocal());
  run
    .then((p) => {
      if (seq !== loadSeq) return;
      const prefs = p ?? DEFAULT_TOOL_PREFS;
      writeCache(key, prefs);
      emit({ prefs, loaded: true });
    })
    .catch(() => {
      // 못 읽었다 — 캐시로 그리되 **저장은 막아 둔다**(`loaded: false`). 기본값으로 정본을
      // 덮으면 휴일·이름이 사라진다(워크스페이스 블롭에서 겪은 일과 같은 자리).
    });
}

async function persist(prefs: ToolPrefs): Promise<void> {
  if (remote()) {
    const { error } = await client().from(TABLE).upsert({ data: prefs, updated_at: new Date().toISOString() }, { onConflict: 'owner' });
    if (error) throw new Error(error.message);
    return;
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs));
}

/** 설정을 바꾼다 — 화면은 곧바로, 저장은 잠깐 모았다가. */
export function updateToolPrefs(fn: (prev: ToolPrefs) => ToolPrefs): void {
  const prefs = fn(snap.prefs);
  if (prefs === snap.prefs) return;
  emit({ ...snap, prefs });
  if (userKey) writeCache(userKey, prefs);
  if (!snap.loaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist(snap.prefs).catch(() => {
      /* 저장 실패(오프라인 등) — 다음 변경이 다시 시도한다 */
    });
  }, SAVE_DELAY_MS);
}

export function useToolPrefs(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
    () => snap,
  );
}

/** 테스트·로그아웃 — 이 탭의 사본을 잊는다. */
export function resetToolPrefs(): void {
  userKey = null;
  loadSeq++;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  snap = { prefs: DEFAULT_TOOL_PREFS, loaded: false };
  listeners.forEach((l) => l());
}

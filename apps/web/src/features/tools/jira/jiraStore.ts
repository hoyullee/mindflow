import { useSyncExternalStore } from 'react';
import { isDisconnectReason, jiraReasonText, jiraSource, type JiraStatus } from './jiraApi';

/**
 * Jira **연결 상태**의 한 벌뿐인 사본 — LNB 행·도구 관리 팝오버·설정·작업 현황이 같은
 * 값을 본다. 정본은 서버(`jira` 함수의 `status`)이고, 첫 페인트용으로 사용자별 캐시를 둔다
 * (없으면 LNB의 `작업 현황` 행이 조회가 끝난 뒤에야 나타난다).
 *
 * `sync`는 **마지막 조회의 결과**다 — LNB 행의 상태 점(초록/주황)과 title이 이것을 말한다
 * (도구 스펙 §3.3·§8).
 */

export interface JiraSync {
  state: 'idle' | 'ok' | 'error';
  at: number | null;
  reason: string | null;
}

export interface JiraConn extends JiraStatus {
  /** 서버에 한 번이라도 물어봤는가. */
  known: boolean;
  /** 이 환경에서 연결을 쓸 수 없다(함수 미배포·시크릿 없음) — 사유 문장. */
  unavailable: string | null;
  /** 연결 흐름이 도는 중(동의 화면으로 떠나기 직전). */
  busy: boolean;
  sync: JiraSync;
  demo: boolean;
}

const CACHE_PREFIX = 'mf_jira_status:';
const EMPTY: JiraConn = { connected: false, site: null, projects: [], startField: null, known: false, unavailable: null, busy: false, sync: { state: 'idle', at: null, reason: null }, demo: false };

let snap: JiraConn = EMPTY;
let userKey: string | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit(patch: Partial<JiraConn>): void {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

function readCache(key: string): Partial<JiraStatus> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    const v = raw ? (JSON.parse(raw) as Partial<JiraStatus>) : null;
    return v && typeof v.connected === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(s: JiraStatus): void {
  if (!userKey) return;
  try {
    const { connected, site, projects, startField } = s;
    localStorage.setItem(CACHE_PREFIX + userKey, JSON.stringify({ connected, site, projects, startField }));
  } catch {
    /* 캐시일 뿐 */
  }
}

/** 서버가 알려 준 상태를 들인다(프로젝트 저장·사이트 선택의 응답도 여기로). */
export function applyJiraStatus(s: JiraStatus): void {
  const next = { connected: s.connected, site: s.site ?? null, projects: s.projects ?? [], startField: s.startField ?? null };
  writeCache(next);
  emit({ ...next, known: true, unavailable: null });
}

/** 이 사용자의 연결 상태를 불러온다 — 같은 사용자면 한 번만. */
export function ensureJiraStatus(key: string): void {
  if (!key || key === userKey) return;
  userKey = key;
  const cached = readCache(key);
  snap = { ...EMPTY, ...(cached ?? {}), demo: jiraSource().demo };
  listeners.forEach((l) => l());
  void refreshJiraStatus();
}

export async function refreshJiraStatus(): Promise<void> {
  const my = ++seq;
  const r = await jiraSource().status();
  if (my !== seq) return;
  if (r.ok) {
    applyJiraStatus(r);
    return;
  }
  // 이 환경에서 쓸 수 없다 — 연결된 것처럼 보이던 캐시도 거둔다(누르면 실패할 행을 두지 않는다).
  if (r.reason === 'not-configured' || r.reason === 'unavailable') {
    emit({ known: true, unavailable: jiraReasonText(r.reason), ...(r.reason === 'not-configured' ? { connected: false } : {}) });
    return;
  }
  emit({ known: true });
}

/** 연결을 시작한다 — 동의 화면으로 **이 창이 떠난다**(돌아오는 자리는 `/auth/jira`). */
export async function beginJiraConnect(): Promise<string | null> {
  emit({ busy: true });
  const redirectUri = `${window.location.origin}/auth/jira`;
  const r = await jiraSource().authorize(redirectUri);
  if (!r.ok) {
    emit({ busy: false });
    return jiraReasonText(r.reason);
  }
  window.location.assign(r.url);
  // 설치형 앱은 바깥 주소를 **시스템 브라우저**로 넘긴다(셸의 `will-navigate`) — 이 창은 남고,
  // 동의·교환은 브라우저에서 끝난다(자격 증명은 서버에 남는다). 창에 돌아오면 상태를 다시 묻는다.
  const back = () => {
    window.removeEventListener('focus', back);
    emit({ busy: false });
    void refreshJiraStatus();
  };
  window.addEventListener('focus', back);
  return null;
}

export async function disconnectJira(): Promise<string | null> {
  const r = await jiraSource().disconnect();
  if (!r.ok) return jiraReasonText(r.reason);
  applyJiraStatus({ connected: false, site: null, projects: [], startField: null });
  emit({ sync: { state: 'idle', at: null, reason: null } });
  return null;
}

/** 작업 현황의 조회 결과를 알린다 — 끊긴 사유면 연결 상태까지 내린다. */
export function reportJiraSync(okOrReason: true | string): void {
  if (okOrReason === true) {
    emit({ sync: { state: 'ok', at: Date.now(), reason: null } });
    return;
  }
  emit({ sync: { state: 'error', at: Date.now(), reason: jiraReasonText(okOrReason) } });
  if (isDisconnectReason(okOrReason)) applyJiraStatus({ connected: false, site: null, projects: [], startField: null });
}

export function useJiraConn(): JiraConn {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
    () => snap,
  );
}

export function resetJiraStore(): void {
  userKey = null;
  seq++;
  snap = EMPTY;
  listeners.forEach((l) => l());
}

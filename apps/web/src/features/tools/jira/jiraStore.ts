import { useSyncExternalStore } from 'react';
import { isDisconnectReason, jiraReasonText, jiraSource, type JiraStatus } from './jiraApi';
import { desktopBridge, openExternalUrl } from '../../../platform/desktopBridge';
import { readJiraDeepLink, stateOfAuthUrl } from './desktopJira';

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
const EMPTY: JiraConn = { connected: false, site: null, projects: [], startField: null, endField: null, fillDates: true, issueTypes: [], releaseField: null, known: false, unavailable: null, busy: false, sync: { state: 'idle', at: null, reason: null }, demo: false };

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
    const { connected, site, projects, startField, endField, fillDates, issueTypes, releaseField } = s;
    localStorage.setItem(CACHE_PREFIX + userKey, JSON.stringify({ connected, site, projects, startField, endField, fillDates, issueTypes, releaseField }));
  } catch {
    /* 캐시일 뿐 */
  }
}

/** 서버가 알려 준 상태를 들인다(프로젝트 저장·사이트 선택의 응답도 여기로). */
export function applyJiraStatus(s: JiraStatus): void {
  const next = { connected: s.connected, site: s.site ?? null, projects: s.projects ?? [], startField: s.startField ?? null, endField: s.endField ?? null, fillDates: s.fillDates !== false, issueTypes: s.issueTypes ?? [], releaseField: s.releaseField ?? null };
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

/**
 * 연결이 끝났다는 알림 — 홈이 듣고 작업 현황을 연다(`needsSetup`이면 프로젝트 고르기까지).
 * 웹은 콜백 페이지가 `/home?jira=…`로 돌아와 같은 일을 하고, 설치형 앱은 딥링크 교환 뒤 여기로 온다.
 */
type ConnectedEvent = { ok: true; needsSetup: boolean } | { ok: false; reason: string };
const connectedListeners = new Set<(e: ConnectedEvent) => void>();
export function onJiraConnected(fn: (e: ConnectedEvent) => void): () => void {
  connectedListeners.add(fn);
  return () => connectedListeners.delete(fn);
}

/** 설치형 앱이 시작한 연결의 `state` — 돌아온 딥링크가 이것과 같아야 받는다. */
let desktopPendingState: string | null = null;
let desktopLinkOff: (() => void) | null = null;

async function onDesktopDeepLink(url: string): Promise<void> {
  const got = readJiraDeepLink(url);
  if (!got) return; // 로그인·구글 캘린더 딥링크 — 우리 것이 아니다
  if (!desktopPendingState || got.state !== desktopPendingState) return; // 우리가 시작한 연결이 아니다
  desktopPendingState = null;
  const r = await jiraSource().exchange(got.code, got.state, `${window.location.origin}/auth/jira`);
  emit({ busy: false });
  if (!r.ok) {
    connectedListeners.forEach((l) => l({ ok: false, reason: r.reason }));
    return;
  }
  applyJiraStatus(r);
  connectedListeners.forEach((l) => l({ ok: true, needsSetup: !r.site || !r.projects.length }));
}

/**
 * 연결을 시작한다.
 * - 웹: 동의 화면으로 **이 창이 떠난다**(돌아오는 자리는 `/auth/jira` → `/home?jira=…`).
 * - 설치형 앱: 동의 화면을 **시스템 브라우저**로 열고, 브라우저가 `geurio://jira`로 코드를 돌려주면 앱이 교환한다
 *   (예전에는 브라우저가 교환까지 하고 웹 홈으로 가 버려 앱으로 돌아오지 못했다 — 제보).
 */
export async function beginJiraConnect(): Promise<string | null> {
  emit({ busy: true });
  const redirectUri = `${window.location.origin}/auth/jira`;
  const bridge = desktopBridge();
  const r = await jiraSource().authorize(redirectUri, !!bridge);
  if (!r.ok) {
    emit({ busy: false });
    return jiraReasonText(r.reason);
  }
  if (bridge) {
    desktopPendingState = stateOfAuthUrl(r.url);
    if (!desktopLinkOff) desktopLinkOff = bridge.onDeepLink((url) => void onDesktopDeepLink(url));
    await openExternalUrl(r.url);
    // 브라우저에서 그만두고 돌아온 경우 — 창에 돌아오면 잠시 뒤 기다림을 푼다(딥링크가 먼저 오면 그쪽이 푼다).
    const back = () => {
      window.removeEventListener('focus', back);
      setTimeout(() => {
        if (snap.busy && desktopPendingState) emit({ busy: false });
      }, 4000);
    };
    window.addEventListener('focus', back);
    return null;
  }
  window.location.assign(r.url);
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
  desktopLinkOff?.();
  desktopLinkOff = null;
  desktopPendingState = null;
  userKey = null;
  seq++;
  snap = EMPTY;
  listeners.forEach((l) => l());
}

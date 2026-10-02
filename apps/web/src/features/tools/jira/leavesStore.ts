import { useEffect, useSyncExternalStore } from 'react';
import { getSupabaseClient } from '../../../adapters/supabase/supabaseClient';
import { isSupabaseConfigured, readViteEnv } from '../../../adapters/env';
import type { LeaveKind, LeaveLike } from '../workstatus/model';
import { shiftMonths } from './jiraDemo';

/**
 * 작업 현황 · **담당자 휴가**(휴가 스펙) — 한 벌뿐인 사본.
 *
 * 정본은 `jira_leaves`(0050). 같은 Jira 사이트를 연결한 사람 모두가 보고 누구나 등록하며,
 * **수정·삭제는 등록한 사람만**(RLS — 사용자 결정 "A+2"). 사이트는 서버가 호출자의 연결에서
 * 읽으므로 클라이언트가 보내는 `cloud_id`는 RLS 검사를 통과하기 위한 값일 뿐이다.
 *
 * 다른 사람이 넣은 휴가는 **60초 폴링**으로 들어온다(스펙 §10 — 소켓까지는 두지 않는다).
 * 로컬·데모 모드는 이 기기의 localStorage에 산다(샘플은 스펙 §11).
 */

export interface Leave extends LeaveLike {
  id: string;
  personName: string;
  note: string;
  /** 내가 등록했다 — 수정·삭제 단추는 이때만. */
  mine: boolean;
}

export interface LeaveInput {
  person: string;
  personName: string;
  start: string;
  end: string;
  kind: LeaveKind;
  note: string;
}

interface Snap {
  leaves: Leave[];
  loaded: boolean;
}

const TABLE = 'jira_leaves';
const DEMO_KEY = 'mf_jira_demo_leaves';
const POLL_MS = 60_000;
/** 오늘 앞뒤로 이만큼만 받는다 — 일정 맞춰보기·달 이동이 닿는 범위. */
const WINDOW_DAYS = 400;

let snap: Snap = { leaves: [], loaded: false };
let site: string | null = null;
let seq = 0;
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snap): void {
  snap = next;
  listeners.forEach((l) => l());
}

const remote = () => isSupabaseConfigured(readViteEnv());
function client() {
  const env = readViteEnv();
  return getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function windowOf(now = new Date()): { from: string; to: string } {
  const a = new Date(now);
  a.setDate(a.getDate() - WINDOW_DAYS);
  const b = new Date(now);
  b.setDate(b.getDate() + WINDOW_DAYS);
  return { from: iso(a), to: iso(b) };
}

const byStart = (a: Leave, b: Leave) => a.start.localeCompare(b.start) || a.person.localeCompare(b.person) || a.kind.localeCompare(b.kind);
const isKind = (k: unknown): k is LeaveKind => k === 'full' || k === 'am' || k === 'pm';

// ── 데모(이 기기) ───────────────────────────────────────────────────────

interface DemoLeave extends Omit<Leave, 'mine'> {
  mine: boolean;
}

/** 스펙 §11의 샘플 — 데모 담당자(jiraDemo)와 같은 id, 오늘이 든 달로 옮겨서. 남이 넣은 것으로 둔다(× 없음). */
function demoSeed(): DemoLeave[] {
  const now = new Date();
  const n = now.getFullYear() * 12 + now.getMonth() - (2026 * 12 + 8);
  const s = (d: string) => shiftMonths(d, n);
  return [
    { id: 'demo-lv1', person: 'demo-p2', personName: '김서연', start: s('2026-09-22'), end: s('2026-09-23'), kind: 'full', note: '연차', mine: false },
    { id: 'demo-lv2', person: 'demo-p5', personName: '정다은', start: s('2026-10-05'), end: s('2026-10-07'), kind: 'full', note: '연차', mine: false },
    { id: 'demo-lv3', person: 'demo-p3', personName: '박지훈', start: s('2026-09-30'), end: s('2026-09-30'), kind: 'pm', note: '병원', mine: false },
  ];
}

function readDemo(): DemoLeave[] {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return demoSeed();
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as DemoLeave[]).filter((l) => l && typeof l.id === 'string' && isKind(l.kind)) : demoSeed();
  } catch {
    return demoSeed();
  }
}
function writeDemo(list: DemoLeave[]): void {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(list));
  } catch {
    /* 데모일 뿐 */
  }
}

// ── 겹침(서버 트리거와 같은 규칙 — 데모와, 서버에 묻기 전의 안내) ─────────────────

/** 같은 사람의 휴가와 겹치는가 — 같은 날 오전 + 오후 반차 둘은 허용(= 종일). */
export function overlapsLeave(list: readonly LeaveLike[], v: LeaveLike, exceptId?: string): boolean {
  return list.some((l) => {
    if ((exceptId !== undefined && (l as Partial<Leave>).id === exceptId) || l.person !== v.person) return false;
    if (l.start > v.end || l.end < v.start) return false;
    const halves = l.kind !== 'full' && v.kind !== 'full' && l.kind !== v.kind && l.start === v.start && l.end === v.end;
    return !halves;
  });
}

/** 입력 검사 — 서버의 check 제약과 같다. 문제없으면 null. */
export function leaveInputError(v: LeaveInput): string | null {
  if (!v.start || !v.end) return '날짜를 골라 주세요';
  if (v.start > v.end) return '끝 날짜가 시작보다 앞이에요';
  if (v.kind !== 'full' && v.start !== v.end) return '반차는 하루만 고를 수 있어요';
  const span = (Date.parse(`${v.end}T00:00:00Z`) - Date.parse(`${v.start}T00:00:00Z`)) / 86_400_000;
  if (span > 366) return '휴가는 1년까지만 등록할 수 있어요';
  return null;
}

// ── 서버 ───────────────────────────────────────────────────────────────

interface Row {
  id: string;
  person: string;
  person_name: string;
  start_date: string;
  end_date: string;
  kind: string;
  note: string;
  created_by: string;
}

async function myId(): Promise<string | null> {
  try {
    const { data } = await client().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

async function fetchRemote(): Promise<Leave[] | null> {
  const { from, to } = windowOf();
  const [me, res] = await Promise.all([myId(), client().from(TABLE).select('id, person, person_name, start_date, end_date, kind, note, created_by').lte('start_date', to).gte('end_date', from).order('start_date').limit(2000)]);
  if (res.error || !res.data) return null;
  return (res.data as Row[]).filter((r) => isKind(r.kind)).map((r) => ({ id: r.id, person: r.person, personName: r.person_name, start: r.start_date, end: r.end_date, kind: r.kind as LeaveKind, note: r.note ?? '', mine: !!me && r.created_by === me }));
}

/** 서버 오류 → 사람의 문장. 겹침은 트리거의 `leave-overlap`. */
function errorText(e: { message?: string; code?: string } | null): string {
  if (!e) return '저장하지 못했어요 · 잠시 뒤 다시 시도해 주세요';
  if ((e.message ?? '').includes('leave-overlap')) return '이미 등록된 휴가와 겹쳐요';
  if (e.code === '42501') return '이 휴가를 바꿀 권한이 없어요 · 등록한 사람만 고칠 수 있어요';
  return '저장하지 못했어요 · 잠시 뒤 다시 시도해 주세요';
}

// ── 공개 ───────────────────────────────────────────────────────────────

export async function refreshLeaves(): Promise<void> {
  const my = ++seq;
  if (!remote()) {
    emit({ leaves: readDemo().sort(byStart), loaded: true });
    return;
  }
  if (!site) return;
  const got = await fetchRemote();
  if (my !== seq || !got) return;
  emit({ leaves: got.sort(byStart), loaded: true });
}

function setSite(id: string | null): void {
  // 같은 사이트면 새로 받기만 — 화면을 다시 열면 그사이 남이 넣은 것까지 곧바로.
  if (id === site) {
    void refreshLeaves();
    return;
  }
  site = id;
  seq++;
  emit({ leaves: [], loaded: false });
  void refreshLeaves();
}

/**
 * 이 사이트의 휴가를 구독한다 — 쓰는 화면이 떠 있는 동안 60초마다 새로 받는다.
 * `siteId`가 null이면(연결 전) 빈 목록.
 */
export function useJiraLeaves(siteId: string | null): Snap {
  useEffect(() => {
    if (!siteId) return;
    setSite(siteId);
    users++;
    if (!timer) timer = setInterval(() => void refreshLeaves(), POLL_MS);
    const onFocus = () => void refreshLeaves();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      users--;
      if (!users && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [siteId]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
  );
}

const clean = (v: LeaveInput) => ({ ...v, note: v.note.trim().slice(0, 60), personName: v.personName.slice(0, 120) });

/** 등록 — 실패하면 사람의 문장, 성공하면 null. */
export async function addLeave(input: LeaveInput): Promise<string | null> {
  const v = clean(input);
  const bad = leaveInputError(v);
  if (bad) return bad;
  if (overlapsLeave(snap.leaves, v)) return '이미 등록된 휴가와 겹쳐요';
  if (!remote()) {
    const list = readDemo();
    if (overlapsLeave(list, v)) return '이미 등록된 휴가와 겹쳐요';
    writeDemo([...list, { ...v, id: `demo-lv-${Date.now().toString(36)}`, mine: true }]);
    await refreshLeaves();
    return null;
  }
  if (!site) return 'Jira 사이트를 먼저 골라 주세요';
  const { error } = await client().from(TABLE).insert({ cloud_id: site, person: v.person, person_name: v.personName, start_date: v.start, end_date: v.end, kind: v.kind, note: v.note });
  await refreshLeaves();
  return error ? errorText(error) : null;
}

/** 수정 — 내가 등록한 것만(서버 RLS가 한 번 더 막는다). */
export async function updateLeave(id: string, input: LeaveInput): Promise<string | null> {
  const v = clean(input);
  const bad = leaveInputError(v);
  if (bad) return bad;
  const cur = snap.leaves.find((l) => l.id === id);
  if (cur && !cur.mine) return '등록한 사람만 고칠 수 있어요';
  if (overlapsLeave(snap.leaves, v, id)) return '이미 등록된 휴가와 겹쳐요';
  if (!remote()) {
    const list = readDemo();
    if (overlapsLeave(list, v, id)) return '이미 등록된 휴가와 겹쳐요';
    writeDemo(list.map((l) => (l.id === id ? { ...l, ...v } : l)));
    await refreshLeaves();
    return null;
  }
  const { data, error } = await client().from(TABLE).update({ person: v.person, person_name: v.personName, start_date: v.start, end_date: v.end, kind: v.kind, note: v.note }).eq('id', id).select('id');
  await refreshLeaves();
  if (error) return errorText(error);
  // RLS가 걸러 0건이면 오류 없이 빈 배열이 온다 — 남의 것이었다.
  return data && data.length ? null : '등록한 사람만 고칠 수 있어요';
}

/** 삭제 — 내가 등록한 것만. 지운 것을 돌려준다(되돌리기용). */
export async function deleteLeave(id: string): Promise<{ error: string | null; removed: Leave | null }> {
  const cur = snap.leaves.find((l) => l.id === id) ?? null;
  if (cur && !cur.mine) return { error: '등록한 사람만 지울 수 있어요', removed: null };
  // 곧바로 화면에서 뺀다 — 서버가 거절하면 다시 받아 오면서 돌아온다.
  emit({ ...snap, leaves: snap.leaves.filter((l) => l.id !== id) });
  if (!remote()) {
    writeDemo(readDemo().filter((l) => l.id !== id));
    await refreshLeaves();
    return { error: null, removed: cur };
  }
  const { data, error } = await client().from(TABLE).delete().eq('id', id).select('id');
  await refreshLeaves();
  if (error) return { error: errorText(error), removed: null };
  return data && data.length ? { error: null, removed: cur } : { error: '등록한 사람만 지울 수 있어요', removed: null };
}

/** 테스트용 — 모듈 상태를 비운다. */
export function resetLeavesForTest(): void {
  snap = { leaves: [], loaded: false };
  site = null;
  seq++;
  if (timer) clearInterval(timer);
  timer = null;
  users = 0;
}

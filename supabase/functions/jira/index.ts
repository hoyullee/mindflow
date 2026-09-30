// Jira(도구 · 작업 현황) — **연결하고, 대신 조회한다.**
//
// ── 왜 모든 조회가 여기를 지나는가 ──────────────────────────────────────
// ① 코드 교환·갱신에 client secret이 필요하다(브라우저 번들에 넣을 수 없다).
// ② Jira REST(`api.atlassian.com/ex/jira/...`)는 **브라우저 호출(CORS)을 받지 않는다** —
//    구글 캘린더처럼 액세스 토큰만 내려 주고 브라우저가 부르는 설계가 불가능하다.
// 그래서 토큰은 한 번도 브라우저로 나가지 않고, 브라우저는 "이 달의 티켓"처럼
// **우리가 정한 질문**만 할 수 있다(임의 경로를 대신 불러 주는 프록시가 아니다).
//
// ── 클라이언트를 믿지 않는다(google-oauth와 같다) ─────────────────────────
// 모든 동작이 호출자의 JWT로 사용자를 먼저 확인하고 **그 사람의 행만** 만진다.
//
// ── 설정이 없으면 조용히 물러난다 ───────────────────────────────────────
// `ATLASSIAN_CLIENT_ID`·`ATLASSIAN_CLIENT_SECRET`이 없으면 200 `{ ok:false, reason:'not-configured' }`.
// 화면은 그때 `연결` 버튼을 눌러도 "아직 준비 중"이라고 말한다(배포 순서와 무관하게 앱이 깨지지 않는다).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  coerceProjects,
  epicFields,
  epicFromParent,
  epicsJql,
  isCustomField,
  normalizeEpic,
  normalizeTicket,
  normalizeUsers,
  pickStartField,
  ticketFields,
  ticketsJql,
  type JiraEpic,
  type JiraProjectRef,
  type JiraTicket,
} from '../_shared/jira.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const AUTH_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
/** 읽기만 한다 — `offline_access`가 없으면 refresh token이 오지 않아 한 시간마다 끊긴다. */
const SCOPES = ['read:jira-work', 'read:jira-user', 'offline_access'];
/** 인가 요청의 `state`가 유효한 시간 — 동의 화면에서 머뭇거리는 시간을 넉넉히. */
const STATE_TTL_MS = 20 * 60 * 1000;
/** 한 번의 조회가 끌어오는 티켓 상한(100 × 10쪽) — 넘으면 `truncated`로 알린다. */
const MAX_PAGES = 10;

interface Row {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  version: number;
  scope: string | null;
  cloud_id: string | null;
  site_url: string | null;
  site_name: string | null;
  projects: unknown;
  start_field: string | null;
  start_field_name: string | null;
}

interface Site {
  id: string;
  url: string;
  name: string;
}

class Fail extends Error {
  constructor(readonly reason: string, readonly detail = '') {
    super(reason);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: 'server not configured' }, 500);
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const action = typeof payload.action === 'string' ? payload.action : '';

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const uid = userData?.user?.id ?? '';
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const clientId = Deno.env.get('ATLASSIAN_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('ATLASSIAN_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) return json({ ok: false, reason: 'not-configured' });

  const admin = createClient(supabaseUrl, serviceKey);
  const ctx = { admin, uid, clientId, clientSecret };

  try {
    switch (action) {
      case 'authorize':
        return json(await authorize(ctx, payload));
      case 'exchange':
        return json(await exchange(ctx, payload));
      case 'status':
        return json(await status(ctx));
      case 'sites':
        return json(await sites(ctx));
      case 'select-site':
        return json(await selectSite(ctx, payload));
      case 'projects':
        return json(await projects(ctx, payload));
      case 'save-projects':
        return json(await saveProjects(ctx, payload));
      case 'issues':
        return json(await issues(ctx, payload));
      case 'users':
        return json(await users(ctx, payload));
      case 'disconnect':
        // Atlassian은 3LO 토큰을 폐기하는 공개 엔드포인트가 없다 — 우리 쪽 자격 증명을
        // 지우면 더는 아무것도 부를 수 없다(사용자가 원하면 Atlassian 계정 설정 › 연결된
        // 앱에서 승인까지 거둘 수 있다 — 화면이 그 사실을 말한다).
        await admin.from('jira_credentials').delete().eq('user_id', uid);
        return json({ ok: true });
      default:
        return json({ error: 'bad request' }, 400);
    }
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, reason: e.reason, detail: e.detail });
    console.error('[jira]', e);
    return json({ ok: false, reason: 'server-error' });
  }
});

interface Ctx {
  admin: SupabaseClient;
  uid: string;
  clientId: string;
  clientSecret: string;
}

// ── 인가 ─────────────────────────────────────────────────────────────

/**
 * 동의 화면 주소. `state`는 **이 사용자와 시각에 묶인 서명**이라(HMAC — 열쇠는 client
 * secret) 서버에 따로 적어 둘 것이 없다: 교환 때 같은 사용자가 같은 값을 들고 와야만 통과한다.
 * 브라우저 저장소에 기대지 않으므로 설치형 앱이 **시스템 브라우저에서** 동의를 마쳐도 된다.
 */
async function authorize(ctx: Ctx, p: Record<string, unknown>) {
  const redirectUri = validRedirect(p.redirectUri);
  if (!redirectUri) throw new Fail('bad-redirect');
  const state = await signState(ctx, Date.now());
  const q = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: ctx.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return { ok: true, url: `${AUTH_URL}?${q.toString()}` };
}

async function exchange(ctx: Ctx, p: Record<string, unknown>) {
  const code = typeof p.code === 'string' ? p.code : '';
  const redirectUri = validRedirect(p.redirectUri);
  if (!code || !redirectUri) throw new Fail('bad-request');
  if (!(await verifyState(ctx, p.state))) throw new Fail('bad-state');
  const t = await tokenCall(ctx, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!t.access_token || !t.expires_in) throw new Fail('exchange-failed', t.error_description || t.error || '');
  if (!t.refresh_token) throw new Fail('no-offline');
  const list = await fetchSites(t.access_token);
  const { data: prev } = await ctx.admin.from('jira_credentials').select('cloud_id,projects,start_field,start_field_name').eq('user_id', ctx.uid).maybeSingle();
  // 사이트가 하나면 곧바로 고른다(v1은 사이트 하나 — 스펙 §7). 다시 연결했는데 예전 사이트가
  // 여전히 목록에 있으면 **고른 프로젝트를 그대로 둔다**(해제 후 재연결 때 되살아나게).
  const keep = prev?.cloud_id ? list.find((s) => s.id === prev.cloud_id) : undefined;
  const pick = keep ?? (list.length === 1 ? list[0] : undefined);
  const row = {
    user_id: ctx.uid,
    refresh_token: t.refresh_token,
    access_token: t.access_token,
    access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    version: 0,
    scope: t.scope ?? null,
    cloud_id: pick?.id ?? null,
    site_url: pick?.url ?? null,
    site_name: pick?.name ?? null,
    projects: keep ? (prev?.projects ?? []) : [],
    start_field: keep ? (prev?.start_field ?? null) : null,
    start_field_name: keep ? (prev?.start_field_name ?? null) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await ctx.admin.from('jira_credentials').upsert(row);
  if (error) throw new Fail('save-failed', error.message);
  return { ok: true, sites: list, ...(await statusOf(row as Row)) };
}

// ── 상태 · 사이트 · 프로젝트 ─────────────────────────────────────────────

async function readRow(ctx: Ctx): Promise<Row | null> {
  const { data } = await ctx.admin.from('jira_credentials').select('*').eq('user_id', ctx.uid).maybeSingle();
  return (data as Row | null) ?? null;
}

async function mustRow(ctx: Ctx): Promise<Row> {
  const row = await readRow(ctx);
  if (!row) throw new Fail('no-credentials');
  return row;
}

function statusOf(row: Row) {
  return {
    connected: true,
    site: row.cloud_id ? { id: row.cloud_id, url: row.site_url ?? '', name: row.site_name ?? '' } : null,
    projects: coerceProjects(row.projects),
    startField: row.start_field ? { id: row.start_field, name: row.start_field_name ?? row.start_field } : null,
  };
}

async function status(ctx: Ctx) {
  const row = await readRow(ctx);
  if (!row) return { ok: true, connected: false };
  return { ok: true, ...statusOf(row) };
}

async function sites(ctx: Ctx) {
  const row = await mustRow(ctx);
  const token = await accessTokenFor(ctx, row);
  return { ok: true, sites: await fetchSites(token) };
}

async function selectSite(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  const token = await accessTokenFor(ctx, row);
  const list = await fetchSites(token);
  const site = list.find((s) => s.id === p.cloudId);
  if (!site) throw new Fail('bad-site');
  // 사이트가 바뀌면 프로젝트·시작일 필드는 그 사이트의 것이 아니다 — 비운다.
  const same = row.cloud_id === site.id;
  const patch = {
    cloud_id: site.id,
    site_url: site.url,
    site_name: site.name,
    ...(same ? {} : { projects: [], start_field: null, start_field_name: null }),
    updated_at: new Date().toISOString(),
  };
  await ctx.admin.from('jira_credentials').update(patch).eq('user_id', ctx.uid);
  return { ok: true, ...statusOf({ ...row, ...patch } as Row) };
}

async function projects(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const token = await accessTokenFor(ctx, row);
  const query = typeof p.query === 'string' ? p.query.slice(0, 80) : '';
  const q = new URLSearchParams({ maxResults: '50', orderBy: 'name', ...(query ? { query } : {}) });
  const body = (await jiraGet(token, row.cloud_id, `/rest/api/3/project/search?${q.toString()}`)) as { values?: unknown[] };
  const list = (body.values ?? []).map((v) => {
    const o = v as { key?: unknown; name?: unknown };
    return { key: typeof o.key === 'string' ? o.key : '', name: typeof o.name === 'string' ? o.name : '' };
  });
  return { ok: true, projects: coerceProjects(list) };
}

async function saveProjects(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const list: JiraProjectRef[] = coerceProjects(p.projects);
  // 시작일 필드는 **프로젝트를 고를 때마다** 다시 찾는다 — 연결 뒤에 관리자가 필드를
  // 만들었을 수 있다. 실패해도 저장은 한다(그때 티켓은 기한 하루로 그린다).
  let startField = row.start_field;
  let startName = row.start_field_name;
  try {
    const token = await accessTokenFor(ctx, row);
    const f = pickStartField(await jiraGet(token, row.cloud_id, '/rest/api/3/field'));
    startField = f?.id ?? null;
    startName = f?.name ?? null;
  } catch (e) {
    if (e instanceof Fail && e.reason === 'revoked') throw e;
  }
  const patch = { projects: list, start_field: startField, start_field_name: startName, updated_at: new Date().toISOString() };
  await ctx.admin.from('jira_credentials').update(patch).eq('user_id', ctx.uid);
  return { ok: true, ...statusOf({ ...row, ...patch } as Row) };
}

// ── 조회 ─────────────────────────────────────────────────────────────

async function issues(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const proj = coerceProjects(row.projects).map((x) => x.key);
  if (!proj.length) return { ok: true, epics: [], tickets: [], truncated: false };
  const sf = row.start_field && isCustomField(row.start_field) ? row.start_field : null;
  const from = typeof p.from === 'string' ? p.from : '';
  const to = typeof p.to === 'string' ? p.to : '';
  const jql = ticketsJql(proj, from, to, sf);
  if (!jql) throw new Fail('bad-range');
  const token = await accessTokenFor(ctx, row);

  const tickets: JiraTicket[] = [];
  const epicNames = new Map<string, JiraEpic>();
  let next: string | undefined;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = (await jiraPost(token, row.cloud_id, '/rest/api/3/search/jql', {
      jql,
      fields: ticketFields(sf),
      maxResults: 100,
      ...(next ? { nextPageToken: next } : {}),
    })) as { issues?: unknown[]; nextPageToken?: string; isLast?: boolean };
    for (const it of body.issues ?? []) {
      const t = normalizeTicket(it, sf);
      if (!t) continue;
      tickets.push(t);
      if (!epicNames.has(t.epic)) {
        const e = epicFromParent(it);
        if (e) epicNames.set(t.epic, e);
      }
    }
    next = body.nextPageToken;
    if (!next || body.isLast) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // 에픽의 날짜(타임라인의 에픽 막대) — 50개씩. 실패해도 부모 필드에서 얻은 이름으로 그린다.
  const keys = [...epicNames.keys()];
  for (let i = 0; i < keys.length; i += 50) {
    const q = epicsJql(keys.slice(i, i + 50));
    if (!q) continue;
    try {
      const body = (await jiraPost(token, row.cloud_id, '/rest/api/3/search/jql', { jql: q, fields: epicFields(sf), maxResults: 50 })) as { issues?: unknown[] };
      for (const it of body.issues ?? []) {
        const e = normalizeEpic(it, sf);
        if (e) epicNames.set(e.key, e);
      }
    } catch (e) {
      if (e instanceof Fail && e.reason === 'revoked') throw e;
    }
  }
  return { ok: true, epics: [...epicNames.values()], tickets, truncated };
}

async function users(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const query = typeof p.query === 'string' ? p.query.trim().slice(0, 80) : '';
  if (!query) return { ok: true, users: [] };
  const token = await accessTokenFor(ctx, row);
  const body = await jiraGet(token, row.cloud_id, `/rest/api/3/user/search?${new URLSearchParams({ query, maxResults: '20' }).toString()}`);
  return { ok: true, users: normalizeUsers(body) };
}

// ── 토큰 ─────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(ctx: Ctx, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: ctx.clientId, client_secret: ctx.clientSecret, ...params }),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

/**
 * 쓸 수 있는 액세스 토큰. 1분 넘게 남았으면 그대로, 아니면 갱신한다.
 *
 * refresh token이 **회전**하므로 갱신 결과는 `version`을 조건으로 건 UPDATE로 적는다.
 * 0행이면 다른 요청이 먼저 갱신한 것 — 그쪽이 적은 토큰을 다시 읽어 쓴다(우리가 받은
 * 새 토큰도 유효하지만, 저장된 refresh token과 짝이 맞는 쪽을 쓰는 편이 다음 갱신이 안전하다).
 */
async function accessTokenFor(ctx: Ctx, row: Row): Promise<string> {
  const fresh = (r: Row) => !!r.access_token && !!r.access_expires_at && Date.parse(r.access_expires_at) - Date.now() > 60_000;
  if (fresh(row)) return row.access_token as string;
  const t = await tokenCall(ctx, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  if (!t.access_token || !t.expires_in) {
    // 이미 다른 요청이 이 refresh token을 써 버렸을 수 있다 — 행을 다시 읽어 본다.
    const again = await readRow(ctx);
    if (again && again.version !== row.version && fresh(again)) return again.access_token as string;
    if (t.error === 'invalid_grant' || t.error === 'unauthorized_client') {
      await ctx.admin.from('jira_credentials').delete().eq('user_id', ctx.uid).eq('version', row.version);
      throw new Fail('revoked');
    }
    throw new Fail('refresh-failed', t.error_description || t.error || '');
  }
  const { data } = await ctx.admin
    .from('jira_credentials')
    .update({
      access_token: t.access_token,
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      refresh_token: t.refresh_token ?? row.refresh_token,
      version: row.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ctx.uid)
    .eq('version', row.version)
    .select('user_id');
  if (!data || data.length === 0) {
    const again = await readRow(ctx);
    if (again && fresh(again)) return again.access_token as string;
  }
  return t.access_token;
}

async function fetchSites(token: string): Promise<Site[]> {
  const res = await fetch(RESOURCES_URL, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401) throw new Fail('revoked');
  if (!res.ok) throw new Fail('jira-error', String(res.status));
  const list = (await res.json()) as { id?: string; url?: string; name?: string; scopes?: string[] }[];
  return list
    .filter((s) => typeof s.id === 'string' && (s.scopes ?? []).includes('read:jira-work'))
    .map((s) => ({ id: s.id as string, url: s.url ?? '', name: s.name ?? '' }));
}

async function jiraGet(token: string, cloudId: string, path: string): Promise<unknown> {
  return jiraCall(token, cloudId, path, { method: 'GET' });
}

async function jiraPost(token: string, cloudId: string, path: string, body: unknown): Promise<unknown> {
  return jiraCall(token, cloudId, path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

async function jiraCall(token: string, cloudId: string, path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new Fail('revoked');
  if (res.status === 403) throw new Fail('forbidden');
  if (res.status === 429) throw new Fail('rate-limited', res.headers.get('Retry-After') ?? '');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Fail('jira-error', `${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── state 서명 ───────────────────────────────────────────────────────

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

async function signState(ctx: Ctx, ts: number): Promise<string> {
  return `${ts}.${await hmac(ctx.clientSecret, `${ctx.uid}.${ts}`)}`;
}

async function verifyState(ctx: Ctx, raw: unknown): Promise<boolean> {
  if (typeof raw !== 'string') return false;
  const [tsRaw, sig] = raw.split('.');
  const ts = Number(tsRaw);
  if (!sig || !Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS || ts > Date.now() + 60_000) return false;
  return (await hmac(ctx.clientSecret, `${ctx.uid}.${ts}`)) === sig;
}

/** 받아 줄 리디렉션 — **우리 콜백 경로**(`/auth/jira`)만. 로컬 개발만 http를 허락한다. */
function validRedirect(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    if (u.pathname !== '/auth/jira' || u.search || u.hash) return null;
    return raw;
  } catch {
    return null;
  }
}

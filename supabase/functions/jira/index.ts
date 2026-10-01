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

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  coerceIssueTypes,
  coerceProjects,
  coerceRule,
  dateFields,
  epicFields,
  epicFromParent,
  epicsJql,
  isDate,
  isIssueKey,
  isEndField,
  isProjectKey,
  isReleaseField,
  statusesOf,
  issueTypesOf,
  isStartField,
  normalizeEpic,
  normalizeTicket,
  normalizeUsers,
  overlaps,
  pickStartField,
  ticketFields,
  ticketsJql,
  type JiraEpic,
  type JiraProjectRef,
  type JiraTicket,
} from '../_shared/jira.ts';
import { normalizeChildren, normalizeComments, normalizeDetail } from '../_shared/jiraDetail.ts';
import { accessTokenFor, Fail, fetchSites, jiraGet, jiraPost, readCredential, tokenCall, type AppCtx, type Row } from '../_shared/jiraAuth.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const AUTH_URL = 'https://auth.atlassian.com/authorize';
/** 읽기만 한다 — `offline_access`가 없으면 refresh token이 오지 않아 한 시간마다 끊긴다. */
const SCOPES = ['read:jira-work', 'read:jira-user', 'offline_access'];
/** 인가 요청의 `state`가 유효한 시간 — 동의 화면에서 머뭇거리는 시간을 넉넉히. */
const STATE_TTL_MS = 20 * 60 * 1000;
/** 한 번의 조회가 끌어오는 티켓 상한(100 × 10쪽) — 넘으면 `truncated`로 알린다. */
const MAX_PAGES = 10;

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
      case 'issue-types':
        return json(await issueTypes(ctx, payload));
      case 'issue':
        return json(await issueDetail(ctx, payload));
      case 'statuses':
        return json(await statuses(ctx, payload));
      case 'fields':
        return json(await fields(ctx));
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

interface Ctx extends AppCtx {
  uid: string;
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
  // 설치형 앱에서 시작한 연결이면 `state`에 그 표시(`d.`)를 싣는다 — 동의는 시스템 브라우저에서 끝나므로,
  // 콜백 페이지(`/auth/jira`)가 그 표시를 보고 **브라우저에서 교환하지 않고** 딥링크로 앱을 깨운다(앱이 교환).
  // 표시도 서명 안에 든다 — 브라우저 쪽에서 붙이거나 떼면 교환이 거절된다.
  const state = await signState(ctx, Date.now(), p.desktop === true);
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
  const { data: prev } = await ctx.admin.from('jira_credentials').select('cloud_id,projects,start_field,start_field_name,end_field,end_field_name,fill_dates,issue_types,release_field,release_field_name,issue_statuses').eq('user_id', ctx.uid).maybeSingle();
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
    end_field: keep ? (prev?.end_field ?? null) : null,
    end_field_name: keep ? (prev?.end_field_name ?? null) : null,
    fill_dates: keep ? prev?.fill_dates !== false : true,
    issue_types: keep ? (prev?.issue_types ?? []) : [],
    release_field: keep ? (prev?.release_field ?? null) : null,
    release_field_name: keep ? (prev?.release_field_name ?? null) : null,
    issue_statuses: keep ? (prev?.issue_statuses ?? []) : [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await ctx.admin.from('jira_credentials').upsert(row);
  if (error) throw new Fail('save-failed', error.message);
  return { ok: true, sites: list, ...(await statusOf(row as Row)) };
}

// ── 상태 · 사이트 · 프로젝트 ─────────────────────────────────────────────

async function readRow(ctx: Ctx): Promise<Row | null> {
  return readCredential(ctx.admin, ctx.uid);
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
    endField: row.end_field ? { id: row.end_field, name: row.end_field_name ?? row.end_field } : null,
    fillDates: row.fill_dates !== false,
    issueTypes: coerceIssueTypes(row.issue_types),
    issueStatuses: coerceIssueTypes(row.issue_statuses),
    releaseField: row.release_field ? { id: row.release_field, name: row.release_field_name ?? row.release_field } : null,
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
    ...(same ? {} : { projects: [], start_field: null, start_field_name: null, end_field: null, end_field_name: null, fill_dates: true, issue_types: [], release_field: null, release_field_name: null, issue_statuses: [] }),
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

/**
 * 고른 프로젝트들의 이슈 유형 — 프로젝트 고르기의 `이슈 유형` 칸. 팀 관리 프로젝트는 유형이
 * 프로젝트마다 다른 id라 **그대로 다 돌려주고** 화면이 이름으로 묶는다. 한 프로젝트가 실패해도 나머지는 준다.
 */
async function issueTypes(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const keys = (Array.isArray(p.projects) ? p.projects : []).filter(isProjectKey).slice(0, 30);
  if (!keys.length) return { ok: true, types: [] };
  const token = await accessTokenFor(ctx, row);
  const seen = new Set<string>();
  const types: { id: string; name: string }[] = [];
  await Promise.all(
    keys.map(async (k) => {
      try {
        for (const t of issueTypesOf(await jiraGet(token, row.cloud_id!, `/rest/api/3/project/${encodeURIComponent(k)}`))) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          types.push(t);
        }
      } catch (e) {
        if (e instanceof Fail && e.reason === 'revoked') throw e;
      }
    }),
  );
  return { ok: true, types };
}

/**
 * 고른 프로젝트들의 티켓이 가질 수 있는 **상태** — 프로젝트 고르기의 `상태` 칸. 이슈 유형을 골랐으면
 * 그 유형의 상태만. 팀 관리 프로젝트는 같은 이름이 다른 id라 그대로 다 돌려주고 화면이 이름으로 묶는다.
 */
async function statuses(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const keys = (Array.isArray(p.projects) ? p.projects : []).filter(isProjectKey).slice(0, 30);
  const types = (Array.isArray(p.types) ? p.types : []).filter((t): t is string => typeof t === 'string').slice(0, 100);
  if (!keys.length) return { ok: true, statuses: [] };
  const token = await accessTokenFor(ctx, row);
  const seen = new Set<string>();
  const out: { id: string; name: string; cat?: string }[] = [];
  await Promise.all(
    keys.map(async (k) => {
      try {
        for (const s of statusesOf(await jiraGet(token, row.cloud_id!, `/rest/api/3/project/${encodeURIComponent(k)}/statuses`), types)) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      } catch (e) {
        if (e instanceof Fail && e.reason === 'revoked') throw e;
      }
    }),
  );
  return { ok: true, statuses: out };
}

/** 이 사이트의 커스텀 날짜 필드 + 자동으로 고른 시작일 — 프로젝트 고르기의 날짜 칸. */
async function fields(ctx: Ctx) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const token = await accessTokenFor(ctx, row);
  const all = await jiraGet(token, row.cloud_id, '/rest/api/3/field');
  return { ok: true, fields: dateFields(all), suggested: pickStartField(all) };
}

const fieldName = (v: unknown, id: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : id);

async function saveProjects(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const list: JiraProjectRef[] = coerceProjects(p.projects);
  let patch: Record<string, unknown>;
  const rule = p.rule && typeof p.rule === 'object' ? (p.rule as Record<string, unknown>) : null;
  if (rule) {
    // 사용자가 날짜 칸에서 고른 것 — 모양만 확인한다(이름은 표시용이라 받은 그대로 자른다).
    const start = isStartField(rule.start) ? rule.start : null;
    const end = isEndField(rule.end) && rule.end !== 'duedate' ? rule.end : null;
    patch = {
      projects: list,
      start_field: start,
      start_field_name: start ? fieldName(rule.startName, start) : null,
      end_field: end,
      end_field_name: end ? fieldName(rule.endName, end) : null,
      fill_dates: rule.fill !== false,
    };
    const release = isReleaseField(rule.release) ? rule.release : null;
    patch.release_field = release;
    patch.release_field_name = release ? fieldName(rule.releaseName, release) : null;
    // 이슈 유형도 같은 화면에서 온다 — 빈 목록은 "전부".
    if (Array.isArray(p.issueTypes)) patch.issue_types = coerceIssueTypes(p.issueTypes);
    if (Array.isArray(p.issueStatuses)) patch.issue_statuses = coerceIssueTypes(p.issueStatuses);
  } else {
    // 날짜 칸 없이 저장(예전 화면) — 시작일 필드는 **고를 때마다** 다시 찾는다(연결 뒤에 관리자가
    // 필드를 만들었을 수 있다). 실패해도 저장은 한다(그때 티켓은 기한 하루로 그린다).
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
    patch = { projects: list, start_field: startField, start_field_name: startName };
  }
  patch.updated_at = new Date().toISOString();
  await ctx.admin.from('jira_credentials').update(patch).eq('user_id', ctx.uid);
  return { ok: true, ...statusOf({ ...row, ...patch } as Row) };
}

// ── 조회 ─────────────────────────────────────────────────────────────

async function issues(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const proj = coerceProjects(row.projects).map((x) => x.key);
  if (!proj.length) return { ok: true, epics: [], tickets: [], truncated: false };
  const rule = coerceRule(row.start_field, row.end_field, row.fill_dates, row.release_field);
  const from = typeof p.from === 'string' ? p.from : '';
  const to = typeof p.to === 'string' ? p.to : '';
  // 사용자의 오늘(시간대가 다르다) — 아직 안 끝난 티켓을 어디까지 그릴지.
  const today = isDate(p.today) ? p.today : undefined;
  const jql = ticketsJql(
    proj,
    from,
    to,
    rule,
    coerceIssueTypes(row.issue_types).map((t) => t.id),
    coerceIssueTypes(row.issue_statuses).map((t) => t.id),
  );
  if (!jql) throw new Fail('bad-range');
  const token = await accessTokenFor(ctx, row);

  const tickets: JiraTicket[] = [];
  const epicNames = new Map<string, JiraEpic>();
  let next: string | undefined;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = (await jiraPost(token, row.cloud_id, '/rest/api/3/search/jql', {
      jql,
      fields: ticketFields(rule),
      maxResults: 100,
      ...(next ? { nextPageToken: next } : {}),
    })) as { issues?: unknown[]; nextPageToken?: string; isLast?: boolean };
    for (const it of body.issues ?? []) {
      const t = normalizeTicket(it, rule, today);
      if (!t || !overlaps(t, from, to)) continue;
      tickets.push(t);
      if (!epicNames.has(t.epic)) {
        const e = epicFromParent(it);
        if (e) epicNames.set(t.epic, e.solo ? { ...e, start: t.start, end: t.end } : e);
      }
    }
    next = body.nextPageToken;
    if (!next || body.isLast) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // 에픽의 날짜(타임라인의 에픽 막대) — 50개씩. 실패해도 부모 필드에서 얻은 이름으로 그린다.
  // 티켓 자신인 묶음(solo)은 에픽이 아니다 — 다시 부르지 않는다.
  const keys = [...epicNames.values()].filter((e) => !e.solo).map((e) => e.key);
  for (let i = 0; i < keys.length; i += 50) {
    const q = epicsJql(keys.slice(i, i + 50));
    if (!q) continue;
    try {
      const body = (await jiraPost(token, row.cloud_id, '/rest/api/3/search/jql', { jql: q, fields: epicFields(rule), maxResults: 50 })) as { issues?: unknown[] };
      for (const it of body.issues ?? []) {
        const e = normalizeEpic(it, rule);
        if (e) epicNames.set(e.key, e);
      }
    } catch (e) {
      if (e instanceof Fail && e.reason === 'revoked') throw e;
    }
  }
  return { ok: true, epics: [...epicNames.values()], tickets, truncated };
}

/**
 * 티켓 하나의 **상세**(작업 현황의 상세 팝업) — 이슈 + 최근 댓글 셋 + (에픽이면) 하위 티켓.
 * 저장하지 않는다(열 때마다 묻는다). 키는 모양만 확인한다 — 읽는 권한은 그 사람의 토큰이 정한다
 * (상위 에픽이 다른 프로젝트에 있을 수 있어 고른 프로젝트로 묶지 않는다).
 */
async function issueDetail(ctx: Ctx, p: Record<string, unknown>) {
  const row = await mustRow(ctx);
  if (!row.cloud_id) throw new Fail('no-site');
  const key = typeof p.key === 'string' ? p.key.trim().toUpperCase() : '';
  if (!isIssueKey(key)) throw new Fail('bad-request');
  const rule = coerceRule(row.start_field, row.end_field, row.fill_dates, row.release_field);
  const token = await accessTokenFor(ctx, row);
  const raw = await jiraGet(token, row.cloud_id, `/rest/api/3/issue/${encodeURIComponent(key)}?expand=names,schema&fields=*all`);
  const detail = normalizeDetail(raw, rule);
  if (!detail) throw new Fail('jira-error', 'bad issue');
  const tasks: Promise<void>[] = [];
  tasks.push(
    jiraGet(token, row.cloud_id, `/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=3`)
      .then((b) => {
        const c = normalizeComments(b);
        detail.commentTotal = c.total;
        detail.comments = c.comments;
      })
      .catch((e) => {
        if (e instanceof Fail && e.reason === 'revoked') throw e;
      }),
  );
  if (detail.type.epic) {
    const fields = ['summary', 'status', 'assignee', rule.end, ...(rule.start ? [rule.start] : [])];
    tasks.push(
      jiraPost(token, row.cloud_id, '/rest/api/3/search/jql', { jql: `parent = ${key} ORDER BY created ASC`, fields, maxResults: 100 })
        .then((b) => {
          detail.children = normalizeChildren((b as { issues?: unknown[] }).issues, rule);
        })
        .catch((e) => {
          if (e instanceof Fail && e.reason === 'revoked') throw e;
          detail.children = [];
        }),
    );
  }
  await Promise.all(tasks);
  return { ok: true, issue: detail };
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

// ── state 서명 ───────────────────────────────────────────────────────

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

async function signState(ctx: Ctx, ts: number, desktop = false): Promise<string> {
  return desktop ? `d.${ts}.${await hmac(ctx.clientSecret, `${ctx.uid}.${ts}.d`)}` : `${ts}.${await hmac(ctx.clientSecret, `${ctx.uid}.${ts}`)}`;
}

/** 웹 `ts.sig` / 설치형 앱 `d.ts.sig` — 둘 다 이 사용자·시각에 묶인 서명이어야 한다. */
async function verifyState(ctx: Ctx, raw: unknown): Promise<boolean> {
  if (typeof raw !== 'string') return false;
  const parts = raw.split('.');
  const desktop = parts[0] === 'd';
  const [tsRaw, sig] = desktop ? [parts[1], parts[2]] : [parts[0], parts[1]];
  if (parts.length !== (desktop ? 3 : 2)) return false;
  const ts = Number(tsRaw);
  if (!sig || !Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS || ts > Date.now() + 60_000) return false;
  return (await hmac(ctx.clientSecret, desktop ? `${ctx.uid}.${ts}.d` : `${ctx.uid}.${ts}`)) === sig;
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

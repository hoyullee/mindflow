// Jira 개인정보 보고 — Atlassian **Personal Data Reporting API**에 우리가 들고 있는 accountId를 알리고,
// 닫힌 계정은 지우고 바뀐 계정은 이름을 새로 받는다(`backend/26-jira.md` §개인정보 보고).
//
// ── 왜 필요한가 ───────────────────────────────────────────────────────
// 앱을 Sharing으로 배포하면서 "개인정보를 저장한다: Yes"로 선언했다 — 작업 현황에서 직접 더한 담당자
// (`user_tool_prefs.work.extra`)와 끈 담당자(`work.hidden`)의 accountId·이름이 서버에 남기 때문이다
// (기기를 바꿔도 따라오게 — 결정 2026-09-30). 그 선언의 대가가 **주기 보고**다(기본 주기 7일).
//
// ── 누가 부르나 ───────────────────────────────────────────────────────
// pg_cron이 주 2회(월·목) 부른다 — 7일 주기에 한 번 실패해도 다음 회차가 주기 안에 든다. cron에는
// 사용자 JWT가 없어 `verify_jwt = false`이고, 멘션 메일(`notify-digest`)과 같은 `DIGEST_SECRET` 헤더로
// 잠근다(그 비밀의 힘은 "보고를 한 번 돌린다"가 전부다 — 새 비밀을 하나 더 늘리지 않았다).
//
// ── 어느 토큰으로 ─────────────────────────────────────────────────────
// 3LO 앱의 보고는 **사용자의 액세스 토큰**으로 한다. 연결된 사용자 아무나의 토큰을 쓴다 — 그래서
// 연결을 해제한 사람의 설정에 남은 목록도 함께 보고된다(재연결 때 목록이 되살아나는 이유). 연결된
// 사람이 **한 명도 없으면** 보고할 수 없다 — 그때는 로그만 남기고 끝낸다(그 상태로 오래 두지 않는다).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { accessTokenFor, Fail, readCredential, type AppCtx, type Row } from '../_shared/jiraAuth.ts';
import { applyReport, chunks, collectAccounts, parseReport, reportBody, type PrefsRow } from '../_shared/jiraPrivacy.ts';

const REPORT_URL = 'https://api.atlassian.com/app/report-accounts/';
const PAGE = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = Deno.env.get('DIGEST_SECRET') ?? '';
  if (!secret) return json({ error: 'server not configured' }, 500);
  if (!safeEqual(req.headers.get('x-digest-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('ATLASSIAN_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('ATLASSIAN_CLIENT_SECRET') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server not configured' }, 500);
  if (!clientId || !clientSecret) return json({ ok: false, reason: 'not-configured' });
  const admin = createClient(supabaseUrl, serviceKey);
  const ctx: AppCtx = { admin, clientId, clientSecret };

  try {
    return json(await run(ctx));
  } catch (e) {
    console.error('[jira-privacy]', e);
    return json({ ok: false, reason: e instanceof Fail ? e.reason : 'server-error' }, 500);
  }
});

async function readAllPrefs(ctx: AppCtx): Promise<PrefsRow[]> {
  const out: PrefsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.admin.from('user_tool_prefs').select('owner,data,updated_at').range(from, from + PAGE - 1);
    if (error) throw new Fail('read-failed', error.message);
    out.push(...((data ?? []) as PrefsRow[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** 보고에 쓸 토큰 — 연결된 사람을 차례로 시도한다(끊긴 토큰은 건너뛴다). */
async function* tokens(ctx: AppCtx): AsyncGenerator<{ token: string; row: Row }> {
  const { data } = await ctx.admin.from('jira_credentials').select('user_id').order('updated_at', { ascending: false }).limit(50);
  for (const r of (data ?? []) as { user_id: string }[]) {
    const row = await readCredential(ctx.admin, r.user_id);
    if (!row) continue;
    try {
      yield { token: await accessTokenFor(ctx, row), row };
    } catch (e) {
      console.warn('[jira-privacy] 토큰을 못 얻었다 — 다음 사람으로', r.user_id, e instanceof Fail ? e.reason : e);
    }
  }
}

async function run(ctx: AppCtx) {
  const prefs = await readAllPrefs(ctx);
  const accounts = [...collectAccounts(prefs)];
  if (!accounts.length) return { ok: true, reported: 0, closed: 0, updated: 0 };

  const closed = new Set<string>();
  const updatedIds = new Set<string>();
  let reported = 0;
  let cycle: string | null = null;
  const it = tokens(ctx);
  let cur = await it.next();
  if (cur.done) {
    console.warn('[jira-privacy] 연결된 Jira 사용자가 없어 보고하지 못했다 — 계정', accounts.length);
    return { ok: false, reason: 'no-token', pending: accounts.length };
  }

  for (const batch of chunks(accounts)) {
    for (;;) {
      if (cur.done) return { ok: false, reason: 'no-token', reported, pending: accounts.length - reported };
      const res = await fetch(REPORT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cur.value.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(reportBody(batch)),
      });
      cycle = res.headers.get('Cycle-Period') ?? cycle;
      if (res.status === 401 || res.status === 403) {
        cur = await it.next(); // 이 토큰으로는 안 된다 — 다음 사람의 토큰으로 같은 묶음을 다시
        continue;
      }
      if (res.status === 429) {
        // 한도 — 남은 묶음은 다음 회차(주 2회라 7일 주기 안에 다시 온다).
        console.warn('[jira-privacy] 429 — Retry-After', res.headers.get('Retry-After'));
        return await finish(ctx, prefs, closed, updatedIds, cur.value, { reported, pending: accounts.length - reported, cycle, limited: true });
      }
      if (res.status === 204) break;
      if (!res.ok) throw new Fail('report-failed', `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const r = parseReport(await res.json().catch(() => ({})));
      r.closed.forEach((id) => closed.add(id));
      r.updated.forEach((id) => updatedIds.add(id));
      break;
    }
    reported += batch.length;
  }
  return await finish(ctx, prefs, closed, updatedIds, cur.done ? null : cur.value, { reported, pending: 0, cycle, limited: false });
}

/** 결과를 반영한다 — 닫힌 계정은 지우고, 바뀐 계정은 Jira에서 이름을 새로 받는다. */
async function finish(ctx: AppCtx, prefs: PrefsRow[], closed: Set<string>, updatedIds: Set<string>, auth: { token: string; row: Row } | null, meta: Record<string, unknown>) {
  const renamed = new Map<string, string>();
  // 이름은 **그 담당자를 더한 사람의 사이트**에서 찾는다 — 담당자는 그 사람 조직의 Jira에 있다(보고에 쓴
  // 토큰의 사이트에는 없을 수 있다). 그 사람이 연결을 해제했으면 보고에 쓴 토큰으로 한 번 더 시도한다.
  // 못 받으면 그대로 둔다 — 다음 회차에 다시 `updated`로 온다(멀쩡한 이름을 "이름 없음"으로 덮지 않는다).
  const owners = new Map<string, string[]>();
  for (const p of prefs) {
    const extra = (p.data as { work?: { extra?: { id?: unknown }[] } } | null)?.work?.extra;
    if (!Array.isArray(extra)) continue;
    for (const e of extra) if (typeof e?.id === 'string' && updatedIds.has(e.id)) owners.set(e.id, [...(owners.get(e.id) ?? []), p.owner]);
  }
  const tokenCache = new Map<string, { token: string; cloud: string } | null>();
  const authOf = async (uid: string) => {
    if (tokenCache.has(uid)) return tokenCache.get(uid) ?? null;
    let v: { token: string; cloud: string } | null = null;
    try {
      const row = await readCredential(ctx.admin, uid);
      if (row?.cloud_id) v = { token: await accessTokenFor(ctx, row), cloud: row.cloud_id };
    } catch {
      v = null;
    }
    tokenCache.set(uid, v);
    return v;
  };
  for (const id of updatedIds) {
    if (closed.has(id)) continue;
    const tries: { token: string; cloud: string }[] = [];
    for (const uid of owners.get(id) ?? []) {
      const a = await authOf(uid);
      if (a) tries.push(a);
    }
    if (auth?.row.cloud_id) tries.push({ token: auth.token, cloud: auth.row.cloud_id });
    for (const t of tries) {
      try {
        const res = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(t.cloud)}/rest/api/3/user?accountId=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const u = (await res.json()) as { displayName?: unknown };
        if (typeof u.displayName === 'string' && u.displayName) {
          renamed.set(id, u.displayName.slice(0, 80));
          break;
        }
      } catch {
        /* 다음 후보로 */
      }
    }
  }
  const now = new Date().toISOString();
  let rows = 0;
  if (closed.size || renamed.size) {
    for (const p of prefs) {
      const next = applyReport(p.data, closed, renamed, now);
      if (!next) continue;
      const { error } = await ctx.admin.from('user_tool_prefs').update({ data: next }).eq('owner', p.owner);
      if (error) console.error('[jira-privacy] 반영 실패', p.owner, error.message);
      else rows++;
    }
  }
  const summary = { ok: true, ...meta, closed: closed.size, updated: updatedIds.size, renamed: renamed.size, rows };
  console.log('[jira-privacy]', JSON.stringify(summary));
  return summary;
}

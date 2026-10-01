// Jira 자격 증명과 호출의 **공용 부분** — `jira`(사용자 요청)와 `jira-privacy`(예약 보고)가 함께 쓴다.
//
// 토큰 갱신이 한 곳에 있어야 하는 이유: Atlassian의 refresh token은 **회전**한다. 두 함수가 각자
// 갱신 코드를 들면 한쪽이 낙관적 잠금(`version`)을 빠뜨리는 순간 다른 쪽의 토큰이 폐기된다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
export const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

export interface Row {
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
  /** 0045 — null이면 기한(`duedate`). */
  end_field?: string | null;
  end_field_name?: string | null;
  fill_dates?: boolean | null;
  issue_types?: unknown;
  /** 0046 — 배포 예정일 필드(표시만). */
  release_field?: string | null;
  release_field_name?: string | null;
  /** 0047 — 고른 상태(비면 전부). */
  issue_statuses?: unknown;
}

export interface Site {
  id: string;
  url: string;
  name: string;
}

export class Fail extends Error {
  constructor(readonly reason: string, readonly detail = '') {
    super(reason);
  }
}

/** 앱 단위 문맥 — service role 클라이언트 + 앱 자격 증명(사용자는 행이 말한다). */
export interface AppCtx {
  admin: SupabaseClient;
  clientId: string;
  clientSecret: string;
}

export async function readCredential(admin: SupabaseClient, uid: string): Promise<Row | null> {
  const { data } = await admin.from('jira_credentials').select('*').eq('user_id', uid).maybeSingle();
  return (data as Row | null) ?? null;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function tokenCall(ctx: AppCtx, params: Record<string, string>): Promise<TokenResponse> {
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
export async function accessTokenFor(ctx: AppCtx, row: Row): Promise<string> {
  const fresh = (r: Row) => !!r.access_token && !!r.access_expires_at && Date.parse(r.access_expires_at) - Date.now() > 60_000;
  if (fresh(row)) return row.access_token as string;
  const t = await tokenCall(ctx, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  if (!t.access_token || !t.expires_in) {
    // 이미 다른 요청이 이 refresh token을 써 버렸을 수 있다 — 행을 다시 읽어 본다.
    const again = await readCredential(ctx.admin, row.user_id);
    if (again && again.version !== row.version && fresh(again)) return again.access_token as string;
    if (t.error === 'invalid_grant' || t.error === 'unauthorized_client') {
      await ctx.admin.from('jira_credentials').delete().eq('user_id', row.user_id).eq('version', row.version);
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
    .eq('user_id', row.user_id)
    .eq('version', row.version)
    .select('user_id');
  if (!data || data.length === 0) {
    const again = await readCredential(ctx.admin, row.user_id);
    if (again && fresh(again)) return again.access_token as string;
  }
  return t.access_token;
}

export async function fetchSites(token: string): Promise<Site[]> {
  const res = await fetch(RESOURCES_URL, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401) throw new Fail('revoked');
  if (!res.ok) throw new Fail('jira-error', String(res.status));
  const list = (await res.json()) as { id?: string; url?: string; name?: string; scopes?: string[] }[];
  return list
    .filter((s) => typeof s.id === 'string' && (s.scopes ?? []).includes('read:jira-work'))
    .map((s) => ({ id: s.id as string, url: s.url ?? '', name: s.name ?? '' }));
}

export async function jiraGet(token: string, cloudId: string, path: string): Promise<unknown> {
  return jiraCall(token, cloudId, path, { method: 'GET' });
}

export async function jiraPost(token: string, cloudId: string, path: string, body: unknown): Promise<unknown> {
  return jiraCall(token, cloudId, path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

export async function jiraCall(token: string, cloudId: string, path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) throw new Fail('revoked');
  if (res.status === 403) throw new Fail('forbidden');
  if (res.status === 429) throw new Fail('rate-limited', res.headers.get('Retry-After') ?? '');
  if (res.status === 404) throw new Fail('not-found');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Fail('jira-error', `${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}


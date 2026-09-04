// 구글 캘린더 연결 유지 — **인가 코드를 토큰으로 바꾸고, 이후 조용히 갱신한다.**
//
// ── 왜 Edge Function인가 ────────────────────────────────────────────────
// 코드 교환에는 **client secret**이 필요하다. 브라우저 번들에 넣으면 누구나 우리
// 앱 이름으로 토큰을 발급받을 수 있으므로, secret을 쥔 쪽은 이 함수뿐이다.
// 그리고 교환의 결과인 **refresh token은 클라이언트로 돌려주지 않는다** — 그 값은
// 만료가 없어서, 브라우저에 한 번 닿으면 한 시간짜리 액세스 토큰과는 비교가 안 되는
// 유출 표면이 된다. 브라우저가 받는 것은 언제나 **한 시간짜리 액세스 토큰**뿐이다.
//
// ── 클라이언트를 믿지 않는다 ────────────────────────────────────────────
// 세 동작 모두 **호출자의 JWT로 누구인지 먼저 확인하고**, 그 사람의 행만 만진다.
// 남의 refresh token을 쓰는 경로는 없다(요청 본문에 사용자 id를 받지 않는다).
//
// ── 설정이 없으면 조용히 물러난다 ───────────────────────────────────────
// `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` 시크릿이 없으면 200으로
// `{ ok: false, reason: 'not-configured' }`를 돌려준다. 그러면 클라이언트는 예전
// 흐름(브라우저 토큰 + 한 시간 뒤 "다시 연결")으로 그대로 굴러간다 — 함수·시크릿
// 배포 순서와 무관하게 앱이 깨지지 않는다.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** 구글 토큰 엔드포인트 호출 — 본문은 폼 인코딩이다(JSON이 아니다). */
async function googleToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return (await res.json()) as GoogleTokenResponse;
}

/** 액세스 토큰으로 그 계정의 이메일을 알아낸다(실패해도 흐름을 막지 않는다). */
async function googleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: unknown };
    return typeof body.email === 'string' ? body.email : null;
  } catch {
    return null;
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

  let payload: { action?: unknown; code?: unknown };
  try {
    payload = (await req.json()) as { action?: unknown; code?: unknown };
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (action !== 'exchange' && action !== 'refresh' && action !== 'disconnect') return json({ error: 'bad request' }, 400);

  // 호출자가 누구인가 — 사용자의 JWT로 확인한다(service role로는 알 수 없다).
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const uid = userData?.user?.id ?? '';
  if (!uid) return json({ error: 'unauthorized' }, 401);

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  // 시크릿이 없으면 아무것도 하지 않는다 — 클라이언트가 예전 흐름으로 돌아간다.
  if (!clientId || !clientSecret) return json({ ok: false, reason: 'not-configured' });

  const admin = createClient(supabaseUrl, serviceKey);

  if (action === 'exchange') {
    const code = typeof payload.code === 'string' ? payload.code : '';
    if (!code) return json({ error: 'bad request' }, 400);
    // `redirect_uri: 'postmessage'`는 GIS 팝업 코드 흐름의 약속된 값이다(진짜
    // 리다이렉트가 없으므로 이 자리에 넣는다).
    const t = await googleToken({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    });
    if (!t.access_token || !t.expires_in) {
      return json({ ok: false, reason: 'exchange-failed', detail: t.error_description || t.error || '' }, 200);
    }
    // refresh token은 **처음 승인 때만** 온다(이미 승인한 계정을 다시 연결하면
    // 빠질 수 있다). 그때는 이미 갖고 있는 행을 그대로 두고 스코프만 갱신한다 —
    // 지우면 조용한 갱신이 통째로 죽는다.
    const email = await googleEmail(t.access_token);
    if (t.refresh_token) {
      await admin.from('google_credentials').upsert({
        user_id: uid,
        refresh_token: t.refresh_token,
        scope: t.scope ?? null,
        google_email: email,
        updated_at: new Date().toISOString(),
      });
    } else {
      await admin
        .from('google_credentials')
        .update({ scope: t.scope ?? null, google_email: email, updated_at: new Date().toISOString() })
        .eq('user_id', uid);
    }
    const { data: row } = await admin.from('google_credentials').select('user_id').eq('user_id', uid).maybeSingle();
    return json({
      ok: true,
      accessToken: t.access_token,
      expiresIn: t.expires_in,
      scope: t.scope ?? '',
      email,
      // 저장된 refresh token이 없으면(첫 승인이 아닌데 처음 연결한 기기 등) 이후
      // 조용한 갱신이 불가능하다 — 클라이언트가 그 사실을 알아야 한다.
      persistent: !!row,
    });
  }

  const { data: cred } = await admin
    .from('google_credentials')
    .select('refresh_token,scope,google_email')
    .eq('user_id', uid)
    .maybeSingle();

  if (action === 'disconnect') {
    // 이 기기만이 아니라 **구글 쪽 승인까지** 취소한다 — 남겨 두면 우리 서버가
    // 계속 액세스 토큰을 발급할 수 있는 상태가 된다.
    if (cred?.refresh_token) {
      try {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(cred.refresh_token)}`, { method: 'POST' });
      } catch {
        /* 구글에 못 닿아도 아래에서 우리 쪽 자격 증명은 지운다 */
      }
    }
    await admin.from('google_credentials').delete().eq('user_id', uid);
    return json({ ok: true });
  }

  // action === 'refresh'
  if (!cred?.refresh_token) return json({ ok: false, reason: 'no-credentials' });
  const t = await googleToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: cred.refresh_token,
    grant_type: 'refresh_token',
  });
  if (!t.access_token || !t.expires_in) {
    // `invalid_grant`은 사용자가 구글 계정에서 권한을 뺐거나 토큰이 폐기된 것 —
    // 그 자격 증명은 이제 쓸모가 없으므로 지우고 "다시 연결"을 요청한다.
    if (t.error === 'invalid_grant') {
      await admin.from('google_credentials').delete().eq('user_id', uid);
      return json({ ok: false, reason: 'revoked' });
    }
    return json({ ok: false, reason: 'refresh-failed', detail: t.error_description || t.error || '' });
  }
  return json({
    ok: true,
    accessToken: t.access_token,
    expiresIn: t.expires_in,
    // 갱신 응답에는 scope가 빠질 수 있다 — 그때는 저장해 둔 값이 곧 승인 범위다.
    scope: t.scope ?? cred.scope ?? '',
    email: cred.google_email ?? null,
    persistent: true,
  });
});

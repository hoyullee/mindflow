// 초대 알림 ②: 맵을 공유하면 **상대에게 메일**을 보낸다.
//
// ①(앱 안 배지, 0019)만으로는 이미 앱을 열어 본 사람에게만 닿는다. 처음 초대받는
// 사람 — 아직 가입도 안 했을 수 있다 — 에게는 앱 밖에서 닿아야 한다.
//
// ── 왜 Edge Function인가 ────────────────────────────────────────────────
// 메일 서비스의 API 키는 **서버에만** 있어야 한다. 클라이언트 번들에 넣으면 누구나
// 우리 도메인 이름으로 메일을 보낼 수 있다(피싱). 그래서 키를 쥔 쪽은 이 함수뿐이고,
// 클라이언트는 "이 문서를 이 사람에게 초대했다"고 알리기만 한다.
//
// ── 클라이언트를 믿지 않는다 ────────────────────────────────────────────
// 요청자가 진짜 그 문서의 **소유자**인지, 그리고 그 초대가 실제로 `document_shares`에
// **존재하는지**를 서버에서 다시 확인한다. 이게 없으면 로그인한 아무나 이 함수를 불러
// 임의의 주소로 "당신이 초대됐다"는 메일을 우리 이름으로 보낼 수 있다.
//
// ── 설정이 없으면 조용히 건너뛴다 ───────────────────────────────────────
// `RESEND_API_KEY` 시크릿이 없으면 `{ sent: false, reason: 'not-configured' }`를
// 200으로 돌려준다. 가입·도메인 인증 전까지 앱은 지금과 똑같이 동작하고, 키를 넣는
// 순간부터 메일이 나간다(호출부는 결과를 무시한다 — 알림은 공유의 부수 효과다).

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface InvitePayload {
  documentId?: unknown;
  email?: unknown;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** 메일 본문에 들어가는 사용자 입력(맵 제목·초대한 사람 이름)은 반드시 이스케이프한다. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!documentId || !email) return json({ error: 'bad request' }, 400);

  // ① 호출자가 누구인가 — 사용자의 JWT로 확인한다(service role로는 알 수 없다).
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const uid = userData?.user?.id ?? '';
  if (!uid) return json({ error: 'unauthorized' }, 401);

  // ② 그 문서의 소유자가 맞는지 + 그 초대가 실제로 있는지(= 방금 만든 초대인지)를
  //    **서버에서** 확인한다. 둘 중 하나라도 아니면 메일을 보내지 않는다.
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: doc } = await admin.from('documents').select('id,title,owner').eq('id', documentId).maybeSingle();
  if (!doc || doc.owner !== uid) return json({ error: 'forbidden' }, 403);
  const { data: share } = await admin
    .from('document_shares')
    .select('invitee_email,role')
    .eq('document_id', documentId)
    .eq('invitee_email', email)
    .maybeSingle();
  if (!share) return json({ error: 'no such invite' }, 404);

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  // 설정 전에는 조용히 건너뛴다 — 배포 순서와 무관하게 공유 자체는 늘 성공해야 한다.
  if (!apiKey) return json({ sent: false, reason: 'not-configured' });

  // 초대한 사람의 이름 — 앱의 프로필명 규칙과 같은 순서(표시명 → OAuth 이름 → 이메일
  // 로컬파트). 상대에게 "누가 초대했는가"는 메일의 핵심 정보다.
  const { data: profile } = await admin.from('profiles').select('display_name').eq('id', uid).maybeSingle();
  const meta = (userData?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const inviterEmail = userData?.user?.email ?? '';
  const inviter =
    (typeof profile?.display_name === 'string' && profile.display_name.trim()) ||
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    inviterEmail.split('@')[0] ||
    '누군가';

  const title = (typeof doc.title === 'string' && doc.title.trim()) || '제목 없는 맵';
  const appUrl = Deno.env.get('APP_URL') ?? 'https://geurio.com';
  const link = `${appUrl}/editor?map=${encodeURIComponent(documentId)}`;
  const canEdit = share.role !== 'view';
  const from = Deno.env.get('INVITE_FROM') ?? 'Geurio <noreply@geurio.com>';

  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:24px;background:#faf6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#33281f">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee2d9;border-radius:16px;padding:28px">
    <div style="font-size:13px;color:#9c8b7e;margin-bottom:6px">Geurio</div>
    <div style="font-size:19px;font-weight:800;line-height:1.45;margin-bottom:14px">${esc(inviter)}님이 마인드맵에 초대했어요</div>
    <div style="font-size:14.5px;line-height:1.7;color:#5c4f44;margin-bottom:22px">
      <strong style="color:#33281f">${esc(title)}</strong> 맵을 ${canEdit ? '함께 편집할 수 있어요' : '열람할 수 있어요'}.
    </div>
    <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;border-radius:11px;background:#f0663f;color:#fff;font-size:14.5px;font-weight:700;text-decoration:none">맵 열기</a>
    <div style="font-size:12px;line-height:1.7;color:#9c8b7e;margin-top:22px">
      이 메일을 예상하지 못했다면 무시하셔도 됩니다 — 링크를 열려면 <strong>${esc(email)}</strong>로 로그인해야 해요.
    </div>
  </div>
</body></html>`;

  const text = `${inviter}님이 마인드맵 "${title}" 에 초대했어요.\n${canEdit ? '함께 편집할 수 있어요.' : '열람할 수 있어요.'}\n\n맵 열기: ${link}\n\n이 메일을 예상하지 못했다면 무시하셔도 됩니다 — 링크를 열려면 ${email}로 로그인해야 해요.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: `${inviter}님이 "${title}" 맵에 초대했어요`, html, text }),
  });
  if (!res.ok) {
    // 메일 실패가 공유를 되돌리지는 않는다 — 이미 초대는 걸려 있고, 앱 안 배지(①)가
    // 그 사실을 알린다. 원인만 남기고 200으로 답한다(호출부는 결과를 무시한다).
    console.error('[share-invite] resend failed', res.status, await res.text());
    return json({ sent: false, reason: 'send-failed' });
  }
  return json({ sent: true });
});

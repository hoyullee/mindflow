// 멘션 **메일** 다이제스트 — 30분마다 한 번, 읽지 않은 멘션만, 수신자당 한 통.
//
// ## 왜 이 함수가 있나 (사용자의 물음에서 나왔다)
//
// "멘션할 때마다 메일을 보내면 비용 부담이 있지 않나." 실제 제약은 요금이 아니라
// **무료 한도의 성격**이다 — Resend 무료는 하루 100통이고, 그 통장을 가입 확인·
// 비밀번호 재설정(Supabase Auth SMTP)과 공유 초대(`share-invite`)가 **같이 쓴다**.
// 멘션 메일이 하루치를 먹으면 그날 로그인이 막힌다. 그래서 이 함수는 "보내는 일"보다
// **안 보내는 일**을 더 많이 한다. 규칙 셋의 근거와 SQL은 0039 마이그레이션에 있다.
//
// ## 누가 부르나
//
// `pg_cron`이 30분마다 `pg_net`으로 부른다(설정 SQL은 `backend.md` §15).
// **JWT 검증을 끈 함수**라(`config.toml`) 아무나 주소만 알면 부를 수 있게 되므로,
// `DIGEST_SECRET` 헤더로 문을 잠근다. 그 비밀의 힘은 "다이제스트를 한 번 돌린다"가
// 전부라 service_role 키를 DB(cron 잡)에 두는 것보다 폭발 반경이 훨씬 작다.
//
// ## 설정이 없으면 아무 일도 하지 않는다
//
// `RESEND_API_KEY`가 없으면 `{ sent: 0, reason: 'not-configured' }`를 200으로
// 돌려준다(`share-invite`와 같은 계약) — 마이그레이션이 먼저 적용돼도 앱은 그대로다.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** 갓 생긴 멘션은 다음 회차로 미룬다 — 읽을 틈을 준다(0039 ① 참고). */
const MIN_AGE_MINUTES = 5;
/** 이보다 늙은 멘션은 버린다 — 함수가 멈췄다 되살아날 때 묵은 것이 쏟아지지 않게. */
const MAX_AGE_HOURS = 24;
/** 한 사람이 하루에 받을 다이제스트 상한. */
const PER_USER_DAILY = 5;
/** 이 기능이 하루에 쓸 수 있는 전체 통수 — 나머지는 인증·초대 메일의 자리다. */
const DAILY_CAP = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-digest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** 메일 본문에 들어가는 사용자 입력(맵 제목·부른 사람 이름)은 반드시 이스케이프한다. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 길이가 다른 두 문자열을 **같은 시간에** 견준다.
 *
 * `a === b`는 첫 다른 바이트에서 끝나 응답 시간이 정답의 접두사 길이를 흘린다.
 * 원격에서 재기 어려운 차이지만, 문 하나를 지키는 비교라 굳이 새는 쪽을 쓸 이유가 없다.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface DigestRow {
  recipient: string;
  email: string;
  ids: string[];
  total: number;
  oldest: string;
  actors: string[] | null;
  doc_titles: string[] | null;
}

/** "앨리스" / "앨리스 외 1명" — 이름이 없으면(프로필이 비었으면) 통째로 생략한다. */
function actorPhrase(actors: string[]): string {
  if (!actors.length) return '';
  if (actors.length === 1) return actors[0];
  return `${actors[0]} 외 ${actors.length - 1}명`;
}

function buildEmail(row: DigestRow, appUrl: string): { subject: string; html: string; text: string } {
  const actors = (row.actors ?? []).filter((a) => a);
  const titles = (row.doc_titles ?? []).filter((t) => t);
  const who = actorPhrase(actors);
  // 제목은 **한 건일 때 가장 구체적으로** 짓는다 — 목록에서 열지 말지를 제목만 보고
  // 정하는 일이 대부분이라, 건수만 적힌 제목("2건의 멘션")은 정보가 없다.
  const subject =
    row.total === 1
      ? `${who ? `${who}님이 ` : ''}${titles[0] ? `"${titles[0]}"에서 ` : ''}회원님을 불렀어요`
      : `읽지 않은 멘션 ${row.total}건${who ? ` — ${who}` : ''}`;

  const items = titles.length
    ? titles
        .map(
          (t) =>
            `<li style="margin:0 0 6px"><strong style="color:#33281f">${esc(t)}</strong></li>`,
        )
        .join('')
    : '';

  const link = `${appUrl}/home`;
  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:24px;background:#faf6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#33281f">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee2d9;border-radius:16px;padding:28px">
    <div style="font-size:13px;color:#9c8b7e;margin-bottom:6px">Geurio</div>
    <div style="font-size:19px;font-weight:800;line-height:1.45;margin-bottom:14px">${esc(subject)}</div>
    ${
      items
        ? `<div style="font-size:14.5px;line-height:1.7;color:#5c4f44;margin-bottom:22px"><ul style="margin:0;padding-left:18px">${items}</ul></div>`
        : '<div style="font-size:14.5px;line-height:1.7;color:#5c4f44;margin-bottom:22px">아직 읽지 않은 멘션이 있어요.</div>'
    }
    <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;border-radius:11px;background:#f0663f;color:#fff;font-size:14.5px;font-weight:700;text-decoration:none">확인하러 가기</a>
    <div style="font-size:12px;line-height:1.7;color:#9c8b7e;margin-top:22px">
      이 메일은 <strong>읽지 않은 멘션이 있을 때만</strong> 30분에 한 번 묶어서 보내요.
      받지 않으려면 Geurio에서 <strong>설정 › 알림</strong>을 열고 '멘션 메일'을 꺼 주세요.
    </div>
  </div>
</body></html>`;

  const bullet = titles.map((t) => `· ${t}`).join('\n');
  const text = `${subject}\n\n${bullet || '아직 읽지 않은 멘션이 있어요.'}\n\n확인하러 가기: ${link}\n\n이 메일은 읽지 않은 멘션이 있을 때만 30분에 한 번 묶어서 보냅니다. 받지 않으려면 설정 › 알림에서 '멘션 메일'을 꺼 주세요.`;
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('DIGEST_SECRET') ?? '';
  // 비밀이 **설정되지 않았으면 문을 연 채 두지 않는다** — 열려 있으면 아무나 회차를
  // 돌려 하루 예산을 태울 수 있다(메일이 남에게 가지는 않지만 예산은 사라진다).
  if (!secret) return json({ error: 'server not configured' }, 500);
  if (!safeEqual(req.headers.get('x-digest-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server not configured' }, 500);

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  // 키가 없으면 **아무것도 읽지 않고** 물러난다 — 후보를 조회해 봐야 보낼 수 없고,
  // 여기서 `emailed_at`을 찍어 버리면 키를 넣은 뒤 그 멘션들이 영영 안 나간다.
  if (!apiKey) return json({ sent: 0, reason: 'not-configured' });

  const admin = createClient(supabaseUrl, serviceKey);
  const appUrl = Deno.env.get('APP_URL') ?? 'https://geurio.com';
  const from = Deno.env.get('INVITE_FROM') ?? 'Geurio <noreply@geurio.com>';

  const { data, error } = await admin.rpc('pending_mention_digests', {
    min_age_minutes: MIN_AGE_MINUTES,
    max_age_hours: MAX_AGE_HOURS,
    per_user_daily: PER_USER_DAILY,
    max_recipients: DAILY_CAP,
  });
  if (error) {
    console.error('[notify-digest] pending 조회 실패', error.message);
    return json({ error: 'query failed' }, 500);
  }
  const rows = (data ?? []) as DigestRow[];
  if (!rows.length) return json({ sent: 0, candidates: 0 });

  let sent = 0;
  let skippedBudget = 0;
  let failed = 0;

  for (const row of rows) {
    // 예산은 **한 통씩** 떼어 온다 — 묶어서 떼면 발송에 실패한 몫이 그대로 사라져
    // (환불 경로가 따로 필요해진다) 오늘의 남은 통수가 실제보다 적어진다.
    const { data: granted, error: budgetError } = await admin.rpc('claim_email_budget', { want: 1, cap: DAILY_CAP });
    if (budgetError) {
      console.error('[notify-digest] 예산 청구 실패', budgetError.message);
      break;
    }
    if (!granted) {
      // 오늘 몫을 다 썼다 — 남은 사람은 `emailed_at`을 찍지 않으므로 **내일 간다**.
      skippedBudget = rows.length - sent - failed;
      break;
    }

    const { subject, html, text } = buildEmail(row, appUrl);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [row.email], subject, html, text }),
    });
    if (!res.ok) {
      // 실패하면 **찍지 않는다** — 다음 회차에 다시 후보가 된다. 예산 한 통은 이미
      // 나갔지만, 그건 "실패를 무한 재시도로 증폭하지 않는" 값싼 브레이크이기도 하다.
      failed += 1;
      console.error('[notify-digest] resend 실패', res.status, await res.text());
      continue;
    }

    const { error: stampError } = await admin
      .from('notifications')
      .update({ emailed_at: new Date().toISOString() })
      .in('id', row.ids);
    if (stampError) {
      // 여기서 실패하면 같은 멘션이 다음 회차에 **또** 나간다 — 드물지만 실제로
      // 일어나면 사용자가 먼저 알아채므로 로그에 수신자를 남겨 추적할 수 있게 한다.
      console.error('[notify-digest] emailed_at 기록 실패', row.recipient, stampError.message);
    }
    sent += 1;
  }

  return json({ sent, candidates: rows.length, failed, skippedBudget });
});

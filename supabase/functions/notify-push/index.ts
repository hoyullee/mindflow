// 멘션 **웹 푸시** — 1분마다, 읽지 않은 멘션만, 수신자별 한 번.
//
// ## 메일(`notify-digest`)과 무엇이 다른가
//
// 메일은 "앱 밖에 있는 사람에게 닿는 것"이라 30분에 한 통으로 묶고 하루 상한을 둔다
// (Resend 무료 한도를 인증·초대 메일과 나눠 쓰기 때문이다 — 0039). 푸시는 성격이
// 다르다: **이미 이 앱을 쓰는 사람을 지금 불러오는 것**이고 **통당 비용이 0**이라
// 조일 이유가 없다. 그래서 유예도 상한도 없고, 남는 규칙은 하나 —
// **읽지 않았을 때만**.
//
// ## 왜 트리거가 아니라 cron인가
//
// 알림 insert 트리거에서 `pg_net`으로 바로 쏘면 지연이 0이다. 그런데 이 저장소에는
// **알림 트리거가 문서 저장을 통째로 굴린 사고**가 이미 있다(0024 — 멘션이 든 저장만
// 실패했다). 1분 cron은 그 위험이 구조적으로 0이고(저장 경로를 건드리지 않는다)
// 대가는 최대 1분의 지연뿐이다.
//
// ## 설정이 없으면 아무 일도 하지 않는다
//
// `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`가 없으면 후보를 **읽지도 않고** 물러난다
// (읽어서 `pushed_at`을 찍으면 키를 넣은 뒤 그 멘션들이 영영 안 나간다 —
// `notify-digest`와 같은 규칙).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

/** 이보다 늙은 멘션은 푸시하지 않는다 — "한 시간 전 일"을 지금 띄우는 것은 소음이다. */
const MAX_AGE_MINUTES = 60;
/** 한 기기가 들고 있을 구독 상한(오래된 것부터 버린다 — 표에서 최신 10개만 싣는다). */
const MAX_SUBS_PER_USER = 10;
/** 이 값을 넘게 연속 실패한 구독은 지운다 — 죽은 엔드포인트에 영원히 쏘지 않는다. */
const FAIL_LIMIT = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-digest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** 길이가 다른 두 문자열을 같은 시간에 견준다(`notify-digest`와 같은 이유). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface PushRow {
  recipient: string;
  ids: string[];
  total: number;
  actors: string[] | null;
  doc_titles: string[] | null;
  document_id: string | null;
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
}

/** "앨리스" / "앨리스 외 1명" — 이름이 비었으면 통째로 생략한다. */
function actorPhrase(actors: string[]): string {
  if (!actors.length) return '';
  if (actors.length === 1) return actors[0];
  return `${actors[0]} 외 ${actors.length - 1}명`;
}

/**
 * 푸시에 실을 내용. **알림 배너 한 줄에 다 보여야** 하므로 메일보다 짧다.
 *
 * 누가·어디서가 핵심이다 — 본문 미리보기는 싣지 않는다(잠금 화면에 남의 문장이
 * 그대로 뜨는 것이 이 앱에서 기대되는 동작이 아니고, `notifications.preview`는
 * 댓글 본문이라 더 그렇다).
 */
export function buildPushPayload(row: PushRow, appUrl: string): { title: string; body: string; url: string; tag: string } {
  const actors = (row.actors ?? []).filter((a) => a);
  const titles = (row.doc_titles ?? []).filter((t) => t);
  const who = actorPhrase(actors);
  const title = row.total === 1 ? `${who || '누군가'}님이 회원님을 불렀어요` : `읽지 않은 멘션 ${row.total}건`;
  const body = titles.length === 1 ? titles[0] : titles.length > 1 ? `${titles[0]} 외 ${titles.length - 1}곳` : 'Geurio에서 확인해 주세요';
  // 문서가 하나로 좁혀졌을 때만 그 문서로 간다(그렇지 않으면 홈이 맞다).
  const url = row.document_id ? `${appUrl}/editor?map=${encodeURIComponent(row.document_id)}` : `${appUrl}/home`;
  // 같은 사람에게 온 멘션 알림은 **하나로 겹쳐 쌓인다** — 회차마다 새 배너가 쌓이면
  // 알림 목록이 같은 말로 뒤덮인다.
  return { title, body, url, tag: 'geurio-mention' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // cron이 부르므로 사용자 JWT가 없다 — `notify-digest`와 **같은 비밀**을 쓴다
  // (설정할 값이 둘이면 하나를 빠뜨리기 쉽고, 두 함수가 여는 문은 같은 종류다).
  const secret = Deno.env.get('DIGEST_SECRET') ?? '';
  if (!secret) return json({ error: 'server not configured' }, 500);
  if (!safeEqual(req.headers.get('x-digest-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server not configured' }, 500);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@geurio.com';
  if (!publicKey || !privateKey) return json({ sent: 0, reason: 'not-configured' });

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = createClient(supabaseUrl, serviceKey);
  const appUrl = Deno.env.get('APP_URL') ?? 'https://geurio.com';

  const { data, error } = await admin.rpc('pending_mention_pushes', {
    max_age_minutes: MAX_AGE_MINUTES,
    max_recipients: 200,
    max_subs_per_user: MAX_SUBS_PER_USER,
  });
  if (error) {
    console.error('[notify-push] pending 조회 실패', error.message);
    return json({ error: 'query failed' }, 500);
  }
  const rows = (data ?? []) as PushRow[];
  if (!rows.length) return json({ sent: 0, candidates: 0 });

  let sent = 0;
  let dropped = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = JSON.stringify(buildPushPayload(row, appUrl));
    let anyOk = false;

    for (const sub of row.subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 });
        anyOk = true;
        await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', sub.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (status === 404 || status === 410) {
          // 구독이 죽었다(브라우저 데이터 삭제·앱 제거) — 푸시 서비스가 알려 주는
          // **유일하게 확실한 신호**라 그 자리에서 지운다. 세어 두지 않는다.
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
          dropped += 1;
          continue;
        }
        failed += 1;
        console.error('[notify-push] 발송 실패', status, String(e).slice(0, 200));
        // 그 밖의 실패는 일시적일 수 있으니 센다 — 계속 실패하면 결국 지운다.
        const { data: cur } = await admin.from('push_subscriptions').select('fail_count').eq('id', sub.id).maybeSingle();
        const next = ((cur as { fail_count?: number } | null)?.fail_count ?? 0) + 1;
        if (next >= FAIL_LIMIT) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
          dropped += 1;
        } else {
          await admin.from('push_subscriptions').update({ fail_count: next }).eq('id', sub.id);
        }
      }
    }

    // **한 기기에라도 닿았으면** 보낸 것으로 친다. 아무 곳에도 못 닿았으면 찍지
    // 않아 다음 회차에 다시 시도한다(1분 뒤라 되풀이가 값싸다).
    if (anyOk) {
      const { error: stampError } = await admin
        .from('notifications')
        .update({ pushed_at: new Date().toISOString() })
        .in('id', row.ids);
      if (stampError) console.error('[notify-push] pushed_at 기록 실패', row.recipient, stampError.message);
      sent += 1;
    }
  }

  return json({ sent, candidates: rows.length, dropped, failed });
});

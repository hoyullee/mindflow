// 공책 첨부 청소 — **주인 없는 R2 객체와 쓰이지 않는 첨부를 지운다.** (backend/28-note-files.md)
//
// ── 무엇을 지우나 (선택은 SQL 함수 `files_sweep_candidates`가 한다 — 0049) ──
//   (a) 'pending'인 채 하루가 지난 것   — 업로드가 중간에 끊겼다
//   (b) 문서 또는 올린 사람이 사라진 것  — doc_id / uploader가 null
//   (c) 'ready'에 3일이 지났고, 문서 본문에도 최근 30일 기록 스냅샷에도 id가 없는 것
// 한 회차에 최대 200건. 남은 것은 다음 회차가 이어서 가져간다.
//
// ── 누가 부르나 ─────────────────────────────────────────────────────────
// `pg_cron`이 하루 한 번 `pg_net`으로 부른다(설정 SQL은 backend/28-note-files.md).
// **JWT 검증을 끈 함수**라(`config.toml`) `DIGEST_SECRET` 헤더로 문을 잠근다 — 멘션 메일
// (`notify-digest`)과 같은 비밀·같은 방식. 비밀이 설정되지 않았으면 500으로 닫는다.
//
// ── 순서 ────────────────────────────────────────────────────────────────
// R2 객체를 먼저 지우고 성공한 것만 행을 지운다. R2 삭제가 실패한 행은 남겨 다음 회차가 다시 시도한다
// (행이 먼저 사라지면 주인 없는 바이트가 영영 남는다). 404는 이미 없는 것이라 성공으로 친다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { deleteObject, readR2Config } from '../_shared/files.ts';

const BATCH = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 길이가 다른 두 문자열을 **같은 시간에** 견준다(notify-digest와 같다). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Candidate {
  id: string;
  object_key: string;
  reason: 'pending' | 'orphan' | 'unused';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('DIGEST_SECRET') ?? '';
  // 비밀이 **설정되지 않았으면 문을 연 채 두지 않는다** — 열려 있으면 아무나 삭제 회차를 돌릴 수 있다.
  if (!secret) return json({ error: 'server not configured' }, 500);
  if (!safeEqual(req.headers.get('x-digest-secret') ?? '', secret)) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'server not configured' }, 500);

  // R2가 아직 설정되지 않았으면 아무것도 읽지 않고 물러난다(올린 파일이 있을 수 없는 상태).
  const r2 = readR2Config();
  if (!r2) return json({ ok: false, reason: 'not-configured', deleted: 0 });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.rpc('files_sweep_candidates', { batch: BATCH });
  if (error) {
    console.error('files-sweep: select failed:', error.message);
    return json({ ok: false, reason: 'error' }, 500);
  }
  const candidates = (data ?? []) as Candidate[];

  const counts = { pending: 0, orphan: 0, unused: 0 };
  let failed = 0;
  const done: string[] = [];
  for (const c of candidates) {
    try {
      await deleteObject(r2, c.object_key);
      done.push(c.id);
      counts[c.reason] += 1;
    } catch (e) {
      // 한 건의 실패가 회차를 멈추지 않는다 — 그 행은 남아 다음 회차에 다시 잡힌다.
      failed += 1;
      console.warn(`files-sweep: R2 delete failed for ${c.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (done.length) {
    const { error: delErr } = await admin.from('note_files').delete().in('id', done);
    if (delErr) {
      // 객체는 이미 지워졌다 — 행이 남으면 다음 회차에 404(=성공)로 정리된다.
      console.error('files-sweep: row delete failed:', delErr.message);
      return json({ ok: false, reason: 'error', deletedObjects: done.length }, 500);
    }
  }

  return json({ ok: true, candidates: candidates.length, deleted: done.length, ...counts, failed });
});

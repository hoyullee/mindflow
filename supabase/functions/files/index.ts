// 공책 파일 첨부 — **서명 URL을 발급하고, 한도를 지킨다.** (backend/28-note-files.md)
//
// ── 흐름 ────────────────────────────────────────────────────────────────
//   upload   권한·한도 검사 → note_files 행(pending) → R2 PUT 서명 URL
//   (브라우저가 R2로 직접 PUT — 바이트는 이 함수를 지나지 않는다)
//   complete R2에 HEAD로 **실제 크기**를 재서 한도를 다시 본 뒤 ready로
//   download ready 파일의 GET 서명 URL(문서를 읽을 수 있는 사람만)
//   remove   R2 객체 삭제 → 행 삭제(올린 사람 또는 문서 소유자)
//
// ── 클라이언트를 믿지 않는다 ─────────────────────────────────────────────
// ① 호출자는 JWT로 먼저 확인한다. ② 문서 접근 판정은 **호출자의 클라이언트로** `owns_document`·
// `shared_with_me`·`link_shared` RPC를 불러 한다 — 규칙이 DB 한 곳(RLS 보조 함수)에만 있게 한다.
// ③ 선언한 크기는 믿지 않는다: `complete`가 R2에서 실제 크기를 다시 재고, 어긋나면 지운다.
// ④ note_files·user_plans에는 클라이언트용 쓰기 정책이 없다 — 쓰기는 service_role로만 한다.
//
// ── 설정이 없으면 조용히 물러난다 ───────────────────────────────────────
// R2 환경변수(`R2_ACCOUNT_ID`·`R2_ACCESS_KEY_ID`·`R2_SECRET_ACCESS_KEY`·`R2_BUCKET`) 중 하나라도
// 없으면 200 `{ ok:false, reason:'not-configured' }` — 마이그레이션·앱이 먼저 나가도 깨지지 않는다.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  contentDisposition,
  deleteObject,
  DOWNLOAD_TTL_SEC,
  headObjectSize,
  isActiveContent,
  objectKey,
  presign,
  readR2Config,
  sanitizeMime,
  sanitizeName,
  UPLOAD_TTL_SEC,
  type R2Config,
} from '../_shared/files.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const BAD = { ok: false, reason: 'bad-request' } as const;
const NOT_FOUND = { ok: false, reason: 'not-found' } as const;

/** 문서 id로 받는 문자열 — 비어 있거나 터무니없이 길면 거른다(실존 여부는 RPC가 본다). */
function asDocId(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;
}

/** uuid 모양의 파일 id. 아니면 DB에 보내지도 않는다(`invalid input syntax for type uuid`가 500이 되지 않게). */
function asFileId(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
}

interface Ctx {
  /** 호출자의 JWT를 단 클라이언트 — 접근 판정(RPC)과 한도 조회(`my_file_quota`)는 이것으로 한다. */
  asUser: SupabaseClient;
  /** service_role — note_files 쓰기 전용. 접근 판정에는 쓰지 않는다. */
  admin: SupabaseClient;
  uid: string;
  r2: R2Config;
}

interface FileRow {
  id: string;
  doc_id: string | null;
  uploader: string | null;
  object_key: string;
  name: string;
  size: number;
  mime: string;
  status: 'pending' | 'ready';
}

interface Quota {
  used: number;
  storage_limit: number;
  file_limit: number;
}

/** 호출자의 요금제·사용량. 행이 없을 수는 없지만(plans에 'free' 시드) 없으면 던져 500으로 드러낸다. */
async function myQuota(ctx: Ctx): Promise<Quota> {
  const { data, error } = await ctx.asUser.rpc('my_file_quota');
  if (error) throw new Error(`my_file_quota: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) throw new Error('my_file_quota: no row');
  // bigint는 PostgREST가 숫자로 준다(2^53 미만 — 바이트 한도로는 충분).
  return { used: Number(row.used), storage_limit: Number(row.storage_limit), file_limit: Number(row.file_limit) };
}

/** 호출자 권한으로 불리언 RPC를 부른다. 실패는 **거부**로 읽는다(열어 두는 쪽으로 틀리지 않는다). */
async function can(ctx: Ctx, fn: 'owns_document' | 'shared_with_me' | 'link_shared', docId: string, minRole?: string): Promise<boolean> {
  const args: Record<string, string> = { doc_id: docId };
  if (minRole) args.min_role = minRole;
  const { data, error } = await ctx.asUser.rpc(fn, args);
  if (error) {
    console.warn(`files: rpc ${fn} failed: ${error.message}`);
    return false;
  }
  return data === true;
}

const canEdit = async (ctx: Ctx, docId: string) => (await can(ctx, 'owns_document', docId)) || (await can(ctx, 'shared_with_me', docId, 'edit'));
const canRead = async (ctx: Ctx, docId: string) =>
  (await can(ctx, 'owns_document', docId)) || (await can(ctx, 'shared_with_me', docId, 'view')) || (await can(ctx, 'link_shared', docId));

async function loadFile(ctx: Ctx, fileId: string): Promise<FileRow | null> {
  const { data, error } = await ctx.admin
    .from('note_files')
    .select('id, doc_id, uploader, object_key, name, size, mime, status')
    .eq('id', fileId)
    .maybeSingle();
  if (error) throw new Error(`note_files read: ${error.message}`);
  return (data as FileRow | null) ?? null;
}

// ── upload ──────────────────────────────────────────────────────────────

async function upload(ctx: Ctx, p: Record<string, unknown>) {
  const docId = asDocId(p.docId);
  const name = sanitizeName(p.name);
  const size = p.size;
  if (!docId || !name || typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return { status: 400, body: BAD };
  const mime = sanitizeMime(p.mime);

  // 편집할 수 있는 사람만 올린다 — 보기 전용·링크 열람자는 첨부를 늘릴 수 없다.
  // (거절도 200 + reason: `functions.invoke`는 비 2xx의 본문을 error 뒤로 숨기므로 이유가 읽히게 한다.)
  if (!(await canEdit(ctx, docId))) return { status: 200, body: { ok: false, reason: 'forbidden' } };

  const q = await myQuota(ctx);
  if (size > q.file_limit) return { status: 200, body: { ok: false, reason: 'too-large', fileLimit: q.file_limit } };
  if (q.used + size > q.storage_limit) return { status: 200, body: { ok: false, reason: 'quota', used: q.used, limit: q.storage_limit } };

  const fileId = crypto.randomUUID();
  const key = objectKey(docId, fileId);
  const { error } = await ctx.admin
    .from('note_files')
    .insert({ id: fileId, doc_id: docId, uploader: ctx.uid, object_key: key, name, size, mime, status: 'pending' });
  if (error) throw new Error(`note_files insert: ${error.message}`);

  // Content-Type을 서명에 넣는다 — 브라우저가 다른 형식으로 올리면 R2가 거절한다.
  const headers = { 'Content-Type': mime };
  const uploadUrl = await presign(ctx.r2, key, 'PUT', UPLOAD_TTL_SEC, { headers });
  return { status: 200, body: { ok: true, fileId, uploadUrl, headers } };
}

// ── complete ────────────────────────────────────────────────────────────

async function complete(ctx: Ctx, p: Record<string, unknown>) {
  const fileId = asFileId(p.fileId);
  if (!fileId) return { status: 400, body: BAD };
  const row = await loadFile(ctx, fileId);
  // 올린 사람만 — 남의 pending을 ready로 만들 수 없다. 존재 여부도 흘리지 않는다.
  if (!row || row.uploader !== ctx.uid || !row.doc_id) return { status: 200, body: NOT_FOUND };

  // 재시도에 안전하게: 이미 ready면 같은 답을 다시 준다.
  if (row.status === 'ready') {
    return { status: 200, body: { ok: true, file: { id: row.id, name: row.name, size: row.size, mime: row.mime } } };
  }

  const actual = await headObjectSize(ctx.r2, row.object_key);
  if (actual === null) return { status: 200, body: { ok: false, reason: 'missing' } };

  // 선언한 크기가 아니라 **실제 크기**로 한도를 다시 본다. used는 이 행의 선언 크기를 이미 포함한다.
  const q = await myQuota(ctx);
  const tooLarge = actual > q.file_limit;
  const overQuota = q.used - row.size + actual > q.storage_limit;
  if (tooLarge || overQuota) {
    await deleteObject(ctx.r2, row.object_key);
    const { error } = await ctx.admin.from('note_files').delete().eq('id', row.id);
    if (error) throw new Error(`note_files delete: ${error.message}`);
    return {
      status: 200,
      body: tooLarge
        ? { ok: false, reason: 'too-large', fileLimit: q.file_limit }
        : { ok: false, reason: 'quota', used: q.used - row.size, limit: q.storage_limit },
    };
  }

  const { error } = await ctx.admin.from('note_files').update({ size: actual, status: 'ready' }).eq('id', row.id);
  if (error) throw new Error(`note_files update: ${error.message}`);
  return { status: 200, body: { ok: true, file: { id: row.id, name: row.name, size: actual, mime: row.mime } } };
}

// ── download ────────────────────────────────────────────────────────────

async function download(ctx: Ctx, p: Record<string, unknown>) {
  const fileId = asFileId(p.fileId);
  if (!fileId) return { status: 400, body: BAD };
  const row = await loadFile(ctx, fileId);
  // 없음·pending·접근 불가를 **같은 답**으로 — 파일이 있는지 없는지를 묻는 창구가 되지 않게.
  if (!row || row.status !== 'ready' || !row.doc_id || !(await canRead(ctx, row.doc_id))) return { status: 200, body: NOT_FOUND };

  // 페이지처럼 실행될 수 있는 형식(html·svg·xml)은 inline을 요청해도 첨부로 내려 준다.
  const inline = p.inline === true && !isActiveContent(row.mime);
  const url = await presign(ctx.r2, row.object_key, 'GET', DOWNLOAD_TTL_SEC, {
    query: {
      'response-content-disposition': contentDisposition(row.name, inline),
      'response-content-type': row.mime,
    },
  });
  return { status: 200, body: { ok: true, url } };
}

// ── remove ──────────────────────────────────────────────────────────────

async function remove(ctx: Ctx, p: Record<string, unknown>) {
  const fileId = asFileId(p.fileId);
  if (!fileId) return { status: 400, body: BAD };
  const row = await loadFile(ctx, fileId);
  if (!row) return { status: 200, body: NOT_FOUND };
  // 올린 사람 또는 그 문서의 소유자. (편집자라고 남이 올린 파일을 지울 수는 없다.)
  const mine = row.uploader === ctx.uid;
  if (!mine && !(row.doc_id && (await can(ctx, 'owns_document', row.doc_id)))) return { status: 200, body: NOT_FOUND };

  // R2 먼저, 행은 그다음 — 순서가 반대면 R2 삭제가 실패했을 때 주인 없는 바이트가 남는다.
  // R2 삭제가 실패하면 던져서 행을 남긴다(다음 시도·files-sweep이 이어서 지운다).
  await deleteObject(ctx.r2, row.object_key);
  const { error } = await ctx.admin.from('note_files').delete().eq('id', row.id);
  if (error) throw new Error(`note_files delete: ${error.message}`);
  return { status: 200, body: { ok: true } };
}

// ── 진입점 ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method-not-allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ ok: false, reason: 'server-not-configured' }, 500);
  if (!authHeader) return json({ ok: false, reason: 'unauthorized' }, 401);

  // 호출자를 먼저 확인한다 — 아래 모든 동작이 이 사람의 권한으로 판정된다.
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const uid = userData?.user?.id ?? '';
  if (!uid) return json({ ok: false, reason: 'unauthorized' }, 401);

  const r2 = readR2Config();
  if (!r2) return json({ ok: false, reason: 'not-configured' });

  let payload: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(BAD, 400);
    payload = parsed as Record<string, unknown>;
  } catch {
    return json(BAD, 400);
  }

  const ctx: Ctx = { asUser, admin: createClient(supabaseUrl, serviceKey), uid, r2 };
  try {
    let out: { status: number; body: unknown };
    switch (payload.action) {
      case 'upload':
        out = await upload(ctx, payload);
        break;
      case 'complete':
        out = await complete(ctx, payload);
        break;
      case 'download':
        out = await download(ctx, payload);
        break;
      case 'remove':
        out = await remove(ctx, payload);
        break;
      default:
        out = { status: 400, body: BAD };
    }
    return json(out.body, out.status);
  } catch (e) {
    // 원인은 로그에만 — 응답에 내부 메시지를 싣지 않는다.
    console.error('files:', e instanceof Error ? e.message : e);
    return json({ ok: false, reason: 'error' }, 500);
  }
});

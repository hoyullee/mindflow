-- MindFlow — 공책 **파일 첨부**의 서버 쪽: 요금제·사용량 + 파일 메타데이터.
--
-- Apply with the Supabase CLI (`supabase db push` / `supabase migration up`)
-- or `psql "$DATABASE_URL" -f supabase/migrations/0049_note_files.sql`.
-- See server/supabase/docs/backend.md (§28) for the deploy checklist.
--
-- ── 파일 본체는 여기 없다 ─────────────────────────────────────────────────
-- 바이트는 **Cloudflare R2**(S3 호환)에 둔다. Supabase Storage는 무료 5GB 송신(egress)을
-- 앱 본체(문서·실시간)와 나눠 써야 하는데 R2는 송신이 0원이라서다. 이 DB는 "누구의 어떤
-- 파일이 얼마인가"(메타데이터)와 한도(요금제)만 든다. 브라우저는 Edge Function `files`가
-- 발급한 **서명 URL**로 R2와 직접 주고받는다 — 바이트가 우리 함수를 지나지 않는다.
--
-- ── 쓰기 모델: 클라이언트는 아무것도 쓰지 못한다 ──────────────────────────
-- plans / user_plans / note_files 어디에도 INSERT·UPDATE·DELETE 정책이 없다. 쓰는 쪽은
-- Edge Function(service_role)뿐이다 — 크기를 클라이언트가 말하는 대로 믿으면 한도가
-- 무의미해지고(complete에서 R2에 실제 크기를 HEAD로 다시 잰다), user_plans를 열면 스스로
-- 요금제를 올릴 수 있기 때문이다(나중에 결제 웹훅이 service_role로 plan_id를 바꾼다).

-- ── plans ────────────────────────────────────────────────────────────────
-- 요금제 표. 유료 플랜은 행 하나를 더하면 된다(코드에 한도를 박지 않는다).
create table if not exists public.plans (
  id text primary key,
  name text not null,
  -- 한 사람이 올린 파일의 총합 상한 / 파일 하나의 상한(바이트).
  storage_limit_bytes bigint not null,
  file_limit_bytes bigint not null
);

insert into public.plans (id, name, storage_limit_bytes, file_limit_bytes)
values ('free', '무료', 200 * 1024 * 1024, 20 * 1024 * 1024)
on conflict (id) do nothing;

alter table public.plans enable row level security;

-- 정책은 전부 `to authenticated` — 빼면 PUBLIC이라 anon에게도 열린다(링크 공유 정책이
-- 문서 본문을 익명에 노출했던 사건). revoke는 정책이 어긋나도 막는 이중 잠금.
revoke all on public.plans from anon;
revoke insert, update, delete, truncate on public.plans from authenticated;

drop policy if exists "plans_select" on public.plans;
create policy "plans_select" on public.plans
  for select to authenticated using (true);

-- ── user_plans ───────────────────────────────────────────────────────────
-- 누가 어느 요금제인가. **행이 없으면 'free'**다 — 가입할 때마다 행을 만들 필요가 없다
-- (`my_file_quota`와 Edge Function이 같은 규칙으로 읽는다).
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null default 'free' references public.plans (id),
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;

revoke all on public.user_plans from anon;
revoke insert, update, delete, truncate on public.user_plans from authenticated;

drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own" on public.user_plans
  for select to authenticated using (user_id = auth.uid());

-- ── note_files ───────────────────────────────────────────────────────────
-- 파일 하나 = 한 행. `object_key`는 R2 안의 위치(`<docId>/<fileId>`)이고 사용자가 정한
-- 파일 이름은 절대 키에 들어가지 않는다(경로 조작·충돌 방지) — 이름은 `name`에만 둔다.
--
-- doc_id·uploader가 `on delete set null`인 이유: 문서나 계정이 지워질 때 행을 같이 지우면
-- **R2의 바이트가 주인 없이 남는다**(DB 쪽 cascade는 R2를 지우지 못한다). 행을 남겨 두면
-- `files-sweep`이 null을 보고 R2 객체를 지운 뒤 행을 지운다.
create table if not exists public.note_files (
  id uuid primary key default gen_random_uuid(),
  doc_id text references public.documents (id) on delete set null,
  uploader uuid references auth.users (id) on delete set null,
  object_key text not null unique,
  name text not null,
  size bigint not null check (size >= 0),
  mime text not null default 'application/octet-stream',
  -- pending = 서명 URL만 발급됨(업로드 전/중), ready = complete가 R2 실물을 확인함.
  status text not null default 'pending' check (status in ('pending', 'ready')),
  created_at timestamptz not null default now()
);

create index if not exists note_files_uploader_idx on public.note_files (uploader);
create index if not exists note_files_doc_idx on public.note_files (doc_id);

alter table public.note_files enable row level security;

revoke all on public.note_files from anon;
revoke insert, update, delete, truncate on public.note_files from authenticated;

-- 읽기: 문서를 읽을 수 있는 사람 — 소유자 · 초대받은 사람(view/edit) · 링크 공유(0017).
-- 첨부 목록은 본문과 같이 보이는 것이라 본문과 같은 문턱이다(기록·댓글처럼 좁히지 않는다).
-- doc_id가 null(문서가 지워진 고아)이면 세 함수가 모두 false라 아무에게도 안 보인다.
drop policy if exists "note_files_select" on public.note_files;
create policy "note_files_select" on public.note_files
  for select to authenticated using (
    public.owns_document(doc_id)
    or public.shared_with_me(doc_id)
    or public.link_shared(doc_id)
  );

-- INSERT/UPDATE/DELETE 정책은 두지 않는다: service_role(Edge Function)만 쓴다.

-- ── my_file_quota ────────────────────────────────────────────────────────
-- 설정 화면의 "사용량 n / 200MB". used에는 pending도 센다 — 업로드를 시작만 하고 버리는
-- 식으로 한도를 우회하지 못하게(그런 행은 하루 뒤 files-sweep이 치운다).
-- `security definer`라 note_files의 RLS를 건너뛰므로 **auth.uid() 본인 것만** 더한다.
create or replace function public.my_file_quota()
returns table (plan text, plan_name text, used bigint, storage_limit bigint, file_limit bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.name,
         coalesce((select sum(f.size) from public.note_files f where f.uploader = auth.uid()), 0)::bigint,
         p.storage_limit_bytes,
         p.file_limit_bytes
    from public.plans p
   where p.id = coalesce((select up.plan_id from public.user_plans up where up.user_id = auth.uid()), 'free');
$$;

revoke all on function public.my_file_quota() from public, anon;
grant execute on function public.my_file_quota() to authenticated;

-- ── files_sweep_candidates ───────────────────────────────────────────────
-- Edge Function `files-sweep`(cron)이 지울 파일을 고르는 질의. SQL 함수로 둔 이유: Postgres
-- 하네스로 규칙을 그대로 시험할 수 있고, 함수는 "R2 지우기 + 행 지우기"만 하면 된다.
--
-- 지울 것 셋:
--  (a) 'pending'인 채 하루가 지난 것 — 업로드가 중간에 끊겼다(complete가 안 왔다).
--  (b) doc_id 또는 uploader가 null — 문서·계정이 지워졌다(위 on-delete-set-null).
--  (c) 'ready'이고 3일이 지났는데 **문서 본문 어디에도 id가 없고**, 최근 30일 안의 어느
--      기록 스냅샷(note_history, 0048)에도 없는 것 — 본문에서 지운 첨부. 기록으로 되돌리면
--      다시 나타날 수 있어서 기록 보관 기간(30일) 동안은 R2에 둔다. 3일 유예는 막 올리고
--      본문에 넣기 전(또는 저장 지연)인 파일을 건드리지 않으려는 것이다.
--      id(uuid) 문자열이 본문 jsonb 텍스트에 있는지 `position`으로 본다 — 본문 구조(블록
--      종류)에 기대지 않아 첨부를 어느 블록에 넣든 같은 규칙이 먹는다. 휴지통(soft delete)의
--      문서도 본문이 남아 있으므로 지우지 않는다.
--
-- 한 번에 `batch`건까지만 — R2 호출이 건당이라 함수 실행 시간 안에 끝나게 한다.
-- 남은 것은 다음 회차가 이어서 가져간다. definer + 아무에게도 execute를 주지 않는다
-- (service_role만 부른다) — 파일 이름·키 목록을 클라이언트가 열람하는 길을 만들지 않는다.
create or replace function public.files_sweep_candidates(batch integer default 200)
returns table (id uuid, object_key text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.object_key,
         case
           when f.status = 'pending' then 'pending'
           when f.doc_id is null or f.uploader is null then 'orphan'
           else 'unused'
         end
    from public.note_files f
   where (f.status = 'pending' and f.created_at < now() - interval '1 day')
      or f.doc_id is null
      or f.uploader is null
      or (
        f.status = 'ready'
        and f.created_at < now() - interval '3 days'
        and not exists (
          select 1 from public.documents d
           where d.id = f.doc_id
             and position(f.id::text in d.data::text) > 0
        )
        and not exists (
          select 1 from public.note_history h
           where h.document_id = f.doc_id
             and h.at > now() - interval '30 days'
             and position(f.id::text in h.snapshot::text) > 0
        )
      )
   order by f.created_at
   limit greatest(batch, 0);
$$;

revoke all on function public.files_sweep_candidates(integer) from public, anon, authenticated;
grant execute on function public.files_sweep_candidates(integer) to service_role;

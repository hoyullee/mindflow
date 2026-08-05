-- 0015: 마지막으로 저장한 사람 — 홈 맵 카드의 "수정일 · 3시간 전 · 홍길동".
--
-- 공동 편집(0009)이 실사용에 들어가면서 "이 맵을 마지막으로 건드린 사람이 누구인가"가
-- 의미를 갖게 됐다. 시각(`updated_at`)은 이미 있으니 **사람**만 더한다.
--
-- 표시 규칙(웹): 마지막 저장자가 **내가 아닐 때만** 이름을 붙인다. 혼자 쓰는 사람은
-- 모든 카드에 자기 이름이 반복돼 정보가 아니라 잡음이 되기 때문이다. 그래서 아래
-- `document_editors`도 **호출자 본인은 돌려주지 않는다**(노출 최소화 + 규칙을 한곳에).

-- ── documents.updated_by ─────────────────────────────────────────────────
-- 탈퇴한 사람이 마지막 편집자였다면 이름을 지우되 문서는 남긴다(`set null`) —
-- 소유자가 탈퇴하면 문서 자체가 `owner`의 cascade로 사라지는 것과는 다른 경우다
-- (공유받아 편집만 하던 사람).
alter table public.documents
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

-- 값은 **서버가** 찍는다. `updated_at`과 같은 이유 — 클라이언트가 보내는 값이면
-- 남의 이름으로 위장할 수 있다. (`set_updated_at`은 workspaces와 함께 쓰는 함수라
-- 건드리지 않고 documents 전용 트리거를 하나 더 단다.)
create or replace function public.set_updated_by()
returns trigger
language plpgsql
as $$
begin
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists documents_set_updated_by on public.documents;
create trigger documents_set_updated_by
  before insert or update on public.documents
  for each row execute function public.set_updated_by();

-- ── 이름 해석 RPC ────────────────────────────────────────────────────────
-- 왜 RPC인가: 클라이언트는 `auth.users`도, 남의 `profiles`(RLS `profiles_select_own`)도
-- 읽을 수 없다. 공유 팝업의 `share_participants`(0010)와 같은 방식으로, SECURITY
-- DEFINER 함수 하나가 그 조인을 대신하고 노출 범위는 0009의 정책을 그대로 따른다.
--
-- SECURITY DEFINER는 RLS를 우회하므로 **가시성 가드를 직접 건다**:
--   * 내가 소유한 문서(`owns_document`) 또는 나에게 공유된 문서(`shared_with_me`)만.
--   * 마지막 저장자가 나 자신이면 아무것도 돌려주지 않는다(표시 규칙).
-- 이름 우선순위는 앱의 프로필명 규칙(`useProfileName`, 0006/0010)과 같다:
--   profiles.display_name → OAuth full_name/name → 이메일 로컬 파트.
-- **이메일 전체는 절대 돌려주지 않는다** — 카드에 필요한 건 표시용 이름뿐이다.
create or replace function public.document_editors(doc_ids text[])
returns table (document_id text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id,
         coalesce(
           nullif(btrim(p.display_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email::text, '@', 1)
         )
  from public.documents d
  join auth.users u on u.id = d.updated_by
  left join public.profiles p on p.id = d.updated_by
  where d.id = any(doc_ids)
    and d.updated_by is not null
    and d.updated_by <> auth.uid()
    and (public.owns_document(d.id) or public.shared_with_me(d.id, 'view'));
$$;

revoke all on function public.document_editors(text[]) from anon;
revoke all on function public.document_editors(text[]) from public;
grant execute on function public.document_editors(text[]) to authenticated;

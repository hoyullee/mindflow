-- MindFlow — 초대 알림 ①: "아직 못 본 공유"를 서버가 기억한다.
--
-- 지금까지 누군가를 초대해도 **상대는 그 사실을 알 방법이 없었다**. 초대 행만
-- `document_shares`에 생기고, 상대가 우연히 홈의 "공유받음"을 펼쳐 봐야 발견한다.
-- 직접 "링크 보냈어"라고 말해 줘야 하는 구조였다.
--
-- 첫 단계는 **앱 안의 배지**다(메일 발송은 다음 단계). 배지가 성립하려면 "이 공유를
-- 봤는가"를 어딘가 기억해야 하는데, 그 자리를 **서버**로 잡는다:
--   * 기기마다 따로 기억하면(localStorage) 폰에서 확인한 배지가 PC에서 또 뜬다.
--   * 이 앱은 이미 스페이스·최근 항목을 per-user 블롭으로 동기화한다 — 알림만
--     기기별로 노는 것이 오히려 어긋난다.
alter table public.document_shares
  add column if not exists seen_at timestamptz;

comment on column public.document_shares.seen_at is
  '초대받은 사람이 이 공유를 확인한 시각. null = 아직 못 봄(홈 배지에 셈).';

-- ── 왜 UPDATE 정책을 넓히지 않고 RPC인가 ─────────────────────────────────
-- `shares_update_owner`는 소유자 전용이다(0009). 초대받은 사람이 자기 행을 UPDATE
-- 할 수 있게 정책을 넓히면 `seen_at`만이 아니라 **`role`까지** 바꿀 수 있다 —
-- Postgres RLS는 컬럼 단위로 못 좁힌다. 보기 전용으로 초대받은 사람이 스스로
-- 'edit'으로 승격하는 길이 열리는 셈이다.
--
-- 그래서 "내 행의 seen_at만" 건드리는 좁은 문 하나를 definer 함수로 낸다.
-- 대상은 언제나 `auth.jwt()`의 내 이메일이라 남의 행에는 닿지 않는다.
create or replace function public.mark_shares_seen(doc_ids text[])
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.document_shares
     set seen_at = now()
   where invitee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and (doc_ids is null or document_id = any (doc_ids))
     and seen_at is null;
$$;

revoke all on function public.mark_shares_seen(text[]) from anon;
revoke all on function public.mark_shares_seen(text[]) from public;
grant execute on function public.mark_shares_seen(text[]) to authenticated;

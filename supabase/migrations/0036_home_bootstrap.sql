-- 홈 첫 화면을 여는 데 필요한 목록을 **한 번의 왕복**으로.
--
-- 홈은 그동안 네 갈래를 따로 물었다: `documents` 목록, 내 링크 공유가 켜진 문서,
-- `document_shares`의 내 행(공유받은 맵 + "아직 못 본" 배지), 그리고 내가 걸어 둔
-- 초대 수(카드의 "공유 중" 표식). 넷은 병렬로 나가지만 요청은 넷이고, 그 하나하나가
-- TLS·인증 검사를 다시 지난다.
--
-- **security invoker**(기본값)라 RLS가 그대로 걸린다 — 이 함수는 권한을 넓히지
-- 않는다: 호출자가 원래 볼 수 있던 행만 담긴다(내 문서 + 나에게 공유된 문서,
-- 내 문서의 초대 전부 + 나에게 온 초대). 그래서 `security definer`로 두고 가드를
-- 직접 짜야 하는 다른 RPC들(0010·0011·0015·0019)과 달리 검사 코드가 없다.
--
-- 반환은 jsonb 하나 — 두 목록의 칼럼 모양이 달라 한 표로는 못 담고, 클라이언트가
-- 예전 질의와 **같은 필드**를 그대로 읽게 하려는 것이다(어댑터의 매핑을 두 벌로
-- 두지 않는다). 이 함수가 없는 서버(배포 순서)에서는 클라이언트가 예전 네 질의로
-- 조용히 물러난다.
create or replace function public.home_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', d.id,
                 'title', d.title,
                 'version', d.version,
                 'updated_at', d.updated_at,
                 'is_favorite', d.is_favorite,
                 'deleted_at', d.deleted_at,
                 'owner', d.owner,
                 'updated_by', d.updated_by,
                 'link_role', d.link_role
               )
               order by d.updated_at desc
             )
      from public.documents d
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'document_id', s.document_id,
                 'invitee_email', s.invitee_email,
                 'role', s.role,
                 'seen_at', s.seen_at
               )
             )
      from public.document_shares s
    ), '[]'::jsonb)
  );
$$;

-- 새 함수는 EXECUTE가 PUBLIC에 기본 부여된다 — 익명 키로도 부를 수 있게 두지
-- 않는다(홈은 로그인한 사용자의 화면이다. 0017의 `link_shared`와 같은 처방).
revoke all on function public.home_bootstrap() from public, anon;
grant execute on function public.home_bootstrap() to authenticated;

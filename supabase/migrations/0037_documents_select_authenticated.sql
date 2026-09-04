-- documents SELECT를 **로그인한 사용자로 한정**한다.
--
-- 0036의 하네스(실제 마이그레이션을 올린 로컬 Postgres)에서 드러난 것: 0017이
-- 링크 공유를 위해 SELECT 정책에 더한 `link_role is not null`은 **역할을 가리지
-- 않는다**(`to` 절이 없으면 정책은 PUBLIC이고, Supabase는 `anon`에게도 public
-- 스키마 테이블의 SELECT 권한을 준다). 그래서 익명 키만으로 `documents`를 읽으면
-- **링크 공유가 켜진 문서 전부가** 제목·본문까지 돌아온다 — 링크를 받은 사람만
-- 보는 것이 아니라 목록째 훑을 수 있다.
--
-- 링크 공유의 설계는 처음부터 "링크가 있는 **로그인한** 사람은 열람"이었다
-- (익명 열람은 공개 라우트·익명 RLS·익명 서명 URL이 함께 필요한 별도 작업으로
-- 미뤄 뒀다). 조건은 그대로 두고 **대상 역할만** 좁힌다 — 소유자·초대·링크
-- 세 갈래의 판단은 한 글자도 바뀌지 않으므로 로그인 사용자의 화면은 그대로다.
drop policy if exists "documents_select_own_or_shared" on public.documents;
create policy "documents_select_own_or_shared" on public.documents
  for select
  to authenticated
  using (
    auth.uid() = owner
    or public.shared_with_me(id, 'view')
    or link_role is not null
  );

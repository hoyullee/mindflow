-- 구글 캘린더 **연결 유지** — refresh token을 서버가 보관한다.
--
-- 그동안은 브라우저 전용 GIS 토큰 흐름(`initTokenClient`)만 썼다. 그 흐름은
-- **액세스 토큰만** 주고 refresh token을 주지 않으므로 한 시간마다 연결이 끊겼고,
-- 갱신하려면 GIS를 다시 불러야 하는데 그건 조용한 갱신(`prompt: ''`)이라도
-- **팝업 창을 연다**(이 API에는 창 없는 갱신이 없다). 그래서 자동 갱신을 끊고
-- 화면의 "다시 연결" 버튼에 맡겼다 — 사용자에게는 한 시간마다 클릭이었다.
--
-- 이제 auth-code 흐름으로 바꾼다: 브라우저는 **인가 코드**만 받아 Edge Function에
-- 넘기고, 함수가 client secret으로 교환해 refresh token을 여기에 적어 둔다. 이후
-- 액세스 토큰은 그 함수가 조용히 발급한다(팝업 없음).
--
-- ── 이 표에는 클라이언트 정책을 **하나도 두지 않는다** ─────────────────────
-- refresh token은 그 자체가 "이 사람의 캘린더에 접근할 권한"이고 만료가 없다.
-- 브라우저에 한 번이라도 닿으면 유출 표면이 한 시간에서 무기한으로 늘어난다.
-- 그래서 RLS를 켜고 **정책을 만들지 않는다** — anon·authenticated는 이 표를
-- 읽지도 쓰지도 못하고, RLS를 우회하는 service role(= Edge Function)만 만진다.
-- (client secret이 서버에만 있어야 하는 것과 같은 이유다.)
--
-- 사용자가 탈퇴하면 `on delete cascade`로 함께 사라지고, 연결 해제는 함수가
-- 구글에 revoke를 보낸 뒤 이 행을 지운다.

create table if not exists public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- 구글이 준 refresh token. 값 자체가 자격 증명이라 밖으로 나가지 않는다.
  refresh_token text not null,
  -- 그때 실제로 승인된 스코프(공백 구분) — 필수 스코프가 빠졌는지 판단에 쓴다.
  scope text,
  -- 어느 구글 계정인가(화면 표시·계정 전환 감지용). 캘린더 내용은 담지 않는다.
  google_email text,
  updated_at timestamptz not null default now()
);

alter table public.google_credentials enable row level security;

-- 정책 없음(위 주석) + 테이블 권한 자체를 회수한다. 둘 다 거는 이유는 나중에
-- 누군가 "정책 하나쯤" 추가해도 GRANT가 없으면 여전히 닿지 않기 때문이다.
revoke all on public.google_credentials from anon, authenticated;

comment on table public.google_credentials is
  '구글 캘린더 refresh token — Edge Function(google-oauth)만 접근. 클라이언트 정책 없음.';

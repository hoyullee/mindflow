-- 사용자 피드백 수집함 — 홈/에디터의 "피드백 보내기" 모달이 쓴다.
--
-- 설계: **insert 전용 우편함**. 일반 사용자는 자기 uid로 넣을 수만 있고
-- 읽기/수정/삭제 정책이 없다(남의 피드백은 물론 자기 것도 다시 못 본다 —
-- 신고함의 관례). 운영자는 Supabase Studio(서비스 롤)에서 조회한다.
-- 무료 티어 셈법: 텍스트 행 수백 개는 저장량·egress 모두 사실상 0이다.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- 계정 탈퇴 시 피드백은 남기되 연결만 끊는다(set null) — 수집 목적상 내용이 자산.
  user_id uuid references auth.users (id) on delete set null,
  -- 조회 편의를 위한 스냅샷(작성 시점 이메일). user_id가 null이 되어도 남는다.
  email text,
  category text not null default 'other'
    check (category in ('bug', 'ux', 'idea', 'other')),
  message text not null
    check (char_length(message) between 1 and 4000),
  -- 어느 화면에서 보냈는가 ('home' | 'editor' 등 — 앱이 넣는 자유 문자열)
  page text,
  -- 재현에 도움되는 맥락(빌드 스탬프, userAgent 등). 앱이 작게 유지한다.
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- INSERT만, 로그인 사용자, 자기 uid로만 — user_id 위조를 막는다.
create policy "feedback_insert_own" on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

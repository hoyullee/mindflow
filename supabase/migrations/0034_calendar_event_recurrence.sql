-- 0034 — Geurio 일정의 반복 규칙.
--
-- 0033의 `calendar_events`에 **RRULE 한 줄**을 담는 칼럼 하나를 더한다
-- (`RRULE:FREQ=WEEKLY;INTERVAL=2`). 구글에 만드는 일정이 이미 같은 형식을 쓰므로
-- 규칙을 두 벌로 두지 않는다 — 나중에 어느 쪽으로 옮겨도 다시 짜지 않는다.
--
-- **한 행 = 하나의 반복**이다. 회차마다의 예외(그 날만 시간 변경·그 날만 삭제)는
-- 두지 않는다: 예외를 담으려면 별도 표와 "이 회차만/전체" 분기가 필요하고, 지금은
-- 고치면 전체 반복에 적용된다는 것을 화면이 분명히 말한다.
--
-- 회차를 실제 날짜로 펼치는 일은 **클라이언트**가 한다(`expandRecurrence`) — 서버가
-- 펼치면 같은 규칙을 두 곳에서 해석하게 되고, 달력이 그리는 것과 목록이 세는 것이
-- 어긋날 수 있다.
--
-- RLS·정책은 0033 그대로다(owner = auth.uid()) — 칼럼만 늘었다.

alter table public.calendar_events
  add column if not exists recurrence text;

comment on column public.calendar_events.recurrence is
  'RRULE 한 줄(RRULE:FREQ=DAILY|WEEKLY|MONTHLY;INTERVAL=n[;UNTIL=…|COUNT=n]). null이면 한 번만 있는 일정.';

-- 반복 일정은 구간 조회에서 end_date를 보지 않으므로(첫 회차가 몇 달 전이어도
-- 이번 달에 회차가 있다) 그 행만 빠르게 골라 오도록 부분 인덱스를 둔다.
create index if not exists calendar_events_recurring_idx
  on public.calendar_events (owner, start_date)
  where recurrence is not null;

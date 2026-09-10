-- MindFlow — Geurio 일정의 알림(요청: "앱에서 일정 알림을 OS 알림으로 받고 싶다").
--
-- ## 왜 이 칼럼이 없었나
--
-- 알림 UI(`ReminderField`)는 구글 연동 단계(PR6)에 들어왔고 그때는 **구글이 보내는
-- 알림**이었다 — 목적지가 Geurio면 그 칩이 비활성으로 남고 문구가 "Google 캘린더에
-- 저장하면 알림을 함께 등록할 수 있어요"라 말했다(0033 주석의 "알림·참석자·회의실은
-- 구글 연동 단계에서"가 그 뜻이다). 이제 우리가 직접 띄우므로 값을 담을 자리가 필요하다.
--
-- ## 번호 주의
--
-- 처음에 `0037`로 지었다가 **이미 같은 번호가 있었다**(`0037_documents_select_authenticated.sql`)
-- — 같은 번호가 둘이면 적용 순서가 모호해진다. 새 마이그레이션을 지을 때는
-- `ls supabase/migrations/ | tail`로 마지막 번호를 먼저 확인할 것.
--
-- ## 값의 뜻
--
-- **시작 시각으로부터 몇 분 전인가.** `null`이면 알림 없음(그게 기본이다 — 아무것도
-- 저절로 뜨지 않는다). `0`은 "시작할 때"다.
--
-- ## 왜 서버는 알림을 보내지 않는가 (중요)
--
-- 이 칼럼은 **누가 언제 알림을 원하는가**만 담고, 실제로 띄우는 일은 **브라우저·앱이**
-- 한다(`features/reminders/`). 서버 푸시로 가지 않은 이유는 개인정보처리방침이 캘린더
-- 데이터를 "브라우저에서 화면에 그리는 데만 쓰고 서버에 저장하지 않는다"고 명시하고
-- 있고(§4·§5·§6, 구글 민감 스코프 검수가 그 방침으로 통과했다) 서버가 알림을 보내려면
-- 구글 일정의 제목·시각까지 우리 서버에 쌓아야 하기 때문이다. Geurio 일정은 원래 우리
-- 표에 있으니 방침 개정 없이 서버 푸시가 가능하지만, 그건 "앱을 완전히 닫아도 알림"이
-- 필요해질 때의 다음 단계다(로컬 예약으로 앱이 켜져 있을 때는 이미 닿는다).
--
-- ## 종일 일정
--
-- v1은 **시각 있는 일정만** 알림을 갖는다. 종일 일정에 "10분 전"은 자정 10분 전이라
-- 뜻이 어긋나고(구글도 종일 알림을 "며칠 전 몇 시"라는 다른 표기로 다룬다) 우리 칩은
-- 분 단위뿐이다. 그래서 앱이 종일로 바뀌는 순간 이 값을 **지운다**(`normalizeEventInput`)
-- — 저장본만 봐도 무엇이 뜰지 알아야 한다.

alter table public.calendar_events
  add column if not exists reminder_minutes int;

do $$
begin
  -- 4주(40320분)까지 — 그보다 이른 알림은 뜻이 없고, 상한이 없으면 실수로 적은
  -- 큰 값이 조용히 저장돼 영영 뜨지 않는 알림이 된다.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_events'::regclass
      and conname = 'calendar_events_reminder_range'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_reminder_range
      check (reminder_minutes is null or (reminder_minutes >= 0 and reminder_minutes <= 40320));
  end if;
end $$;

comment on column public.calendar_events.reminder_minutes is
  '시작 몇 분 전에 알릴까(null = 알림 없음). 띄우는 일은 클라이언트가 한다 — 서버 푸시가 아니다.';

-- 0027: 알림 즉시 신호(요청: "배지가 즉시 표시되게, 비용 부담 없이").
--
-- 홈 벨은 60초 폴링으로 배지를 세운다(#383) — 이걸 **내용 없는 신호(ping)**로
-- 즉시로 만든다. 댓글 실시간(0021)과 같은 설계: notifications에 행이 insert되는
-- 순간 이 트리거가 수신자 전용 채널(`mindflow-notify:<uid>`)로 "확인해 봐"만
-- 쏘고, 받는 쪽이 RLS 걸린 select로 자기 우편함을 다시 읽는다 — 채널은 비밀을
-- 나르지 않는다. 알림을 만드는 곳이 어디든(댓글·공유·본문 멘션, 앞으로 늘어날
-- 종류까지) notifications 테이블 하나를 지나므로 신호 지점도 이 트리거 하나다.
--
-- 비용: 메시지는 **알림이 실제로 생길 때만 1건** — 폴링보다 싸다. 공개 채널의
-- 트레이드오프(0021과 동일): uid를 아는 사람이 신호 타이밍을 엿보거나 가짜
-- 신호를 보낼 수 있지만, 내용이 없고 가짜 신호의 효과는 select 한 번뿐이다.
--
-- 신호는 유실될 수 있고(realtime.send 미지원 서버 포함 — 예외 가드로 알림
-- 자체는 그대로 만들어진다) 클라이언트의 주기 확인이 안전망으로 남는다.

create or replace function public.notify_notification_ping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'notify', 'mindflow-notify:' || new.recipient::text, false);
  exception when others then
    -- 신호는 부가 기능 — 알림 insert(와 그걸 만든 저장)를 방해하지 않는다.
    raise warning '알림 ping 발송 실패: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.notify_notification_ping() from public, anon, authenticated;

drop trigger if exists trg_notifications_ping on public.notifications;
create trigger trg_notifications_ping
  after insert on public.notifications
  for each row execute function public.notify_notification_ping();

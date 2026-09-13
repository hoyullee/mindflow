// "일정이 바뀌었다" — 우리가 **직접 고친** 일정을 스케줄러에 곧바로 알린다.
//
// ## 왜 필요한가 (제보: 10분 전 알림을 걸었는데 오지 않는다)
//
// 스케줄러는 화면과 따로 돌면서 5분 주기(`REMINDER_REFETCH_MS`)로 일정을 다시 받는다
// — 열어 둔 채 **다른 기기에서** 바뀐 것까지 잡기 위한 주기다. 그런데 방금 이 화면에서
// 건 알림도 그 주기를 기다리므로, 사용자가 가장 자연스럽게 시험하는 방식
// (**10분 뒤 일정을 만들고 10분 전 알림**)에서는 알림 시각이 곧 지금이고, 5분 뒤
// 재조회 시점에는 이미 유예(`REMINDER_GRACE_MS`)를 넘겨 **영영 뜨지 않는다**.
//
// 우리가 고친 변경은 기다릴 이유가 없다 — 그 순간 알리고 스케줄러가 바로 다시 받는다.
// 두 원천(Geurio 일정·구글 일정)이 같은 신호를 쓴다: 갈라 두면 한쪽에만 붙는다.
//
// 구글 캘린더 앱에서 **밖에서** 고친 것은 여전히 주기·깨어남이 잡는다(우리가 알 길이
// 없다) — 그쪽은 유예가 주기보다 길다는 계약(`reminders.ts`)이 받아 준다.

type Listener = () => void;
const listeners = new Set<Listener>();

/** 일정을 만들거나 고치거나 지운 직후에 부른다(성공한 쓰기만). */
export function notifyCalendarChanged(): void {
  for (const fn of [...listeners]) fn();
}

/** 스케줄러가 구독한다 — 반환값을 부르면 해제. */
export function onCalendarChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

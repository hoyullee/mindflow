// 모바일 로컬 알림의 **순수 계획** 부분(3단계) — 무엇을 OS에 맡기고 무엇을 거둘까.
//
// ## 1·2단계와 무엇이 다른가
//
// 앞의 두 단계는 **앱이 켜져 있을 때**만 동작한다: 우리가 30초마다 훑어 "지금 띄울
// 것"을 찾는다. 앱이 닫혀 있으면 훑는 사람이 없다.
//
// 모바일에서는 **OS가 예약을 들고 있다** — 앱이 닫혀 있어도, 기기를 재부팅해도
// (플러그인이 `BOOT_COMPLETED`에 다시 심는다) 그 시각에 알림이 뜬다. 대신 우리는
// 앱이 열려 있는 동안 "앞으로 며칠치"를 미리 맡겨 둬야 한다.
//
// ## 왜 통째로 다시 예약하지 않는가
//
// `cancelAll → scheduleAll`이 가장 단순하지만 두 가지가 나쁘다: ① 곧 뜰 알림이 그
// 찰나에 사라졌다 다시 심어진다(그 사이에 시각이 지나면 영영 안 뜬다) ② 동기화가
// 잦아 OS에 쓸데없는 일을 시킨다. 그래서 **집합 차이**만 낸다 — 지금 걸려 있는 id와
// 있어야 할 id를 견줘 빠진 것만 심고 남는 것만 거둔다(멱등: 같은 입력이면 아무 일도
// 하지 않는다).
//
// ## id가 무엇을 담는가
//
// OS 예약의 id는 **숫자**라(안드로이드는 Java int) 우리 키를 해시해 만든다. 무엇이
// 바뀌면 "다른 알림"이 되어야 하는가가 곧 해시 입력이다: **알림 시각**(일정을 옮기면
// 그 시각에 뜨면 안 된다)과 **내용**(제목을 고쳤는데 옛 제목이 뜨면 안 된다). 회차는
// 키가 이미 구분한다(`일정id#날짜`).

import type { ReminderItem } from './reminders';

/**
 * 한 번에 맡길 수 있는 최대 개수.
 *
 * iOS는 대기 알림을 **앱당 64개**까지만 들고 있고 넘치면 **조용히 버린다** — 어느
 * 것이 버려졌는지 알 길이 없으므로 애초에 그 아래로 자른다. 남은 자리는 가까운
 * 것부터 채운다(먼 알림은 그 사이에 앱을 한 번이라도 열면 다시 맡겨진다).
 */
export const NATIVE_MAX_PENDING = 48;

/**
 * 앞으로 며칠치를 맡길까 — 웹(2일)보다 길다.
 *
 * 앱이 닫혀 있어도 떠야 하는 것이 이 단계의 목적이라, 주말 내내 앱을 열지 않은
 * 사람의 월요일 아침 알림까지 덮으려면 하루 이틀로는 모자란다.
 */
export const NATIVE_WINDOW_DAYS = 7;

/**
 * 알림 한 건의 OS 예약 id — 같은 입력이면 언제나 같은 수(멱등한 동기화의 뿌리).
 *
 * FNV-1a 32비트를 31비트 양수로 좁힌다(안드로이드 알림 id는 Java int라 음수·0을
 * 피한다). 충돌 확률은 수십 개 규모에서 사실상 0이고, 충돌하더라도 잃는 것은 그
 * 알림 하나다(뒤에 심는 쪽이 앞을 덮는다).
 */
export function reminderNotificationId(key: string, fireAt: number, title = ''): number {
  const input = `${key}@${fireAt}|${title}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // FNV 소수(16777619) 곱 — 32비트로 감기게 Math.imul을 쓴다.
    h = Math.imul(h, 0x01000193);
  }
  const id = (h >>> 0) & 0x7fffffff;
  return id === 0 ? 1 : id;
}

/** 동기화 한 번에 할 일 — 심을 것과 거둘 것. */
export interface NativePlan {
  /** 아직 안 걸려 있어서 새로 심을 알림. */
  schedule: ReminderItem[];
  /** 걸려 있지만 이제 필요 없는 예약 id(지운 일정·옮긴 시각·창 밖으로 나간 것). */
  cancel: number[];
}

/**
 * 지금 걸려 있는 예약(`pending`)과 있어야 할 목록(`items`)의 차이.
 *
 * **지난 것은 맡기지 않는다**(`fireAt <= now`) — OS 예약은 미래만 뜻이 있고, 지나간
 * 알림을 늦게라도 띄우는 일은 앱이 켜져 있을 때의 유예(`dueReminders`)가 맡는다.
 *
 * `pending` 전부를 우리 것으로 본다 — 이 앱에서 로컬 알림을 예약하는 곳은 여기뿐이다.
 */
export function planNativeSchedule(
  items: readonly ReminderItem[],
  pending: readonly number[],
  now: number,
  max = NATIVE_MAX_PENDING,
): NativePlan {
  const want = items
    .filter((i) => i.fireAt > now)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, max);
  const have = new Set(pending);
  const wantIds = new Set(want.map((i) => reminderNotificationId(i.key, i.fireAt, i.title)));
  return {
    schedule: want.filter((i) => !have.has(reminderNotificationId(i.key, i.fireAt, i.title))),
    cancel: pending.filter((id) => !wantIds.has(id)),
  };
}

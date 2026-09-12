// 모바일 로컬 알림 — Capacitor 플러그인에 닿는 **유일한** 자리(3단계).
//
// `nativeBridge.ts`와 같은 규칙을 지킨다: ① 모든 호출이 `isNativePlatform()`
// 뒤에 있고 ② 플러그인은 **동적 import**라, 평범한 브라우저·PWA·jsdom 테스트에서는
// 이 파일이 `@capacitor/core` 말고는 아무것도 불러오지 않는다(웹 동작 무변화).
//
// 여기에는 "무엇을 언제 띄울까"가 없다 — 그 판단은 `features/reminders`의 순수
// 부분(`nativeSchedule.ts`)이 하고, 이 파일은 그 결과를 OS에 옮기기만 한다. 그래서
// 알림 문구도 받아서 싣기만 한다(한국어 문장은 기능 쪽 한곳에서 만든다).

import { isNativePlatform } from './nativeBridge';

export type NativeNotifyPermission = 'default' | 'granted' | 'denied';

/** OS에 맡길 알림 한 건 — 기능 쪽이 `ReminderItem`을 이 꼴로 옮겨 넘긴다. */
export interface NativeScheduled {
  /** 예약 id(숫자) — 같은 알림이면 언제나 같은 값이어야 한다. */
  id: number;
  title: string;
  body: string;
  /** 띄울 시각(epoch ms). */
  at: number;
  /** 알림이 뜨거나 탭될 때 그대로 되돌아오는 꾸러미. */
  extra?: unknown;
}

/** 이 기기에서 OS 예약을 맡길 수 있는가(= Capacitor 네이티브 셸 안인가). */
export function nativeNotificationsAvailable(): boolean {
  return isNativePlatform();
}

type Plugin = typeof import('@capacitor/local-notifications').LocalNotifications;

/**
 * 플러그인을 **상자에 담아** 돌려준다(`{ p }`).
 *
 * 그대로 `return`하면 async 함수의 반환 처리가 "thenable인가?"를 보려고 `.then`을
 * 읽는데, Capacitor 플러그인 객체는 **모르는 이름을 전부 네이티브 호출로 넘기는
 * 프록시**라 그 순간 `LocalNotifications.then()` 호출이 되어 거부된다. 상자에 담으면
 * 프록시가 promise 기계와 만나지 않는다.
 */
/** 한 번만 불러온다 — 호출마다 동적 import를 걸 이유가 없다. */
let loading: Promise<{ p: Plugin } | null> | null = null;

async function api(): Promise<{ p: Plugin } | null> {
  if (!isNativePlatform()) return null;
  loading ??= import('@capacitor/local-notifications')
    .then((m) => ({ p: m.LocalNotifications }))
    // 플러그인이 안 실린 빌드 — 알림이 없을 뿐 앱은 그대로 돈다.
    .catch(() => null);
  return loading;
}

function toPermission(state: string | undefined): NativeNotifyPermission {
  return state === 'granted' || state === 'denied' ? state : 'default';
}

/** 지금 권한 상태. 네이티브가 아니면 `default`(호출부가 웹 경로를 쓴다). */
export async function checkNativeNotifyPermission(): Promise<NativeNotifyPermission> {
  const got = await api();
  if (!got) return 'default';
  try {
    return toPermission((await got.p.checkPermissions()).display);
  } catch {
    return 'default';
  }
}

/** 권한 요청 — **사용자 제스처에서만** 부른다(설정 토글·허용 버튼). */
export async function requestNativeNotifyPermission(): Promise<NativeNotifyPermission> {
  const got = await api();
  if (!got) return 'default';
  try {
    return toPermission((await got.p.requestPermissions()).display);
  } catch {
    return 'default';
  }
}

/** 지금 OS가 들고 있는 우리 예약 id들. 못 물어보면 빈 배열(이번 동기화는 건너뛴다). */
export async function pendingNativeIds(): Promise<number[]> {
  const got = await api();
  if (!got) return [];
  try {
    const { notifications } = await got.p.getPending();
    return notifications.map((n) => n.id).filter((id): id is number => typeof id === 'number');
  } catch {
    return [];
  }
}

export async function scheduleNative(list: readonly NativeScheduled[]): Promise<void> {
  if (!list.length) return;
  const got = await api();
  if (!got) return;
  await got.p.schedule({
    notifications: list.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      extra: n.extra,
      schedule: {
        at: new Date(n.at),
        // Doze(절전) 중에도 뜨게 — 없으면 기기가 깊이 잠든 새벽·주말 알림이 통째로
        // 밀린다.
        allowWhileIdle: true,
        // **정확 알람을 쓰지 않는다.** 안드로이드 12+에서 정확 알람은 사용자가 따로
        // 허용해야 하는 권한이고, 플러그인은 허용돼 있지 않으면 `schedule()` 도중
        // **시스템 "알람 및 리마인더" 설정 화면을 연다**. 이 동기화는 앱을 열면
        // 저절로 도는 것이라, 누르지도 않은 시스템 화면이 튀어나오면 안 된다
        // (저절로 뜨는 창을 만들지 않는다는 이 프로젝트의 규칙 — #546). 대가는
        // 몇 분의 오차이고, 정확 알람이 필요하면 "사용자가 눌러서" 허용을 받는
        // 별도 자리가 맞다.
        isExactNotification: false,
      },
      // `foreground`를 켜지 않는다: iOS는 앱이 떠 있을 때 이 알림을 **감추고**
      // 수신 이벤트만 준다 — 그때는 우리 인앱 토스트가 뜨므로 둘이 겹치지 않는다.
      // 안드로이드에서 켜면 앱을 쓰는 중에 헤드업 배너가 화면을 덮는다.
    })),
  });
}

/**
 * 알림 한 건을 **지금** 띄운다(예약이 아니라 즉시) — 설정의 `테스트 알림`이 쓴다.
 *
 * `schedule`을 주지 않으면 플러그인이 곧바로 띄운다 — 그래서 OS 대기 목록에 남지
 * 않고, 동기화가 "있어야 할 예약"과 견줘 거둬 가는 목록(`cancel`)에 걸려 2초 뒤에
 * 사라지는 일도 없다.
 */
export async function showNativeNotification(n: {
  id: number;
  title: string;
  body: string;
}): Promise<boolean> {
  const got = await api();
  if (!got) return false;
  try {
    await got.p.schedule({ notifications: [{ id: n.id, title: n.title, body: n.body }] });
    return true;
  } catch {
    return false;
  }
}

export async function cancelNative(ids: readonly number[]): Promise<void> {
  if (!ids.length) return;
  const got = await api();
  if (!got) return;
  await got.p.cancel({ notifications: ids.map((id) => ({ id })) });
}

/**
 * 알림이 **떴을 때**(앱이 떠 있는 동안)와 **탭됐을 때**를 함께 듣는다.
 *
 * 탭은 앱이 닫혀 있다 열리는 경우를 포함한다 — 그래서 호출부가 화면을 옮긴다.
 */
export async function onNativeNotification(
  cb: (extra: unknown, tapped: boolean) => void,
): Promise<() => void> {
  const got = await api();
  if (!got) return () => undefined;
  try {
    const handles = await Promise.all([
      got.p.addListener('localNotificationReceived', (n) => cb(n.extra, false)),
      got.p.addListener('localNotificationActionPerformed', (a) => cb(a.notification.extra, true)),
    ]);
    return () => {
      for (const h of handles) void h.remove();
    };
  } catch {
    return () => undefined;
  }
}

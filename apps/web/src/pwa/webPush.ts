// 웹 푸시 구독(0040) — 이 브라우저를 서버가 쏠 수 있는 곳으로 등록한다.
//
// ## 무엇이 계정이고 무엇이 기기인가 (0038 알림 설정과 같은 갈래)
//
// - **계정**: 푸시를 받을까(`notification_prefs.push_mentions`). 껐으면 어느
//   기기에도 안 간다 — 서버가 그 값을 본다.
// - **이 기기**: 구독 자체(`push_subscriptions`의 한 행 = 한 브라우저)와 **알림
//   권한**(우리가 옮길 수 없다).
//
// 그래서 설정의 스위치 하나가 둘을 함께 움직인다: 켜면 이 기기에서 권한을 묻고
// 구독을 만들고 계정 값을 켠다. 끄면 이 기기의 구독을 거두고 계정 값을 끈다
// (다른 기기는 계정 값 때문에 함께 조용해진다).
//
// ## 없으면 없는 대로
//
// 푸시 API가 없는 환경이 흔하다 — 설치형 셸(Electron에는 푸시 서비스가 없다),
// Capacitor WebView(안드로이드 WebView에 Push API가 없다), iOS의 비-PWA 사파리,
// 그리고 VAPID 공개 키를 넣지 않은 배포. 그때는 `pushAvailable()`이 false이고
// 설정에서 **그 행을 그리지 않는다** — 눌러도 아무 일이 없는 스위치를 두지 않는다.

import { isDesktopShell } from '../platform/desktopBridge';
import { nativeNotificationsAvailable } from '../platform/nativeNotifications';

/** 서버의 VAPID 공개 키. **공개값이다**(브라우저가 구독할 때 그대로 싣는다). */
const VAPID_PUBLIC_KEY: string = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

/**
 * base64url → Uint8Array. `applicationServerKey`는 **바이트 배열**이라야 한다
 * (문자열을 그대로 넘기면 크로뮴은 받아 주지만 사파리가 거부한다).
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  // `ArrayBuffer`를 **먼저 만들고** 그 위에 뷰를 얹는다 — `new Uint8Array(n)`의
  // 타입은 `ArrayBufferLike`(SharedArrayBuffer일 수도 있다)라 `BufferSource`를
  // 받는 `applicationServerKey`에 그대로 들어가지 않는다.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** ArrayBuffer → base64url(서버가 저장할 꼴). */
function bufToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}

/**
 * 이 브라우저에서 푸시를 쓸 수 있는가 — 키가 없으면 **쓸 수 없는 것으로 본다**.
 *
 * **API가 있다고 쓸 수 있는 것이 아니다**: 설치형 셸(Electron)과 Capacitor WebView는
 * `PushManager`가 창에 **있으면서도** 구독이 실패한다(둘 다 푸시 서비스에 연결돼
 * 있지 않다 — Electron은 GCM 채널이 없고, 안드로이드 WebView는 FCM을 우리 쪽에서
 * 붙여야 한다). 그 둘을 이름으로 먼저 걸러 내지 않으면 설정에 **눌러도 아무 일이
 * 없는 스위치**가 선다. 그쪽에는 각자의 길이 이미 있다 — 데스크톱은 트레이 상주
 * (`geurio:notify`), 모바일은 로컬 알림.
 */
export function pushAvailable(): boolean {
  if (!VAPID_PUBLIC_KEY) return false;
  if (isDesktopShell() || nativeNotificationsAvailable()) return false;
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export interface PushSubscriptionInfo {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 지금 이 브라우저가 구독돼 있는가(있으면 그 정보). */
export async function currentPushSubscription(): Promise<PushSubscriptionInfo | null> {
  if (!pushAvailable()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    return {
      endpoint: sub.endpoint,
      p256dh: bufToBase64(sub.getKey('p256dh')),
      auth: bufToBase64(sub.getKey('auth')),
    };
  } catch {
    return null;
  }
}

/**
 * 구독을 만든다(이미 있으면 그대로 돌려준다).
 *
 * 권한을 **여기서 묻는다** — 호출부가 사용자의 클릭 안에서 부르므로 저절로 뜨는
 * 권한 창이 되지 않는다(일정 알림 스위치와 같은 규칙). 거절당하면 `null`이다.
 */
export async function subscribePush(): Promise<PushSubscriptionInfo | null> {
  if (!pushAvailable()) return null;
  try {
    if (Notification.permission === 'denied') return null;
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return null;
    }
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        // 브라우저 규칙: 푸시를 받으면 **반드시 알림을 띄워야** 한다. 조용한 푸시를
        // 허용하는 브라우저는 없고, 어기면 구독이 거둬진다(push-sw.js의 기본 문장이
        // 그래서 있다).
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    return {
      endpoint: sub.endpoint,
      p256dh: bufToBase64(sub.getKey('p256dh')),
      auth: bufToBase64(sub.getKey('auth')),
    };
  } catch (e) {
    console.warn('[geurio] 푸시 구독에 실패했어요:', e);
    return null;
  }
}

/**
 * 이 브라우저의 구독을 거둔다. 돌려주는 값은 **거둔 엔드포인트**다 — 서버에서
 * 지울 행을 그것으로 찾는다(`unsubscribe()` 뒤에는 객체가 사라진다).
 */
export async function unsubscribePush(): Promise<string | null> {
  if (!pushAvailable()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

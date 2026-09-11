// 알림의 **기기 쪽 상태** — 켜 뒀는가, 이미 띄운 것은 무엇인가, OS 알림 권한.
//
// 왜 이 기기(localStorage)인가: OS 알림 권한 자체가 기기·브라우저마다 따로다.
// "이 노트북에서는 받고 회사 PC에서는 안 받는다"가 자연스러운 설정이라, 스페이스·
// 테마처럼 기기 간에 따라오면 오히려 어긋난다.

import {
  checkNativeNotifyPermission,
  nativeNotificationsAvailable,
  requestNativeNotifyPermission,
} from '../../platform/nativeNotifications';

/** 알림을 받을까 — 없으면 **켜짐**이다(아래 근거). */
const PREF_KEY = 'mf_reminders';
/** 구글 일정 알림도 우리가 띄울까 — 없으면 **꺼짐**이다(아래 근거). */
const GOOGLE_PREF_KEY = 'mf_reminders_google';
/** 이미 띄운 알림 — `키@알림시각` → 띄운 시각(ms). */
const FIRED_KEY = 'mf_reminded';
/** 기억을 비우는 나이 — 하루면 충분하다(유예는 5분이고 시간은 앞으로만 간다). */
const FIRED_TTL_MS = 24 * 60 * 60_000;
/** 기억 상한(오래된 것부터 버린다) — 저장소를 무한히 먹지 않게. */
const FIRED_MAX = 200;

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * 기본값이 **켜짐**인 이유: 이 스위치는 "알림을 만들어 낸다"가 아니라 "내가 건 알림을
 * 받는다"다. 일정마다의 알림은 기본이 `없음`이므로, 사용자가 직접 고르지 않으면
 * 아무것도 뜨지 않는다 — 여기서 꺼짐으로 시작하면 방금 고른 알림이 이유 없이 안 온다.
 */
export function remindersEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRemindersEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* 저장소가 막혀도 이번 세션에서는 아래 알림으로 동작한다 */
  }
  listeners.forEach((fn) => fn());
}

/**
 * 구글 일정에 걸린 알림도 **우리가** 띄울까(2단계).
 *
 * 기본이 **꺼짐**인 이유는 Geurio 알림과 정반대다: 구글 일정의 알림은 **구글이 이미
 * 보낸다**(구글 캘린더 앱·브라우저 알림). 켜진 채로 시작하면 같은 회의에 알림이 둘
 * 뜨는 것이 기본 동작이 된다 — 그건 고장으로 읽힌다. 그래서 "구글 알림을 안 받는
 * 기기에서 그리오만 켜 두고 쓴다"는 사람이 직접 켜는 값이다.
 *
 * 기기별인 것도 같은 이유다 — 구글 알림을 받는지 여부가 기기마다 다르다.
 */
export function googleRemindersEnabled(): boolean {
  try {
    return localStorage.getItem(GOOGLE_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGoogleRemindersEnabled(on: boolean): void {
  try {
    localStorage.setItem(GOOGLE_PREF_KEY, on ? '1' : '0');
  } catch {
    /* 저장소가 막혀도 이번 세션에서는 아래 알림으로 동작한다 */
  }
  listeners.forEach((fn) => fn());
}

/** 설정에서 토글하면 **열려 있는 모든 화면**의 스케줄러가 따라와야 한다. */
export function onRemindersEnabledChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readFired(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function firedKey(key: string, fireAt: number): string {
  // 알림 시각을 키에 넣는다 — 일정을 옮기면 새 키가 되어 **다시 뜬다**(그게 맞다).
  return `${key}@${fireAt}`;
}

/**
 * 이미 띄웠나. **띄우기 바로 앞에서 저장소를 새로 읽는다** — 탭이 여럿이면 각자
 * 주기 확인을 돌리므로, React 상태로 판단하면 같은 알림이 두 번 뜬다.
 */
export function wasReminderFired(key: string, fireAt: number): boolean {
  return firedKey(key, fireAt) in readFired();
}

export function markReminderFired(key: string, fireAt: number, now = Date.now()): void {
  const map = readFired();
  map[firedKey(key, fireAt)] = now;
  const entries = Object.entries(map)
    .filter(([, at]) => now - at < FIRED_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, FIRED_MAX);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 쿼터 초과 — 기억이 알림을 막으면 안 된다(최악의 경우 한 번 더 뜬다) */
  }
}

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** 이 기기에서 OS 알림을 띄울 수 있는가. `unsupported`면 그 자리를 그리지 않는다. */
export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' || p === 'denied' ? p : 'default';
}

/**
 * 권한 요청 — **사용자 제스처에서만** 부른다(설정 토글·알림 고르기). 저절로 물으면
 * 브라우저가 무시하거나, 사용자는 자기가 누르지 않은 창을 보게 된다.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const res = await Notification.requestPermission();
    return res === 'granted' || res === 'denied' ? res : 'default';
  } catch {
    return notifyPermission();
  }
}

/**
 * 이 기기의 알림 권한 — **모바일 앱이면 OS에 묻는다**(3단계).
 *
 * 두 길이 필요한 이유: Capacitor WebView에는 웹 `Notification`이 아예 없다. 그래서
 * `notifyPermission()`만 보면 모바일 앱에서 늘 `unsupported`가 되어 **설정의 알림
 * 행 자체가 그려지지 않았다** — 정작 OS 알림이 가장 값진 곳에서. 네이티브에서는
 * 로컬 알림 플러그인의 권한이 그 답이다.
 */
export async function resolveNotifyPermission(): Promise<NotifyPermission> {
  if (nativeNotificationsAvailable()) return checkNativeNotifyPermission();
  return notifyPermission();
}

/** 권한 요청(웹·네이티브 공용) — 위와 같은 이유로 갈린다. 제스처에서만 부른다. */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (nativeNotificationsAvailable()) return requestNativeNotifyPermission();
  return requestNotifyPermission();
}

/**
 * OS 알림 한 건. 못 띄우면 `false`(호출부는 인앱 토스트로 대신한다 — 알림이 통째로
 * 사라지지 않게). `tag`는 같은 알림이 겹쳐 쌓이지 않게 한다.
 */
export function showOsNotification(opts: { title: string; body: string; tag: string; onClick?: () => void }): boolean {
  if (notifyPermission() !== 'granted') return false;
  try {
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag, icon: '/icons/pwa-192x192.png' });
    if (opts.onClick) {
      n.onclick = () => {
        // 창을 앞으로 — 설치형 앱에서도 이 호출이 창을 띄운다.
        try {
          window.focus();
        } catch {
          /* 포커스를 막는 환경 — 아래 이동은 그대로 한다 */
        }
        opts.onClick?.();
        n.close();
      };
    }
    return true;
  } catch {
    // 일부 환경은 서비스워커 없이 생성자를 막는다(그때는 인앱 토스트만).
    return false;
  }
}

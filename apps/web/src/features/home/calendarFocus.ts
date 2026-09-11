// "일정 화면을 보여 줘" — 홈 **밖**에서(알림 토스트·OS 알림) 그 화면으로 보내는 한 길.
//
// 두 겹이 필요한 이유는 홈이 이미 떠 있는지에 따라 닿는 방법이 다르기 때문이다:
//
// ① **홈이 떠 있으면** 라우터로 `/home`에 가도 다시 마운트되지 않는다(같은 라우트).
//    그래서 구독자(`useHomeController`)에게 알려 그 자리에서 화면을 바꾼다.
// ② **에디터에서 왔으면** 홈이 새로 마운트되고, 그때 컨트롤러는 이 탭이 기억한
//    화면(`mf_active_view`)을 읽는다 — 그래서 기억을 미리 일정 화면으로 고쳐 둔다.
//
// ①이 성립한 뒤에는 컨트롤러의 저장 효과가 같은 값을 다시 쓰므로(멱등) 두 겹이
// 서로를 밟지 않는다.

import { loadActiveView, saveActiveView } from './storage';

/**
 * 무엇을 보여 달라는 요청인가 — **화면만 바꾸는 것으로는 부족하다**(제보: 알림의
 * `일정 보기`를 눌러도 반응이 없다). 이미 일정 화면을 보고 있었으면 화면 전환은
 * 아무 일도 하지 않고, 다른 달을 보던 중이었으면 정작 그 일정이 화면에 없다.
 * 그래서 **그 회차가 놓인 날**까지 함께 들고 간다.
 */
export interface CalendarFocus {
  /** 그 회차가 놓인 날(`YYYY-MM-DD`) — 달을 그리로 옮기고 그 날을 고른다. */
  date: string;
  /** 그 일정 — 상세 팝업까지 연다. 목록이 아직 안 왔으면 도착한 뒤에 뜬다. */
  eventId?: string;
  /** 상세 팝업이 원천마다 다르다(`calEventDetail` vs `calGoogleDetail`). */
  source?: 'geurio' | 'google';
}

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * 아직 아무도 받아 가지 않은 요청. **한 번만 소비된다** — 홈이 떠 있으면 구독자가,
 * 아니면 새로 마운트된 컨트롤러가 가져간다. 모듈 변수라 SPA 이동(에디터 → 홈)은
 * 그대로 살아남고, 페이지가 통째로 새로 뜨면 사라진다(그때는 예전처럼 화면만 바뀐다).
 */
let pending: CalendarFocus | null = null;

export function focusCalendar(target?: CalendarFocus): void {
  const cur = loadActiveView();
  // 스페이스·폴더는 그대로 둔다 — 일정 화면을 닫으면 돌아갈 자리다(없는 스페이스는
  // 컨트롤러가 걸러 낸다).
  saveActiveView({
    activeSpace: cur?.activeSpace ?? '',
    curFolder: cur?.curFolder ?? null,
    activeDash: null,
    activeCal: true,
  });
  // 알리기 **전에** 세워 둔다 — 구독자가 그 자리에서 가져간다.
  pending = target ?? null;
  listeners.forEach((fn) => fn());
}

/** 받아 가면서 비운다 — 같은 요청으로 두 번 화면을 흔들지 않게. */
export function takeCalendarFocus(): CalendarFocus | null {
  const target = pending;
  pending = null;
  return target;
}

export function onCalendarFocus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

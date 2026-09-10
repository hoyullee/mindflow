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

type Listener = () => void;
const listeners = new Set<Listener>();

export function focusCalendar(): void {
  const cur = loadActiveView();
  // 스페이스·폴더는 그대로 둔다 — 일정 화면을 닫으면 돌아갈 자리다(없는 스페이스는
  // 컨트롤러가 걸러 낸다).
  saveActiveView({
    activeSpace: cur?.activeSpace ?? '',
    curFolder: cur?.curFolder ?? null,
    activeDash: null,
    activeCal: true,
  });
  listeners.forEach((fn) => fn());
}

export function onCalendarFocus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

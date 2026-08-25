import { useEffect, useState } from 'react';

/**
 * 네트워크 연결 여부 — `navigator.onLine`을 **그대로 믿지 않는다**.
 *
 * 이 플래그는 "랜선이 꽂혀 있다" 수준의 신호라 두 방향 모두로 틀린다:
 * 캡티브 포털에서는 `true`인데 못 나가고(그건 저장 결과가 잡는다), 반대로
 * VPN·가상 네트워크 어댑터가 있는 환경에서는 **멀쩡히 연결돼 있는데 `false`**가 된다
 * (제보: 라이브에서 로그인·문서 로드가 다 되는데 홈·에디터가 "오프라인"이라고 했다).
 * 사용자에게 "오프라인"이라고 말하는 것은 저장이 멈춘 것처럼 읽히므로, 플래그가
 * 오프라인이라고 할 때는 **진짜 요청을 한 번 보내 확인한 뒤에** 그렇게 말한다.
 *
 * 확인 요청은 서비스 워커가 가로채지 않는 주소로 보낸다 — precache에 없고
 * (`globPatterns`) 내비게이션도 아니라(`navigateFallback`은 navigate 요청만),
 * 어떤 라우트에도 걸리지 않아 그대로 네트워크로 나간다. 응답 내용은 보지 않는다:
 * **서버에 닿았다는 사실 자체**가 연결의 증거다(404·리라이트 200 모두 좋다).
 */
const PROBE_URL = '/__net-check';
const PROBE_TIMEOUT_MS = 5000;
/** 플래그가 거짓말일 때(오프라인이라는데 실제로는 연결됨) 진짜 끊김을 놓치지 않게
 *  다시 확인하는 주기 — 그런 기기에서만 돈다. */
const RECHECK_MS = 30_000;

async function reachable(): Promise<boolean> {
  if (typeof fetch !== 'function') return true; // 확인할 수단이 없으면 낙관한다
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    await fetch(`${PROBE_URL}?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl?.signal });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useOnline(): boolean {
  // 낙관으로 시작한다 — 확인하기 전에는 "오프라인"이라고 말하지 않는다.
  // 진짜 오프라인이면 아래 확인이 곧바로(요청이 즉시 실패한다) 바로잡는다.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const verify = async (): Promise<void> => {
      clear();
      const ok = await reachable();
      if (!alive) return;
      setOnline(ok);
      // 플래그는 오프라인인데 실제로는 연결된 기기 — 'online' 이벤트가 올 리 없으므로
      // 주기적으로 다시 확인한다(진짜 끊기면 그때 바를 띄운다).
      if (ok && typeof navigator !== 'undefined' && navigator.onLine === false) {
        timer = setTimeout(() => void verify(), RECHECK_MS);
      }
    };
    const up = (): void => {
      clear();
      setOnline(true); // 연결됐다는 신호는 확인 없이 믿어도 손해가 없다
    };
    const down = (): void => void verify();
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) void verify();
    return () => {
      alive = false;
      clear();
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

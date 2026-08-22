/**
 * "이 브라우저에서 로그인 유지" — 로그인 화면의 체크박스가 켜고 끄는 값.
 *
 * 체크를 끄면 세션을 **탭 저장소(sessionStorage)** 에 둔다. 그러면 창을 닫는
 * 순간 사라져 공용 PC에서 다음 사람이 그대로 들어오는 일이 없다. 켜 두면
 * 지금까지처럼 localStorage에 남아 다음에 와도 로그인된 상태다(기본값).
 *
 * 어느 저장소를 쓸지는 **읽을 때마다** 판단하지 않는다 — 읽기는 두 곳을 다
 * 보고(탭 저장소 먼저), 쓰기만 이 값에 따라 갈린다. 그래서 이미 로그인해 둔
 * 사람의 세션이 체크를 끄는 순간 사라지지 않는다.
 */

const REMEMBER_KEY = 'mf_remember';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    // 사생활 보호 모드·저장소 차단 환경에서 접근 자체가 던진다.
    return fallback;
  }
}

/** 기본값은 **유지**(true) — 지금까지의 동작이고, 대부분은 자기 기기에서 쓴다. */
export function rememberSession(): boolean {
  return safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
}

export function setRememberSession(remember: boolean): void {
  safe(() => {
    if (remember) localStorage.removeItem(REMEMBER_KEY);
    else localStorage.setItem(REMEMBER_KEY, '0');
  }, undefined);
}

function writeStore(): Storage | null {
  return safe(() => (rememberSession() ? localStorage : sessionStorage), null);
}

/**
 * Supabase Auth와 로컬(데모) 인증이 함께 쓰는 세션 저장소. 읽기는 탭 저장소를
 * 먼저 보고 없으면 localStorage를, 쓰기는 위 규칙이 고른 곳에, 지우기는 두 곳
 * 모두에서 — 로그아웃이 반쪽으로 남지 않게.
 */
export const authSessionStorage = {
  getItem(key: string): string | null {
    return safe(() => sessionStorage.getItem(key), null) ?? safe(() => localStorage.getItem(key), null);
  },
  setItem(key: string, value: string): void {
    const store = writeStore();
    if (!store) return;
    safe(() => store.setItem(key, value), undefined);
    // 유지를 끈 경우 이전에 남아 있던 localStorage 사본은 치운다(그게 살아 있으면
    // 창을 닫아도 다음에 그 사본으로 로그인된다 — 끈 뜻과 반대).
    if (store !== localStorage) safe(() => localStorage.removeItem(key), undefined);
  },
  removeItem(key: string): void {
    safe(() => sessionStorage.removeItem(key), undefined);
    safe(() => localStorage.removeItem(key), undefined);
  },
};

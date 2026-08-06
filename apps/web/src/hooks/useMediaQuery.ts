import { useEffect, useState } from 'react';

/**
 * Single mobile/desktop breakpoint for the whole app (M6). Below this width,
 * layouts switch to their mobile variant (drawer nav, bottom-sheet property
 * panel, stacked login form, etc.) — see CLAUDE.md's "브레이크포인트 일관되게(예: 768px)".
 */
export const MOBILE_BREAKPOINT = 768;

function getMatches(query: string): boolean {
  // jsdom (our unit-test environment) doesn't implement `matchMedia`, so this
  // safely falls back to "desktop" — matching every pre-M6 test's assumptions
  // — unless a test explicitly stubs `window.matchMedia`.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Live-updating `matchMedia` subscription (SSR/jsdom-safe). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const listener = (e: MediaQueryListEvent): void => setMatches(e.matches);
    setMatches(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
    // Safari <14 fallback.
    mql.addListener(listener);
    return () => mql.removeListener(listener);
  }, [query]);

  return matches;
}

/** `true` below {@link MOBILE_BREAKPOINT}px — the app-wide mobile/desktop switch. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/** 화면이 **낮은가**(가로로 돌린 폰 등). 세로 공간을 크게 먹는 UI(속성 바텀시트·
 * 드롭다운)는 이 조건에서 배치를 바꾼다 — 가로 폰은 높이가 350~430px 남짓이라
 * 55dvh 시트를 그대로 두면 캔버스가 거의 남지 않는다. */
export const SHORT_SCREEN_MAX_HEIGHT = 500;

export function useIsShortScreen(): boolean {
  return useMediaQuery(`(max-height: ${SHORT_SCREEN_MAX_HEIGHT}px)`);
}

/**
 * 손가락으로 쓰는 기기인가 — 호버가 없고 포인터가 굵다(폰·태블릿). 마우스가 달린
 * 터치 노트북은 `hover: hover`라 여기 걸리지 않는다.
 *
 * 폭(`useIsMobile`)이 아니라 **입력 방식**을 묻는 이유: 소프트 키보드에는 Shift가
 * 사실상 없어서 "Shift+Enter=줄바꿈" 같은 규칙이 성립하지 않는다. 이건 화면 크기가
 * 아니라 키보드의 문제이므로, 가로로 돌려 폭이 넓어져도 판정이 바뀌면 안 된다.
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}

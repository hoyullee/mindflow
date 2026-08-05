/**
 * jsdom doesn't implement `window.matchMedia` (confirmed: it's `undefined`),
 * which is exactly why `useIsMobile`/`useMediaQuery` (src/hooks/useMediaQuery.ts)
 * fall back to "desktop" when it's missing — that's what keeps every
 * pre-M6 test passing unmodified. Mobile-layout tests need to explicitly
 * install a stub that reports a match, which is what this helper does.
 *
 * `matches`는 **폭** 질의(`max-width` = 모바일/데스크톱 스위치)에만 적용한다.
 * **높이** 질의(`max-height` = 가로로 돌린 폰 판정, `useIsShortScreen`)는 jsdom의
 * 실제 창 높이로 답한다 — "모바일이면 무조건 참"으로 두면 세로 폰 테스트가 전부
 * 가로 폰(낮은 화면) 레이아웃을 받아, 뜻하지 않은 배치를 검사하게 된다.
 */
export function mockMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const maxH = /max-height:\s*(\d+)px/.exec(query);
    const mql = {
      matches: maxH ? window.innerHeight <= Number(maxH[1]) : matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return () => {
    window.matchMedia = original;
  };
}

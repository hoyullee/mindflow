/**
 * jsdom doesn't implement `window.matchMedia` (confirmed: it's `undefined`),
 * which is exactly why `useIsMobile`/`useMediaQuery` (src/hooks/useMediaQuery.ts)
 * fall back to "desktop" when it's missing — that's what keeps every
 * pre-M6 test passing unmodified. Mobile-layout tests need to explicitly
 * install a stub that reports a match, which is what this helper does.
 */
export function mockMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const mql = {
      matches,
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

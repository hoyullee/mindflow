// 설치형 데스크톱 앱(Electron 셸, `apps/desktop/`)에서 돌고 있는지 알아보고,
// 그 셸이 내주는 것만 쓴다. 웹 앱은 **같은 번들 하나**로 브라우저·PWA·데스크톱
// 셸에서 모두 돌아가므로(셸이 원격 출처를 그대로 띄운다) 이 모듈은 언제나
// import되고, 셸이 없으면 모든 함수가 조용히 아무 일도 하지 않는다.
//
// 창구는 preload가 `contextBridge`로 심어 준 `window.geurio` 하나뿐이다
// (apps/desktop/src/preload.ts) — 렌더러는 Node에 닿을 수 없다.

export interface DesktopBridge {
  desktop: true;
  version: string;
  platform: string;
  openExternal(url: string): Promise<boolean>;
  onDeepLink(handler: (url: string) => void): () => void;
  takePendingDeepLink(): Promise<string | null>;
}

declare global {
  interface Window {
    geurio?: DesktopBridge;
  }
}

/** 셸이 심어 준 창구 — 브라우저·PWA·테스트에서는 언제나 `null`. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = window.geurio;
  return b && b.desktop === true ? b : null;
}

/** 설치형 데스크톱 앱에서 돌고 있는가. */
export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

/**
 * 시스템 브라우저에서 연다. 셸에서는 그 창구로, 브라우저에서는 평범한 새 탭.
 * 데스크톱 앱 창은 우리 출처만 띄우므로(셸의 `isInternalUrl`) 남의 주소는
 * 반드시 이 길을 지나야 한다 — 그러지 않으면 셸이 막아 아무 일도 일어나지 않는다.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    await bridge.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

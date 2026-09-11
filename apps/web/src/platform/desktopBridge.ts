// 설치형 데스크톱 앱(Electron 셸, `apps/desktop/`)에서 돌고 있는지 알아보고,
// 그 셸이 내주는 것만 쓴다. 웹 앱은 **같은 번들 하나**로 브라우저·PWA·데스크톱
// 셸에서 모두 돌아가므로(셸이 원격 출처를 그대로 띄운다) 이 모듈은 언제나
// import되고, 셸이 없으면 모든 함수가 조용히 아무 일도 하지 않는다.
//
// 창구는 preload가 `contextBridge`로 심어 준 `window.geurio` 하나뿐이다
// (apps/desktop/src/preload.ts) — 렌더러는 Node에 닿을 수 없다.

/**
 * 창을 닫아도 앱이 남을까(4단계) — 셸이 돌려주는 상태 그대로다
 * (`apps/desktop/src/shell.ts`의 같은 이름). **`supported`가 거짓이면 설정에서
 * 그 자리를 그리지 않는다**: 되돌아올 길(트레이·독)이 없어 상주 자체가 불가능한
 * 환경이라, 켜 봐야 아무 일도 일어나지 않는다.
 */
export interface DesktopBackground {
  supported: boolean;
  enabled: boolean;
  loginSupported: boolean;
  openAtLogin: boolean;
}

export interface DesktopBridge {
  desktop: true;
  version: string;
  platform: string;
  /**
   * 셸이 프레임을 숨기고 **우리가 그려야 하는** 타이틀 바 높이(px).
   * `0`이거나 없으면 그리지 않는다 — OS 프레임을 그대로 쓰는 플랫폼이거나,
   * 이 값을 내주지 않는 **옛 셸**이다(이미 설치돼 있는 판). 그래서 폴백이
   * 0이어야 한다: 40으로 두면 옛 설치본에서 네이티브 프레임 아래에 우리 바가
   * 한 겹 더 그려진다.
   */
  titleBarHeight?: number;
  /** 네이티브 창 컨트롤 색을 지금 테마에 맞춘다(Windows 전용, 셸이 hex만 받는다). */
  setTitleBarTheme?(color: string, symbolColor: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  onDeepLink(handler: (url: string) => void): () => void;
  takePendingDeepLink(): Promise<string | null>;
  /** 아래 넷은 **4단계 셸부터** 있다 — 옛 설치본에는 없으므로 전부 선택이다. */
  backgroundState?(): Promise<DesktopBackground>;
  setBackground?(on: boolean): Promise<DesktopBackground>;
  setOpenAtLogin?(on: boolean): Promise<DesktopBackground>;
  focusWindow?(): Promise<boolean>;
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

/** 우리가 그릴 타이틀 바 높이 — 브라우저·PWA·옛 셸에서는 0(=그리지 않는다). */
export function desktopTitleBarHeight(): number {
  const h = desktopBridge()?.titleBarHeight;
  return typeof h === 'number' && h > 0 ? h : 0;
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

/**
 * 상주 상태를 읽는다. 셸이 아니거나 **옛 셸**이면 `null` — 그때는 설정에 그 자리를
 * 두지 않는다(4단계 이전 설치본은 창을 닫으면 그냥 종료된다).
 */
export async function desktopBackgroundState(): Promise<DesktopBackground | null> {
  const b = desktopBridge();
  if (!b?.backgroundState) return null;
  try {
    return await b.backgroundState();
  } catch {
    // 셸과의 왕복이 실패하면 모르는 것으로 둔다 — 없는 상태를 지어내지 않는다.
    return null;
  }
}

export async function setDesktopBackground(on: boolean): Promise<DesktopBackground | null> {
  const b = desktopBridge();
  if (!b?.setBackground) return null;
  try {
    return await b.setBackground(on);
  } catch {
    return null;
  }
}

export async function setDesktopOpenAtLogin(on: boolean): Promise<DesktopBackground | null> {
  const b = desktopBridge();
  if (!b?.setOpenAtLogin) return null;
  try {
    return await b.setOpenAtLogin(on);
  } catch {
    return null;
  }
}

/**
 * 숨어 있는 창을 되찾는다 — **OS 알림을 눌렀을 때** 이 길로 온다. 상주 중에는
 * 창이 감춰져 있어 렌더러의 `window.focus()`만으로는 나타나지 않는다.
 * 브라우저·PWA에서는 아무 일도 하지 않는다(그쪽은 창이 이미 있다).
 */
export function focusDesktopWindow(): void {
  const b = desktopBridge();
  if (!b?.focusWindow) return;
  void b.focusWindow().catch(() => undefined);
}

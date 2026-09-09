// 렌더러(웹 앱)와 셸 사이의 **유일한 창구**. `contextIsolation: true`라
// 렌더러는 Node에 닿을 수 없고, 여기서 `contextBridge`로 내주는 것만 볼 수 있다.
//
// 내주는 것을 일부러 좁게 뒀다 — 원격 출처(geurio.com)를 띄우는 셸이므로, 그
// 페이지가 무엇을 할 수 있는지가 곧 이 목록이다. 파일시스템·셸 실행·임의
// IPC는 내주지 않는다.
import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL_DEEP_LINK = 'geurio:deep-link';
const CHANNEL_OPEN_EXTERNAL = 'geurio:open-external';
const CHANNEL_PENDING_DEEP_LINK = 'geurio:pending-deep-link';
const CHANNEL_TITLEBAR_THEME = 'geurio:titlebar-theme';

export interface GeurioDesktopBridge {
  /** 이 값의 존재가 곧 "데스크톱 앱에서 돌고 있다"다 — 웹 쪽 판정이 이걸 본다. */
  desktop: true;
  /** 셸 버전(설치 파일 버전) — 문의·제보에 실어 보낸다. */
  version: string;
  platform: NodeJS.Platform;
  /**
   * 우리가 그려야 하는 타이틀 바 높이(px). **0이면 그리지 않는다** — 셸이 OS
   * 프레임을 그대로 쓰는 플랫폼이라는 뜻이다(`usesCustomTitleBar`). 이 값을
   * 아예 내주지 않는 **옛 셸**도 있으므로 웹 쪽 폴백도 0이어야 한다.
   */
  titleBarHeight: number;
  /**
   * 네이티브 창 컨트롤의 면·심볼 색을 지금 테마에 맞춘다(Windows 전용, 그 밖에서는
   * 아무 일도 하지 않는다). `#rgb`·`#rrggbb`만 받는다.
   */
  setTitleBarTheme(color: string, symbolColor: string): Promise<boolean>;
  /** 시스템 브라우저에서 연다(주소창이 있는 곳). 우리 셸 창은 우리 출처만 띄운다. */
  openExternal(url: string): Promise<boolean>;
  /**
   * `geurio://…` 딥링크 구독. 앱이 **꺼져 있는 동안** 온 링크는 셸이 들고
   * 있다가 렌더러가 붙는 순간 넘겨주므로(`takePendingDeepLink`) 놓치지 않는다.
   */
  onDeepLink(handler: (url: string) => void): () => void;
  /** 앱이 뜨기 전에 도착해 셸이 들고 있던 딥링크를 가져간다(한 번만). */
  takePendingDeepLink(): Promise<string | null>;
}

/**
 * 샌드박스 preload에는 Node가 없고 `process`도 일부만 폴리필된다 — 그래서 셸이
 * `additionalArguments`로 넘겨 준 값을 argv에서 읽는다(문서화된 전달 경로).
 */
function readArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

const bridge: GeurioDesktopBridge = {
  desktop: true,
  version: readArg('--geurio-version') ?? '0.0.0',
  platform: process.platform,
  titleBarHeight: Number(readArg('--geurio-titlebar') ?? 0) || 0,
  setTitleBarTheme: (color, symbolColor) =>
    ipcRenderer.invoke(CHANNEL_TITLEBAR_THEME, color, symbolColor) as Promise<boolean>,
  openExternal: (url) => ipcRenderer.invoke(CHANNEL_OPEN_EXTERNAL, url) as Promise<boolean>,
  onDeepLink: (handler) => {
    const listener = (_e: unknown, url: string) => handler(url);
    ipcRenderer.on(CHANNEL_DEEP_LINK, listener);
    return () => ipcRenderer.removeListener(CHANNEL_DEEP_LINK, listener);
  },
  takePendingDeepLink: () => ipcRenderer.invoke(CHANNEL_PENDING_DEEP_LINK) as Promise<string | null>,
};

contextBridge.exposeInMainWorld('geurio', bridge);

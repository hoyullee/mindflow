// 렌더러(웹 앱)와 셸 사이의 **유일한 창구**. `contextIsolation: true`라
// 렌더러는 Node에 닿을 수 없고, 여기서 `contextBridge`로 내주는 것만 볼 수 있다.
//
// 내주는 것을 일부러 좁게 뒀다 — 원격 출처(geurio.com)를 띄우는 셸이므로, 그
// 페이지가 무엇을 할 수 있는지가 곧 이 목록이다. 파일시스템·셸 실행·임의
// IPC는 내주지 않는다.
import { contextBridge, ipcRenderer } from 'electron';
import type { BackgroundState } from './shell';

const CHANNEL_DEEP_LINK = 'geurio:deep-link';
const CHANNEL_OPEN_EXTERNAL = 'geurio:open-external';
const CHANNEL_PENDING_DEEP_LINK = 'geurio:pending-deep-link';
const CHANNEL_TITLEBAR_THEME = 'geurio:titlebar-theme';
const CHANNEL_BACKGROUND_STATE = 'geurio:background-state';
const CHANNEL_SET_BACKGROUND = 'geurio:set-background';
const CHANNEL_SET_OPEN_AT_LOGIN = 'geurio:set-open-at-login';
const CHANNEL_FOCUS_WINDOW = 'geurio:focus-window';
const CHANNEL_NOTIFY = 'geurio:notify';
const CHANNEL_NOTIFY_SUPPORTED = 'geurio:notify-supported';
const CHANNEL_NOTIFICATION_CLICK = 'geurio:notification-click';

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
  /**
   * 창을 닫아도 앱이 남을까(4단계) — 설정 화면이 이 상태를 그린다.
   * `supported`가 거짓이면 **그 자리를 그리지 않는다**(되돌아올 길이 없어 상주
   * 자체가 불가능한 환경이다).
   */
  backgroundState(): Promise<BackgroundState>;
  /** 상주를 켜고 끈다. 돌려주는 것은 **바뀐 뒤의 상태**다(사본이 갈리지 않게). */
  setBackground(on: boolean): Promise<BackgroundState>;
  /** 로그인할 때 자동 실행(창 없이). OS에서 **다시 읽은** 상태를 돌려준다. */
  setOpenAtLogin(on: boolean): Promise<BackgroundState>;
  /** 숨어 있는 창을 되찾는다 — OS 알림을 눌렀을 때 이 길로 온다. */
  focusWindow(): Promise<boolean>;
  /**
   * 이 기기가 OS 알림을 띄울 수 있는가(`Notification.isSupported()`). 설정 화면이
   * **묻고 나서** 말한다 — 못 띄우는 기기에 "OS 알림도 함께 떠요"라고 하지 않게.
   */
  notifySupported(): Promise<boolean>;
  /**
   * OS 알림 한 건을 **셸이** 띄운다(제보: Windows 앱에서 알림이 오지 않는다).
   * 렌더러의 `new Notification()`은 Chromium 정책을 여러 겹 지나고 무엇이 막혔는지
   * 알려 주지 않는다 — 여기서는 띄웠는지 여부가 그대로 돌아온다.
   */
  notify(payload: { title: string; body: string; tag: string }): Promise<boolean>;
  /** 그 알림을 눌렀을 때 — 넘겨 준 `tag`가 그대로 돌아온다. */
  onNotificationClick(handler: (tag: string) => void): () => void;
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
  backgroundState: () => ipcRenderer.invoke(CHANNEL_BACKGROUND_STATE) as Promise<BackgroundState>,
  setBackground: (on) => ipcRenderer.invoke(CHANNEL_SET_BACKGROUND, on) as Promise<BackgroundState>,
  setOpenAtLogin: (on) => ipcRenderer.invoke(CHANNEL_SET_OPEN_AT_LOGIN, on) as Promise<BackgroundState>,
  focusWindow: () => ipcRenderer.invoke(CHANNEL_FOCUS_WINDOW) as Promise<boolean>,
  notifySupported: () => ipcRenderer.invoke(CHANNEL_NOTIFY_SUPPORTED) as Promise<boolean>,
  notify: (payload) => ipcRenderer.invoke(CHANNEL_NOTIFY, payload) as Promise<boolean>,
  onNotificationClick: (handler) => {
    const listener = (_e: unknown, tag: string) => handler(tag);
    ipcRenderer.on(CHANNEL_NOTIFICATION_CLICK, listener);
    return () => ipcRenderer.removeListener(CHANNEL_NOTIFICATION_CLICK, listener);
  },
};

contextBridge.exposeInMainWorld('geurio', bridge);

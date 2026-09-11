// Geurio 데스크톱 셸 — 설치형 앱의 껍데기다. 앱 자체(React SPA)는 웹과 **같은
// 것**을 띄운다: 원격 출처(`https://geurio.com`)를 그대로 로드한다.
//
// 왜 번들이 아니라 원격인가:
//   1) **로그인이 성립한다** — 구글 로그인은 우리 출처가 콘솔에 등록돼 있어야
//      한다. 산출물을 `app://` 같은 커스텀 스킴으로 띄우면 그 출처는 등록될 수
//      없어(스킴부터 다르다) Google·Supabase 인증이 통째로 막힌다.
//   2) **판이 갈리지 않는다** — 설치본을 다시 배포하지 않아도 웹 배포가 곧
//      데스크톱 앱의 판이다(Slack·Notion과 같은 방식).
//   3) **오프라인도 그대로** — 웹 앱의 서비스 워커가 앱 셸을 캐시하므로, 한 번
//      띄운 뒤에는 네트워크가 없어도 열린다. 첫 실행에서 못 닿았을 때만
//      `resources/offline.html`이 사유와 다시 시도를 안내한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type Rectangle,
} from 'electron';
import {
  APP_USER_MODEL_ID,
  appMenuSpec,
  canStayInBackground,
  clampBounds,
  closeNoticeBody,
  coerceShellPrefs,
  HIDDEN_FLAG,
  shouldStartHidden,
  supportsOpenAtLogin,
  usesTray,
  DEEP_LINK_SCHEME,
  isHexColor,
  TITLEBAR_HEIGHT,
  titleBarHeightFor,
  usesCustomTitleBar,
  DEFAULT_APP_URL,
  deepLinkFromArgv,
  isBrowserShortcut,
  isDeepLink,
  isDevToolsShortcut,
  isInternalUrl,
  isLandingPath,
  isSafeExternalUrl,
  MIN_HEIGHT,
  MIN_WIDTH,
  originOf,
  type BackgroundState,
  type Bounds,
  type KeyInput,
  type ShellPrefs,
} from './shell';

const APP_URL = process.env.GEURIO_APP_URL || DEFAULT_APP_URL;
const APP_ORIGIN = originOf(APP_URL);
/** 로그인 화면의 배경색 — 첫 페인트 전 흰 섬광을 막는다(웹의 `--mf-bg`와 같은 값). */
const BACKGROUND = '#fbf6f2';
/**
 * 타이틀 바의 첫 색 — 네이티브 창 컨트롤(최소화·최대화·닫기)이 그려질 면이다.
 * 웹 앱의 `--mf-card`·`--mf-subtext`(코랄 테마 기본값)와 같은 값으로 두고,
 * 사용자가 테마를 바꾸면 렌더러가 `geurio:titlebar-theme`로 새 색을 알려 준다
 * (그러지 않으면 다크 테마의 어두운 바에 흰 컨트롤이 홀로 남는다).
 */
const TITLEBAR_BG = '#fffdfb';
const TITLEBAR_INK = '#7c6d60';

/**
 * 개발자 도구를 열어 줄까 — 배포본에서는 기능이 아니지만(사용자에게는 앱이 고장
 * 난 것처럼 보인다) 실기기 진단은 이 창이 유일한 길이라 완전히 없애지 않는다.
 * 개발 실행이거나 `GEURIO_DEVTOOLS=1`로 켰을 때만 연다.
 */
const DEVTOOLS_ENABLED = !app.isPackaged || process.env.GEURIO_DEVTOOLS === '1';

let mainWindow: BrowserWindow | null = null;
/** 앱이 뜨기 전에 도착한 딥링크 — 렌더러가 붙으면 넘겨준다. */
let pendingDeepLink: string | null = null;
/** 트레이 아이콘. `null`이면 만들지 못했거나 두지 않는 플랫폼(macOS)이다. */
let tray: Tray | null = null;
/** 진짜 종료 중인가 — 닫기를 숨기기로 바꾸는 규칙이 종료까지 막으면 안 된다. */
let quitting = false;
let prefs: ShellPrefs = coerceShellPrefs(null);

/** 로그인 자동 실행에 함께 등록하는 인자 — 넣을 때와 읽을 때가 같아야 한다. */
const LOGIN_ARGS = [HIDDEN_FLAG];

/* ────────────────────────────── 창 크기 기억 ────────────────────────────── */

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readSavedBounds(): Partial<Bounds> | null {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<Bounds>;
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    // 처음 실행이거나 파일이 깨졌다 — 기본 크기로 연다(창 상태 때문에 앱이
    // 뜨지 않는 일은 없어야 한다).
    return null;
  }
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  // 최대화·전체화면 상태의 bounds를 저장하면 다음 실행에서 화면을 꽉 채운 채
  // 복원돼 되돌릴 수 없다 — 평범한 상태의 크기만 기억한다.
  if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(win.getBounds()), 'utf8');
  } catch {
    // 창 크기 기억은 곁다리다 — 실패해도 앱은 그대로 돈다.
  }
}

/* ───────────────────── 셸이 기억하는 설정(상주) ───────────────────── */

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readPrefs(): ShellPrefs {
  try {
    return coerceShellPrefs(JSON.parse(readFileSync(prefsFile(), 'utf8')));
  } catch {
    return coerceShellPrefs(null);
  }
}

function writePrefs(next: ShellPrefs): void {
  prefs = next;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify(next), 'utf8');
  } catch {
    // 저장이 막혀도 이번 실행에서는 위 대입으로 그대로 동작한다.
  }
}

/* ───────────────────────── 트레이 상주(4단계) ───────────────────────── */

/**
 * 숨어 있던 창을 되찾는다 — 트레이 클릭·트레이 메뉴·독 아이콘(`activate`)·딥링크·
 * 알림 클릭이 **모두 이 함수 하나**를 지난다(되찾는 길이 갈리면 한쪽만 고쳐진다).
 */
function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(false);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/**
 * 트레이 아이콘. **상주 설정과 무관하게 앱이 떠 있는 동안 늘 둔다** — 설정을 끈
 * 상태에서 아이콘까지 없애면 `canStayInBackground`가 거짓이 되어 설정 화면의 그
 * 자리가 통째로 사라지고, 다시 켤 길이 없어진다. 아이콘이 하는 말("실행 중이고
 * 누르면 창이 온다")은 설정과 상관없이 언제나 참이다.
 *
 * 만들지 못할 수 있다(트레이가 없는 리눅스 데스크톱) — 그때는 `null`로 남고
 * 상주 자체를 포기한다(숨겼는데 되돌아올 길이 없는 쪽이 훨씬 나쁘다).
 */
function createTray(): void {
  if (tray || !usesTray(process.platform)) return;
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'tray.png'));
    // 파일이 없으면 빈 이미지가 온다 — 보이지 않는 아이콘을 두지 않는다.
    if (icon.isEmpty()) return;
    const t = new Tray(icon);
    t.setToolTip('Geurio');
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Geurio 열기', click: () => showWindow() },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() },
      ]),
    );
    // 왼쪽 클릭은 **열기**다(토글이 아니라) — 트레이를 누르는 손은 창을 찾는 손이다.
    t.on('click', () => showWindow());
    tray = t;
  } catch {
    // 트레이가 없는 환경 — 앱은 그대로 돈다(상주만 못 한다).
  }
}

/** 지금 창을 닫으면 숨길까(=상주할까). 설정이 켜져 있고 되돌아올 길이 있을 때만. */
function backgroundActive(): boolean {
  return prefs.background && canStayInBackground(process.platform, tray !== null);
}

/**
 * 처음 숨길 때 **한 번** 알린다 — 닫았는데 앱이 살아 있는 것은 말해 주지 않으면
 * 고장으로 읽힌다(사용자는 종료한 줄 안다). 끄는 길까지 함께 말한다.
 */
function noticeCloseOnce(): void {
  if (prefs.closeNoticeShown || !Notification.isSupported()) return;
  try {
    const n = new Notification({ title: 'Geurio는 계속 실행돼요', body: closeNoticeBody(process.platform) });
    n.on('click', () => showWindow());
    n.show();
    // **실제로 알린 뒤에만** 표시를 남긴다 — 띄우지 못했는데 "알렸다"고 적으면
    // 사용자는 앱이 어디로 갔는지 영영 듣지 못한다.
    writePrefs({ ...prefs, closeNoticeShown: true });
  } catch {
    // 알림 하나 때문에 앱이 죽을 이유가 없다.
  }
}

/** 렌더러(설정 화면)가 보는 상태 — **OS에서 읽어** 돌려준다(사본을 들지 않는다). */
function backgroundState(): BackgroundState {
  const supported = canStayInBackground(process.platform, tray !== null);
  const loginSupported = supportsOpenAtLogin(process.platform);
  let openAtLogin = false;
  if (loginSupported) {
    try {
      openAtLogin = app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin;
    } catch {
      openAtLogin = false;
    }
  }
  return { supported, enabled: supported && prefs.background, loginSupported, openAtLogin };
}

/* ─────────────────────────────── 창 만들기 ─────────────────────────────── */

function createWindow(startHidden: boolean): BrowserWindow {
  const saved = readSavedBounds();
  const display = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
    ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y })
    : screen.getPrimaryDisplay();
  const bounds = clampBounds(saved, display.workArea as Rectangle as Bounds);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Geurio',
    backgroundColor: BACKGROUND,
    // 창을 다 그린 뒤에 보여 준다 — 빈 창이 먼저 뜨는 것을 막는다.
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    // 프레임을 숨기고 **우리 타이틀 바**를 웹 앱이 그린다(브랜드 마크 + 워드마크).
    // 창 컨트롤은 우리가 그리지 않는다 — 네이티브 오버레이(Windows)·신호등
    // (macOS)이 그대로 남아야 Windows 11의 최대화 호버 스냅 레이아웃, 접근성,
    // 더블클릭 최대화 같은 OS 관례가 공짜로 성립한다.
    ...(usesCustomTitleBar(process.platform)
      ? {
          titleBarStyle: 'hidden' as const,
          ...(process.platform === 'win32'
            ? { titleBarOverlay: { color: TITLEBAR_BG, symbolColor: TITLEBAR_INK, height: TITLEBAR_HEIGHT } }
            : // macOS 신호등을 바 높이 가운데로. 기본 자리는 20px대 타이틀 바 기준이라
              // 40px 바에서는 위쪽에 붙는다.
              { trafficLightPosition: { x: 15, y: Math.round((TITLEBAR_HEIGHT - 16) / 2) } }),
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 원격 출처를 띄우는 셸의 기본값 — 이 셋은 함께여야 뜻이 있다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // 창을 최소화·가려도 렌더러 타이머를 조이지 않는다. 일정 알림이 이 창의
      // 주기 확인으로 뜨므로(`features/reminders/`), 기본값(true)이면 창을 내려 둔
      // 순간 그 확인이 1분에 한 번으로 조여 10:20 알림이 늦게 온다. 브라우저 탭에서는
      // 우리가 정할 수 없어 유예(5분)로 늦은 알림을 받지만, 설치형 앱은 막을 수 있다.
      backgroundThrottling: false,
      additionalArguments: [
        `--geurio-version=${app.getVersion()}`,
        `--geurio-titlebar=${titleBarHeightFor(process.platform)}`,
      ],
    },
  });

  // 앱 창의 키보드 — **브라우저 키를 막는다**(요청: 웹이 아니라 앱으로써).
  // 여기서 preventDefault하면 **렌더러도 그 키를 보지 못한다**(실제 Electron으로
  // 확인). 그래서 무엇을 막는지는 순수 규칙 한 곳(`shell.ts`)이 정하고 그 목록은
  // 테스트가 지킨다 — 앱이 쓰는 키를 잘못 담으면 그 기능이 통째로 죽는다.
  win.webContents.on('before-input-event', (event, input) => {
    const key = input as unknown as KeyInput;
    if (isDevToolsShortcut(key)) {
      // 관례 조합은 언제나 가로챈다 — 열어 주는 것은 켜 뒀을 때만이다.
      event.preventDefault();
      if (DEVTOOLS_ENABLED) win.webContents.toggleDevTools();
      return;
    }
    if (isBrowserShortcut(key)) event.preventDefault();
  });

  // 로그인 자동 실행으로 깨어난 경우에는 **띄우지 않는다** — 창은 만들어져
  // 렌더러(=알림 스케줄러)가 돌지만 화면에는 나타나지 않는다. 컴퓨터를 켤 때마다
  // 창이 튀어나오면 상주가 아니라 방해다.
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });

  // 창 크기 기억: resize/move는 드래그 중 수십 번 오므로 끝난 뒤에만 쓴다.
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveBounds(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // 닫기를 **숨기기**로 바꾼다(4단계) — 창을 파괴하면 렌더러가 사라져 그 순간
  // 일정 알림도 멎는다. `quitting`이 아닌 이유로 닫히는 것만 가로챈다: 트레이의
  // `종료`·⌘Q는 `before-quit`에서 그 깃발을 세우므로 여기를 그대로 지난다.
  win.on('close', (event) => {
    saveBounds(win);
    if (quitting || !backgroundActive()) return;
    event.preventDefault();
    win.hide();
    noticeCloseOnce();
  });

  /* 외부 링크는 **시스템 브라우저**로 — 앱 창은 우리 출처만 띄운다(shell.ts). */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    // 앱 안에 새 창을 열지 않는다: 우리 출처면 같은 창에서 이동하면 되고,
    // 남의 출처는 주소창이 있는 곳에서 열려야 한다.
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, APP_ORIGIN)) {
      // 우리 출처라도 **랜딩은 앱 창에서 열지 않는다**(shell.ts의 `isLandingPath`).
      // `url !== APP_URL`인 이유: 개발·프리뷰에서 `GEURIO_APP_URL`이 루트를 가리킬
      // 수 있고, 그때 그 주소는 곧 앱 자신이다.
      if (url === APP_URL || !isLandingPath(url)) return;
      event.preventDefault();
      void shell.openExternal(url);
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  // 첫 로드가 실패하면(네트워크 없음·서버 점검) 사유를 말한다. 하위 리소스
  // 실패(isMainFrame=false)는 무시한다 — 페이지는 이미 떠 있다.
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED: 우리가 will-navigate로 막은 이동도 여기로 온다.
    if (!isMainFrame || code === -3) return;
    const file = path.join(__dirname, '..', 'resources', 'offline.html');
    void win.loadFile(file, { query: { code: String(code), desc, app: APP_URL } });
  });

  void win.loadURL(APP_URL);
  return win;
}

/* ─────────────────────────────── 딥링크 ─────────────────────────────── */

function handleDeepLink(url: string): void {
  // 우리 스킴이 아니면 버린다 — 렌더러에 아무 문자열이나 넘기지 않는다.
  if (!isDeepLink(url)) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    // 상주 중이면 창이 **숨어 있을 수 있다** — 로그인 핸드오프가 돌아오는 길이라
    // 보이게 하는 것이 먼저다.
    showWindow();
    mainWindow.webContents.send('geurio:deep-link', url);
    return;
  }
  // 아직 창이 없다(앱이 이 링크로 처음 깨어났다) — 들고 있다가 넘겨준다.
  pendingDeepLink = url;
}

/* ─────────────────────────────── 수명 주기 ─────────────────────────────── */

// 두 번째 실행은 새 창을 띄우지 않고 **먼저 뜬 창에 넘긴다** — 딥링크가
// Windows·Linux에서는 새 프로세스의 argv로 오기 때문에 이 잠금이 곧 딥링크
// 경로다(잠금을 못 얻으면 그 인스턴스는 조용히 물러난다).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
    // 두 번째 실행은 곧 "앱을 한 번 더 눌렀다"다 — 숨어 있던 창을 되찾아 준다.
    else showWindow();
  });

  // macOS는 실행 중인 앱에 이벤트로 넘긴다.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // 종료가 시작되면 닫기-숨기기 규칙을 푼다 — 그러지 않으면 앱을 끌 수 없다.
  app.on('before-quit', () => {
    quitting = true;
  });

  app.whenReady().then(() => {
    // Windows가 우리 알림·작업 표시줄 묶음을 알아보는 이름. **알림이 이 단계의
    // 전부**라 여기서 세운다(없으면 토스트가 아예 뜨지 않거나 남의 이름으로 뜬다).
    app.setAppUserModelId(APP_USER_MODEL_ID);
    prefs = readPrefs();

    // 커스텀 프로토콜 등록. 개발 중(`electron .`)에는 실행 파일이 electron
    // 자신이라 인자를 함께 등록해야 OS가 우리 앱을 되찾을 수 있다.
    //
    // **MSIX(Microsoft Store) 패키지에서는 이 호출이 무효다** — 프로토콜은
    // 패키지 매니페스트가 선언하고(electron-builder.yml의 최상위 `protocols`)
    // 런타임 등록은 컨테이너가 받아들이지 않는다. 그래도 부르는 이유는 직접
    // 배포한 .exe·개발 실행에는 이 길뿐이기 때문이고, MSIX에서는 조용히
    // 실패하는 것이 정상이다(그래서 실패를 오류로 다루지 않는다).
    // ⚠️ 프로토콜을 늘릴 때 이 줄만 고치면 MSIX에서는 아무 일도 일어나지 않는다.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1]!)]);
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    }

    ipcMain.handle('geurio:open-external', async (_e, url: unknown) => {
      if (typeof url !== 'string' || !isSafeExternalUrl(url)) return false;
      await shell.openExternal(url);
      return true;
    });

    // 창 컨트롤 색 — 렌더러가 지금 테마의 면·글자색을 알려 준다. Windows에서만
    // 뜻이 있고(오버레이가 있는 플랫폼) 그 밖에서는 조용히 아무 일도 하지 않는다.
    ipcMain.handle('geurio:titlebar-theme', (e, color: unknown, symbolColor: unknown) => {
      if (process.platform !== 'win32') return false;
      if (!isHexColor(color) || !isHexColor(symbolColor)) return false;
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win || win.isDestroyed()) return false;
      try {
        win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
        return true;
      } catch {
        // 오버레이 없이 만들어진 창(프레임을 그대로 쓰는 경우)에서는 던진다 —
        // 색 하나 때문에 앱이 죽을 이유가 없다.
        return false;
      }
    });

    // ── 상주 설정(4단계) — 읽기·쓰기 모두 **지금 상태를 돌려준다** ─────────
    ipcMain.handle('geurio:background-state', () => backgroundState());

    ipcMain.handle('geurio:set-background', (_e, on: unknown) => {
      if (typeof on !== 'boolean') return backgroundState();
      writePrefs({ ...prefs, background: on });
      return backgroundState();
    });

    ipcMain.handle('geurio:set-open-at-login', (_e, on: unknown) => {
      if (typeof on !== 'boolean' || !supportsOpenAtLogin(process.platform)) return backgroundState();
      try {
        // 자동 실행은 **창 없이** 시작한다(`--hidden`) — 컴퓨터를 켤 때마다 창이
        // 튀어나오면 상주가 아니라 방해다. 상주할 수 없는 환경이면 그 인자가
        // 있어도 창을 띄운다(`shouldStartHidden`).
        app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS });
      } catch {
        // MSIX 컨테이너처럼 받아들이지 않는 환경이 있다 — 아래에서 **다시 읽어**
        // 돌려주므로 화면은 언제나 실제 상태를 보여 준다(거짓말을 하지 않는다).
      }
      return backgroundState();
    });

    // 알림을 눌러 앱으로 돌아오는 길 — 숨어 있던 창은 렌더러의 `window.focus()`로는
    // 나타나지 않는다(창이 아예 감춰져 있다).
    ipcMain.handle('geurio:focus-window', () => {
      showWindow();
      return true;
    });

    ipcMain.handle('geurio:pending-deep-link', () => {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      return link;
    });

    // 앱 메뉴 — Electron 기본 메뉴의 `보기`(새로 고침·개발자 도구·확대/축소)는
    // 브라우저의 메뉴이지 이 앱의 메뉴가 아니다. Windows·Linux는 메뉴 자체를
    // 두지 않고, macOS는 ⌘C·⌘V가 메뉴에서 나오므로 앱·편집·창 셋만 둔다.
    const menu = appMenuSpec(process.platform);
    Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu as MenuItemConstructorOptions[]) : null);

    // 첫 실행이 딥링크로 시작된 경우(Windows·Linux).
    pendingDeepLink = deepLinkFromArgv(process.argv);

    createTray();

    // 로그인 자동 실행으로 깨어났으면 창 없이 시작한다 — macOS는 `wasOpenedAtLogin`,
    // Windows는 우리가 등록해 둔 `--hidden` 인자가 그 신호다.
    let openedAtLogin = false;
    try {
      openedAtLogin = app.getLoginItemSettings({ args: LOGIN_ARGS }).wasOpenedAtLogin === true;
    } catch {
      openedAtLogin = false;
    }
    const hidden = shouldStartHidden(
      process.argv,
      openedAtLogin,
      canStayInBackground(process.platform, tray !== null),
    );

    mainWindow = createWindow(hidden);

    app.on('activate', () => {
      // macOS: 독 아이콘을 눌렀을 때. 창이 숨어 있으면 되살리고, 아예 없으면 만든다
      // (상주 중에는 **숨어 있는** 쪽이라 개수만 보면 아무 일도 하지 않는다).
      showWindow();
    });
  });

  app.on('window-all-closed', () => {
    // macOS 관례는 창을 닫아도 앱이 남는 것 — 그 밖에서는 종료한다.
    if (process.platform !== 'darwin') app.quit();
  });
}

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
import { app, BrowserWindow, ipcMain, screen, shell, type Rectangle } from 'electron';
import {
  clampBounds,
  DEEP_LINK_SCHEME,
  DEFAULT_APP_URL,
  deepLinkFromArgv,
  isDeepLink,
  isInternalUrl,
  isSafeExternalUrl,
  MIN_HEIGHT,
  MIN_WIDTH,
  originOf,
  type Bounds,
} from './shell';

const APP_URL = process.env.GEURIO_APP_URL || DEFAULT_APP_URL;
const APP_ORIGIN = originOf(APP_URL);
/** 로그인 화면의 배경색 — 첫 페인트 전 흰 섬광을 막는다(웹의 `--mf-bg`와 같은 값). */
const BACKGROUND = '#fbf6f2';

let mainWindow: BrowserWindow | null = null;
/** 앱이 뜨기 전에 도착한 딥링크 — 렌더러가 붙으면 넘겨준다. */
let pendingDeepLink: string | null = null;

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

/* ─────────────────────────────── 창 만들기 ─────────────────────────────── */

function createWindow(): BrowserWindow {
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 원격 출처를 띄우는 셸의 기본값 — 이 셋은 함께여야 뜻이 있다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      additionalArguments: [`--geurio-version=${app.getVersion()}`],
    },
  });

  win.once('ready-to-show', () => win.show());

  // 창 크기 기억: resize/move는 드래그 중 수십 번 오므로 끝난 뒤에만 쓴다.
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveBounds(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => saveBounds(win));

  /* 외부 링크는 **시스템 브라우저**로 — 앱 창은 우리 출처만 띄운다(shell.ts). */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    // 앱 안에 새 창을 열지 않는다: 우리 출처면 같은 창에서 이동하면 되고,
    // 남의 출처는 주소창이 있는 곳에서 열려야 한다.
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, APP_ORIGIN)) return;
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
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS는 실행 중인 앱에 이벤트로 넘긴다.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    // 커스텀 프로토콜 등록. 개발 중(`electron .`)에는 실행 파일이 electron
    // 자신이라 인자를 함께 등록해야 OS가 우리 앱을 되찾을 수 있다.
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

    ipcMain.handle('geurio:pending-deep-link', () => {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      return link;
    });

    // 첫 실행이 딥링크로 시작된 경우(Windows·Linux).
    pendingDeepLink = deepLinkFromArgv(process.argv);

    mainWindow = createWindow();

    app.on('activate', () => {
      // macOS: 독 아이콘을 눌렀을 때 창이 하나도 없으면 다시 만든다.
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // macOS 관례는 창을 닫아도 앱이 남는 것 — 그 밖에서는 종료한다.
    if (process.platform !== 'darwin') app.quit();
  });
}

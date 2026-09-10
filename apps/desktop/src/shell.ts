// 셸의 **순수 규칙**만 모아 둔다 — Electron API를 쓰지 않으므로 vitest로 그대로
// 검증할 수 있다(`shell.test.ts`). main.ts는 여기서 정한 판단을 실행만 한다:
// 창을 어디에 띄울지, 어떤 주소를 앱 안에서 열지, 딥링크를 어떻게 읽을지.
//
// 이 파일의 판단 둘은 **보안 경계**다:
//   - `isInternalUrl` — 앱 창은 우리 출처만 띄운다. 남의 주소가 앱 창에서 열리면
//     그 페이지가 우리와 같은 창 껍데기를 입고 사용자를 속일 수 있다(피싱).
//     밖은 언제나 시스템 브라우저로 보낸다(주소창이 있는 곳).
//   - `isDeepLink` — OS가 넘겨준 문자열은 **아무나 만들 수 있다**(`geurio://`
//     를 아는 웹페이지·다른 앱이 쏠 수 있다). 그래서 우리 스킴의 모양만
//     통과시키고, 그 값으로 무엇을 할지는 웹 쪽이 정하며, 값의 정당성은
//     최종적으로 서버(Supabase)가 판단한다.

/** 커스텀 프로토콜 스킴 — `app.setAsDefaultProtocolClient`와 웹 쪽 딥링크가 함께 쓴다. */
export const DEEP_LINK_SCHEME = 'geurio';

/** 기본으로 띄우는 앱 주소. `GEURIO_APP_URL`로 덮어쓸 수 있다(개발·프리뷰 확인용). */
export const DEFAULT_APP_URL = 'https://geurio.com/home';

/**
 * 앱 창이 머무를 출처. `null`이면 주소를 읽을 수 없는 것이므로 **아무것도 내부로
 * 보지 않는다**(그 편이 안전하다 — 판단이 안 되면 브라우저로 보낸다).
 */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    // http(s)만 출처로 인정한다. file:·app:·data: 같은 것을 출처로 삼으면
    // `new URL(...).origin`이 'null' 문자열이 되어 비교가 무의미해진다.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** 이 주소를 **앱 창 안에서** 열어도 되는가 — 우리 출처일 때만 참. */
export function isInternalUrl(url: string, appOrigin: string | null): boolean {
  if (!appOrigin) return false;
  return originOf(url) === appOrigin;
}

/**
 * **랜딩(소개) 페이지**인가 — 우리 출처 안이지만 앱 창에서는 열지 않는다.
 *
 * 그 화면은 "이 앱이 무엇인가"를 설명해 설치를 권하는 마케팅 페이지라, 앱을
 * 이미 설치한 사람에게는 갈 곳이 아니다. 게다가 프로덕션의 `/`는 SPA가 아니라
 * **정적 쌍둥이**(`apps/web/public/landing.html`)라, 앱 창이 그리로 가면 React 앱과
 * 함께 데스크톱 타이틀 바 배치(`--mf-titlebar`)까지 통째로 사라진다(제보: 로그인
 * 화면의 Geurio 표식을 누르면 "화면이 틀어진다").
 *
 * 웹 쪽도 같은 판단을 한다(`App.tsx`의 `/` 라우트) — 그쪽은 앱 안에서의 이동을
 * 막고, 여기는 **주소로 하는 이동**을 막는다(그쪽 링크가 늘어나도 셸이 마지막
 * 문지기다). 막힌 이동은 시스템 브라우저로 보낸다: 마케팅 페이지는 주소창이 있는
 * 곳에서 열리는 편이 맞고, 눌렀는데 아무 일도 없는 것보다 낫다.
 */
export function isLandingPath(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return p === '/' || p === '/index.html' || p === '/landing.html';
  } catch {
    return false;
  }
}

/** 시스템 브라우저로 넘겨도 되는 주소인가 — http(s)만(그 밖은 OS 핸들러를 깨울 수 있다). */
export function isSafeExternalUrl(url: string): boolean {
  return originOf(url) !== null;
}

/**
 * `geurio://…` 딥링크인가 — 셸은 **모양만** 보고 렌더러에 그대로 넘긴다.
 * 무엇을 뜻하는지(로그인 핸드오프인지 등)는 웹 쪽이 읽는다
 * (`apps/web/src/features/auth/desktopGoogle.ts`) — 그래야 딥링크 종류를
 * 늘릴 때 설치본을 다시 배포하지 않아도 되고, 같은 형식을 두 곳에서 해석해
 * 어긋나는 일도 없다. 여기서 거르는 것은 "OS가 넘긴 쓰레기"뿐이다.
 */
export function isDeepLink(raw: string): boolean {
  try {
    return new URL(raw).protocol === `${DEEP_LINK_SCHEME}:`;
  } catch {
    return false;
  }
}

/** argv에서 딥링크를 찾는다 — Windows·Linux는 프로토콜 실행을 **명령줄 인자**로 넘긴다. */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith(`${DEEP_LINK_SCHEME}://`) || arg.startsWith(`${DEEP_LINK_SCHEME}:`)) return arg;
  }
  return null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 창 최소 크기 — 이보다 좁으면 에디터 상단 바·속성 패널이 서로를 밀어낸다. */
export const MIN_WIDTH = 940;
export const MIN_HEIGHT = 620;

/**
 * 지난번 창 크기·자리를 지금 화면에 맞게 다듬는다. 모니터를 뺐거나 해상도가
 * 바뀌면 저장된 자리가 **화면 밖**일 수 있는데, 그러면 창이 열렸는데 보이지
 * 않는다(사용자에게는 "앱이 안 뜬다"). 그래서 화면 안으로 당기고 최소 크기를
 * 지킨다.
 */
export function clampBounds(saved: Partial<Bounds> | null | undefined, workArea: Bounds): Bounds {
  const width = Math.max(MIN_WIDTH, Math.min(saved?.width ?? 1280, workArea.width));
  const height = Math.max(MIN_HEIGHT, Math.min(saved?.height ?? 860, workArea.height));
  const hasPos = typeof saved?.x === 'number' && typeof saved?.y === 'number';
  if (!hasPos) {
    // 자리를 모르면 화면 가운데 — OS 기본 배치는 다중 모니터에서 엉뚱한 쪽에 뜬다.
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height,
    };
  }
  const x = Math.round(Math.min(Math.max(saved!.x!, workArea.x), workArea.x + workArea.width - width));
  const y = Math.round(Math.min(Math.max(saved!.y!, workArea.y), workArea.y + workArea.height - height));
  return { x, y, width, height };
}

/* ───────────────────────────── 타이틀 바 ───────────────────────────── */

/**
 * 타이틀 바 높이. 이 값의 **주인은 셸**이다 — 창을 만드는 시점에 네이티브
 * 컨트롤 오버레이 높이로 쓰이므로 렌더러가 정할 수 없고, 렌더러(웹 앱)는
 * preload가 넘겨 준 이 값을 그대로 그린다. 둘이 갈리면 바와 컨트롤의 높이가
 * 어긋난다.
 */
export const TITLEBAR_HEIGHT = 40;

/**
 * 이 플랫폼에서 **프레임을 숨기고 우리 타이틀 바를 그리는가**.
 *
 * Windows·macOS만이다. Electron의 `titleBarStyle: 'hidden'`과 창 컨트롤
 * 오버레이(`titleBarOverlay`)가 그 둘에서 확실히 동작하고, 우리가 만드는 설치
 * 파일도 그 둘뿐이다(`electron-builder.yml`). Linux에서는 평범한 OS 프레임을
 * 그대로 쓴다 — 데스크톱 환경마다 장식 방식이 갈려, 숨겼다가 창을 옮기거나
 * 닫을 길이 사라지는 쪽이 훨씬 나쁘다.
 */
export function usesCustomTitleBar(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * 렌더러에 알려 줄 타이틀 바 높이 — **0이면 그리지 않는다**는 뜻이다(숫자 하나가
 * "우리 바인가"와 "얼마나 높은가"를 함께 나른다). 이미 설치된 옛 셸은 이 값을
 * 아예 넘기지 않으므로 웹 쪽 폴백도 0이어야 한다: 그러지 않으면 네이티브 프레임
 * **아래에** 우리 바가 한 겹 더 그려진다.
 */
export function titleBarHeightFor(platform: string): number {
  return usesCustomTitleBar(platform) ? TITLEBAR_HEIGHT : 0;
}

/**
 * 창 컨트롤(최소화·최대화·닫기)의 색은 런타임에 바꿀 수 있다 — 사용자가 다크
 * 테마를 고르면 밝은 심볼이어야 하기 때문이다. 렌더러가 보내는 값이므로
 * **모양을 확인한다**: `#rgb`·`#rrggbb`만 통과시킨다(원격 페이지가 셸 API에
 * 아무 문자열이나 넘기지 못하게).
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/* ─────────────────────── 앱 창의 키보드 — 브라우저 키를 막는다 ───────────────────────
 *
 * 두 층이다. **1층은 메뉴**다(`appMenuSpec`) — 새로 고침·개발자 도구·확대/축소는
 * Electron 기본 메뉴가 주는 것이고 메뉴를 없애면 그대로 사라진다(실제 Electron으로
 * 확인: 메뉴가 없으면 Ctrl+R을 눌러도 리로드되지 않는다). **2층이 이 규칙들**이고,
 * 두는 이유는 플랫폼마다 Chromium이 스스로 처리하는 키가 다를 수 있는데 이 개발
 * 환경에서는 Windows·macOS를 확인할 수 없기 때문이다 — 그리고 켜 뒀을 때 개발자
 * 도구를 열어 주는 자리가 여기다.
 *
 * ⚠️ 프로브 함정: **CDP로 넣은 키는 이 층을 지나지 않는다**(Playwright의
 * `keyboard.press`). 실제 키보드와 같은 경로로 재려면 메인 프로세스의
 * `webContents.sendInputEvent`를 써야 한다.
 */

/**
 * `before-input-event`가 넘겨주는 키 입력의 우리에게 필요한 부분만. Electron 타입을
 * 그대로 쓰지 않는 이유는 이 파일이 순수해야 하기 때문이다(vitest로 검증한다).
 */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** 한 글자 키는 소문자로, 기능 키(F5·F12)는 그대로 — 비교를 한 꼴로 맞춘다. */
function normKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * 개발자 도구를 여는 관례적인 조합인가 — F12 · Ctrl+Shift+I/J/C · ⌘⌥I/J/C.
 *
 * 셸은 이것을 **언제나 가로챈다**: 배포본에서 개발자 도구는 기능이 아니고, 그 창이
 * 열리면 사용자에게는 앱이 고장 난 것처럼 보인다. 다만 실기기 진단은 이 창이
 * 유일한 길이라(타이틀 바·로그인 사고를 이걸로 잡았다) 완전히 없애지는 않는다 —
 * 열어 주는 것은 `GEURIO_DEVTOOLS=1`이나 개발 실행(`electron .`)일 때만이다.
 */
export function isDevToolsShortcut(input: KeyInput): boolean {
  if (input.type !== 'keyDown') return false;
  const key = normKey(input.key);
  if (key === 'F12') return true;
  const letter = key === 'i' || key === 'j' || key === 'c';
  if (!letter) return false;
  // Windows·Linux는 Ctrl+Shift+_, macOS는 ⌘⌥_ 다.
  return (input.control && input.shift) || (input.meta && input.alt);
}

/**
 * **앱이 쓰지 않는 브라우저 단축키**인가 — 눌리면 "웹 페이지"처럼 동작하는 키들이다
 * (요청: 웹이 아니라 앱으로써 느껴지게).
 *
 * 담은 근거를 하나씩 적어 둔다. 여기에 키를 더할 때는 **앱이 그 키를 쓰지 않는지**
 * 먼저 확인해야 한다(막으면 렌더러가 그 키를 아예 못 본다):
 *   - **새로 고침**(F5 · Ctrl/⌘+R) — 앱에서 리로드는 사용자가 다룰 개념이 아니고,
 *     실행취소 기록·클립보드·선택·팬/줌, 그리고 **아직 저장되지 않은 편집**까지
 *     잃는다. 우리가 새로 고침이 필요한 자리(협업 끊김 안내·새 버전 적용)는 앱이
 *     스스로 `location.reload()`를 부르므로 이 키가 없어도 길이 막히지 않는다.
 *   - **인쇄**(Ctrl/⌘+P) — 우리 인쇄·저장 경로는 내보내기(PDF·PNG·SVG)다. 브라우저
 *     인쇄 대화상자는 크롬 UI를 그대로 드러낸다.
 *   - **페이지 확대/축소**(Ctrl/⌘+0 · ± ) — 캔버스에 자기 줌이 있어 두 줌이 겹치면
 *     무엇이 커진 것인지 알 수 없다. UI 전체 크기는 OS 배율이 맡는다.
 *
 * **`Ctrl/⌘+W`는 담지 않는다** — macOS에서 ⌘W로 창을 닫는 것은 그 플랫폼의 관례이고
 * 우리 macOS 메뉴(`windowMenu`)가 그 항목을 갖고 있다. Windows·Linux는 메뉴가 없어
 * 이미 아무 일도 일어나지 않으므로, 막아서 얻는 것 없이 관례만 깨진다.
 *
 * 앱이 쓰는 수정 키 조합(C·V·X·D·F·N·S·Y·Z·A·Shift+Z)은 **건드리지 않는다** —
 * 실제 Electron으로 확인했다(Ctrl+C·Ctrl+Z·Ctrl+A는 렌더러에 그대로 도착한다).
 */
export function isBrowserShortcut(input: KeyInput): boolean {
  if (input.type !== 'keyDown') return false;
  const key = normKey(input.key);
  const mod = input.control || input.meta;
  if (key === 'F5') return true;
  if (!mod) return false;
  return key === 'r' || key === 'p' || key === '0' || key === '-' || key === '+' || key === '=';
}

/* ───────────────────────────── 앱 메뉴 ───────────────────────────── */

/** 메뉴 한 항목 — Electron의 `MenuItemConstructorOptions`에 그대로 맞는 모양이다. */
export interface MenuSpec {
  role?: string;
  label?: string;
  submenu?: MenuSpec[];
}

/**
 * 앱 메뉴 — **앱이 실제로 하는 일만** 담는다. `null`이면 메뉴를 두지 않는다.
 *
 * Electron이 기본으로 만들어 주는 메뉴에는 `보기`(새로 고침·강제 새로 고침·개발자
 * 도구·확대/축소)가 들어 있다. 그건 브라우저의 메뉴이지 이 앱의 메뉴가 아니다
 * (요청) — 그래서 **Windows·Linux는 메뉴를 없앤다**. 그 두 곳에서는 입력창의
 * 잘라내기·복사·붙여넣기·전체 선택을 Chromium이 스스로 처리하므로 편집 메뉴가
 * 없어도 글자를 다루는 데 지장이 없다.
 *
 * **macOS는 메뉴가 필수다** — 그 플랫폼에서는 ⌘C·⌘V가 메뉴 항목에서 나오므로
 * 메뉴를 비우면 입력창에서 복사·붙여넣기가 통째로 죽는다(Electron의 오래된 함정).
 * 그래서 앱·편집·창 셋만 두고 **`보기` 메뉴는 두지 않는다**.
 */
export function appMenuSpec(platform: string): MenuSpec[] | null {
  if (platform !== 'darwin') return null;
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}

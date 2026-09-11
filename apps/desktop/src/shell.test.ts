import { describe, expect, it } from 'vitest';
import {
  clampBounds,
  deepLinkFromArgv,
  isInternalUrl,
  isLandingPath,
  isSafeExternalUrl,
  MIN_HEIGHT,
  MIN_WIDTH,
  isBrowserShortcut,
  isDeepLink,
  isDevToolsShortcut,
  isHexColor,
  appMenuSpec,
  canStayInBackground,
  closeNoticeBody,
  coerceShellPrefs,
  DEFAULT_SHELL_PREFS,
  HIDDEN_FLAG,
  originOf,
  shouldStartHidden,
  supportsOpenAtLogin,
  usesTray,
  TITLEBAR_HEIGHT,
  titleBarHeightFor,
  usesCustomTitleBar,
  type KeyInput,
} from './shell';

const APP = 'https://geurio.com';

describe('isInternalUrl — 앱 창은 우리 출처만 띄운다', () => {
  it('같은 출처의 다른 경로는 내부다', () => {
    expect(isInternalUrl('https://geurio.com/editor?map=m1', APP)).toBe(true);
  });

  it('남의 출처는 내부가 아니다(피싱 방지 — 브라우저로 보낸다)', () => {
    expect(isInternalUrl('https://accounts.google.com/o/oauth2/auth', APP)).toBe(false);
    expect(isInternalUrl('https://geurio.com.evil.example/home', APP)).toBe(false);
    // 서브도메인도 다른 출처다 — 필요해지면 그때 명시적으로 허용한다.
    expect(isInternalUrl('https://www.geurio.com/home', APP)).toBe(false);
  });

  it('http(s)가 아닌 스킴은 내부가 아니다', () => {
    expect(isInternalUrl('file:///etc/passwd', APP)).toBe(false);
    expect(isInternalUrl('javascript:alert(1)', APP)).toBe(false);
    expect(isInternalUrl('geurio://auth?refresh_token=x', APP)).toBe(false);
  });

  it('출처를 모르면 아무것도 내부로 보지 않는다', () => {
    expect(isInternalUrl('https://geurio.com/home', null)).toBe(false);
    expect(originOf('not a url')).toBe(null);
  });
});

describe('isLandingPath — 랜딩은 앱 창에서 열지 않는다', () => {
  it('루트와 정적 쌍둥이의 주소를 잡는다', () => {
    // 프로덕션의 `/`는 SPA가 아니라 `public/landing.html`이라, 앱 창이 그리로 가면
    // React 앱과 함께 데스크톱 타이틀 바 배치까지 사라진다(제보).
    expect(isLandingPath('https://geurio.com/')).toBe(true);
    expect(isLandingPath('https://geurio.com/?utm=x#top')).toBe(true);
    expect(isLandingPath('https://geurio.com/index.html')).toBe(true);
    expect(isLandingPath('https://geurio.com/landing.html')).toBe(true);
  });

  it('앱 화면은 막지 않는다', () => {
    for (const p of ['/home', '/login', '/editor?map=m1', '/privacy', '/terms', '/auth/desktop']) {
      expect(isLandingPath(`https://geurio.com${p}`), p).toBe(false);
    }
  });

  it('주소를 읽을 수 없으면 막지 않는다 — 그 판단은 isInternalUrl이 먼저 한다', () => {
    expect(isLandingPath('not a url')).toBe(false);
  });
});

describe('isSafeExternalUrl — 브라우저로 넘길 수 있는 주소', () => {
  it('http(s)만 넘긴다', () => {
    expect(isSafeExternalUrl('https://accounts.google.com/x')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:5173/home')).toBe(true);
    // OS 핸들러를 깨우는 스킴은 넘기지 않는다.
    expect(isSafeExternalUrl('file:///Users/me/secret.txt')).toBe(false);
    expect(isSafeExternalUrl('ms-msdt:/id')).toBe(false);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(false);
  });
});

describe('isDeepLink — OS가 넘긴 문자열은 아무나 만들 수 있다', () => {
  it('우리 스킴이면 통과(무엇을 뜻하는지는 웹이 읽는다)', () => {
    expect(isDeepLink('geurio://auth?refresh_token=rt')).toBe(true);
    expect(isDeepLink('geurio://무엇이든')).toBe(true);
  });

  it('다른 스킴·쓰레기는 넘기지 않는다', () => {
    expect(isDeepLink('https://geurio.com/auth?refresh_token=rt')).toBe(false);
    expect(isDeepLink('geurioo://auth')).toBe(false);
    expect(isDeepLink('쓰레기')).toBe(false);
  });
});

describe('deepLinkFromArgv — Windows·Linux는 명령줄로 넘어온다', () => {
  it('argv 어디에 있어도 찾는다', () => {
    expect(deepLinkFromArgv(['geurio.exe', '--flag', 'geurio://auth?refresh_token=rt'])).toBe(
      'geurio://auth?refresh_token=rt',
    );
  });

  it('없으면 null', () => {
    expect(deepLinkFromArgv(['geurio.exe', '--flag'])).toBe(null);
  });
});

describe('clampBounds — 저장된 자리가 화면 밖이면 창이 안 보인다', () => {
  const work = { x: 0, y: 0, width: 1440, height: 900 };

  it('자리를 모르면 화면 가운데', () => {
    const b = clampBounds(null, work);
    expect(b.x + b.width / 2).toBe(720);
    expect(b.y + b.height / 2).toBe(450);
  });

  it('화면 밖 좌표는 안으로 당긴다', () => {
    const b = clampBounds({ x: 5000, y: -400, width: 1000, height: 700 }, work);
    expect(b.x).toBe(440); // 1440 - 1000
    expect(b.y).toBe(0);
  });

  it('최소 크기를 지키고 화면보다 크게 열지 않는다', () => {
    expect(clampBounds({ x: 0, y: 0, width: 200, height: 100 }, work)).toMatchObject({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
    expect(clampBounds({ x: 0, y: 0, width: 5000, height: 5000 }, work)).toMatchObject({
      width: 1440,
      height: 900,
    });
  });

  it('보조 모니터(음수 좌표)의 작업 영역도 그대로 쓴다', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const b = clampBounds({ x: -1900, y: 40, width: 1200, height: 800 }, left);
    expect(b).toEqual({ x: -1900, y: 40, width: 1200, height: 800 });
  });
});

describe('타이틀 바', () => {
  it('Windows·macOS만 프레임을 숨긴다', () => {
    expect(usesCustomTitleBar('win32')).toBe(true);
    expect(usesCustomTitleBar('darwin')).toBe(true);
    // Linux는 OS 프레임 그대로 — 숨겼다가 창을 옮기거나 닫을 길이 사라지는 쪽이 나쁘다.
    expect(usesCustomTitleBar('linux')).toBe(false);
  });

  it('높이 0이 "그리지 않는다"를 뜻한다', () => {
    expect(titleBarHeightFor('win32')).toBe(TITLEBAR_HEIGHT);
    expect(titleBarHeightFor('linux')).toBe(0);
  });

  it('창 컨트롤 색은 hex만 받는다', () => {
    expect(isHexColor('#fffdfb')).toBe(true);
    expect(isHexColor('#FFF')).toBe(true);
    // 원격 페이지가 넘길 수 있는 값이므로 모양을 본다.
    expect(isHexColor('white')).toBe(false);
    expect(isHexColor('var(--mf-card)')).toBe(false);
    expect(isHexColor('rgb(255,253,251)')).toBe(false);
    expect(isHexColor('#fffdfb; drop table')).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

/* ───────── 앱 창의 키보드 — 브라우저 키는 막고, 앱 단축키는 건드리지 않는다 ───────── */

const KEY = (key: string, mods: Partial<Pick<KeyInput, 'control' | 'meta' | 'shift' | 'alt'>> = {}): KeyInput => ({
  type: 'keyDown',
  key,
  control: false,
  meta: false,
  shift: false,
  alt: false,
  ...mods,
});

describe('브라우저 단축키 차단 — 앱으로써 느껴지게', () => {
  it('새로 고침·인쇄·페이지 확대를 막는다', () => {
    expect(isBrowserShortcut(KEY('F5'))).toBe(true);
    expect(isBrowserShortcut(KEY('r', { control: true }))).toBe(true);
    expect(isBrowserShortcut(KEY('R', { control: true, shift: true }))).toBe(true);
    expect(isBrowserShortcut(KEY('p', { control: true }))).toBe(true);
    for (const k of ['0', '-', '+', '=']) expect(isBrowserShortcut(KEY(k, { control: true }))).toBe(true);
    // macOS도 같다(⌘).
    expect(isBrowserShortcut(KEY('r', { meta: true }))).toBe(true);
    expect(isBrowserShortcut(KEY('0', { meta: true }))).toBe(true);
  });

  it('앱이 쓰는 단축키는 건드리지 않는다 — 막으면 렌더러가 그 키를 못 본다', () => {
    // 복사·붙여넣기·잘라내기·복제·검색·저장·새 항목·실행취소·다시 실행·전체 선택
    for (const k of ['c', 'v', 'x', 'd', 'f', 's', 'n', 'z', 'y', 'a']) {
      expect(isBrowserShortcut(KEY(k, { control: true }))).toBe(false);
      expect(isBrowserShortcut(KEY(k, { meta: true }))).toBe(false);
    }
    expect(isBrowserShortcut(KEY('z', { control: true, shift: true }))).toBe(false);
    // ⌘W는 macOS 관례이고 그 플랫폼 메뉴가 갖고 있다 — 담지 않는다.
    expect(isBrowserShortcut(KEY('w', { control: true }))).toBe(false);
    expect(isBrowserShortcut(KEY('w', { meta: true }))).toBe(false);
    // 수정 키 없는 도구 전환(V·P·H·E·C)과 물음표 도움말도 그대로다.
    for (const k of ['v', 'p', 'h', 'e', 'c', '?']) expect(isBrowserShortcut(KEY(k))).toBe(false);
    // 키를 뗄 때(keyUp)는 판단하지 않는다.
    expect(isBrowserShortcut({ ...KEY('r', { control: true }), type: 'keyUp' })).toBe(false);
  });

  it('개발자 도구 조합은 따로 가른다 — 셸이 언제나 가로챈다', () => {
    expect(isDevToolsShortcut(KEY('F12'))).toBe(true);
    expect(isDevToolsShortcut(KEY('i', { control: true, shift: true }))).toBe(true);
    expect(isDevToolsShortcut(KEY('j', { control: true, shift: true }))).toBe(true);
    expect(isDevToolsShortcut(KEY('c', { control: true, shift: true }))).toBe(true);
    // macOS는 ⌘⌥.
    expect(isDevToolsShortcut(KEY('i', { meta: true, alt: true }))).toBe(true);
    // 앱의 복사(Ctrl+C)·붙여넣기는 이 조합이 아니다.
    expect(isDevToolsShortcut(KEY('c', { control: true }))).toBe(false);
    expect(isDevToolsShortcut(KEY('i', { control: true }))).toBe(false);
  });
});

describe('앱 메뉴 — 앱이 하는 일만 담는다', () => {
  it('Windows·Linux는 메뉴를 두지 않는다', () => {
    // Electron 기본 메뉴의 `보기`(새로 고침·개발자 도구·확대/축소)가 통째로 사라진다.
    expect(appMenuSpec('win32')).toBeNull();
    expect(appMenuSpec('linux')).toBeNull();
  });

  it('macOS는 앱·편집·창 셋만 — `보기`는 없다', () => {
    const spec = appMenuSpec('darwin');
    expect(spec?.map((m) => m.role)).toEqual(['appMenu', 'editMenu', 'windowMenu']);
    // ⌘C·⌘V가 메뉴에서 나오는 플랫폼이라 편집 메뉴는 빼지 않는다.
    expect(spec?.some((m) => m.role === 'editMenu')).toBe(true);
    // 브라우저 역할이 하나도 없어야 한다.
    const flat = JSON.stringify(spec);
    for (const role of ['viewMenu', 'reload', 'forceReload', 'toggleDevTools', 'zoomIn', 'zoomOut', 'resetZoom']) {
      expect(flat).not.toContain(role);
    }
  });
});

describe('트레이 상주 — 창을 닫아도 알림(4단계)', () => {
  it('macOS는 트레이를 두지 않는다 — 독 아이콘이 그 역할을 한다', () => {
    expect(usesTray('darwin')).toBe(false);
    expect(usesTray('win32')).toBe(true);
    expect(usesTray('linux')).toBe(true);
  });

  it('로그인 시 자동 실행은 Windows·macOS만 — Linux는 자리를 두지 않는다', () => {
    expect(supportsOpenAtLogin('win32')).toBe(true);
    expect(supportsOpenAtLogin('darwin')).toBe(true);
    expect(supportsOpenAtLogin('linux')).toBe(false);
  });

  it('되돌아올 길이 없으면 상주하지 않는다', () => {
    // 트레이가 만들어지지 않은 환경(트레이 없는 리눅스 데스크톱)에서 숨기면
    // 창을 되찾을 길이 사라진다 — 그래서 거짓이다.
    expect(canStayInBackground('win32', false)).toBe(false);
    expect(canStayInBackground('win32', true)).toBe(true);
    // macOS는 독이 그 길이라 트레이와 무관하게 참이다.
    expect(canStayInBackground('darwin', false)).toBe(true);
  });

  it('로그인 자동 실행으로 깨어나면 창 없이 시작한다', () => {
    expect(shouldStartHidden([HIDDEN_FLAG], false, true)).toBe(true);
    // macOS는 인자가 아니라 `wasOpenedAtLogin`으로 온다.
    expect(shouldStartHidden([], true, true)).toBe(true);
    expect(shouldStartHidden([], false, true)).toBe(false);
  });

  it('상주할 수 없으면 반드시 창을 띄운다 — 닿을 길 없는 프로세스를 만들지 않는다', () => {
    expect(shouldStartHidden([HIDDEN_FLAG], true, false)).toBe(false);
  });

  it('처음 숨길 때의 안내는 어디로 갔는지를 말한다', () => {
    expect(closeNoticeBody('win32')).toContain('트레이');
    expect(closeNoticeBody('darwin')).toContain('독');
    // 끄는 길을 함께 알린다 — 상주를 말없이 하지 않는다.
    expect(closeNoticeBody('win32')).toContain('설정');
  });

  it('셸 설정 기본값 — 상주는 켜짐, 안내는 아직', () => {
    expect(DEFAULT_SHELL_PREFS).toEqual({ background: true, closeNoticeShown: false });
  });

  it('저장 파일이 깨졌거나 옛 판이어도 기본값으로 읽는다', () => {
    expect(coerceShellPrefs(null)).toEqual(DEFAULT_SHELL_PREFS);
    expect(coerceShellPrefs('x')).toEqual(DEFAULT_SHELL_PREFS);
    expect(coerceShellPrefs([])).toEqual(DEFAULT_SHELL_PREFS);
    expect(coerceShellPrefs({})).toEqual(DEFAULT_SHELL_PREFS);
    // 모르는 값은 버리고, 아는 값만 가져온다.
    expect(coerceShellPrefs({ background: 'yes', closeNoticeShown: true })).toEqual({
      background: true,
      closeNoticeShown: true,
    });
    expect(coerceShellPrefs({ background: false })).toEqual({ background: false, closeNoticeShown: false });
  });
});

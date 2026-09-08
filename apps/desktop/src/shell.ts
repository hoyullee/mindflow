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

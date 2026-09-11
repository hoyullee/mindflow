// 설치형 데스크톱 앱의 **껍데기**(`.exe`/`.dmg`)가 새 판이 나왔는지 확인한다.
//
// 왜 따로 필요한가: 앱 *화면*은 껍데기가 원격 출처를 띄우므로 웹 배포가 곧 최신
// 판이고, 미뤄질 때는 설정 › 버전 확인의 `지금 확인`으로 앞당길 수 있다. 그런데
// **껍데기 자신은 스스로 갱신되지 않는다** — 새 설치 파일이 올라와도 앱 안에서
// 알 길이 없었다.
//
// **왜 자동 설치가 아니라 확인·안내인가**: 진짜 자동 업데이트(`electron-updater`)는
// 서명을 요구한다 — macOS의 Squirrel.Mac은 Developer ID 서명이 없으면 갱신을
// 거절하고(우리가 붙인 애드혹 서명은 "Apple Silicon에서 실행은 되게" 할 뿐이다),
// Windows는 기술적으로 되지만 그건 **검증되지 않은 설치 파일을 자동으로 받아
// 실행**하는 것이라 버전 파일 호스트가 뚫리면 사용자 기기에서 코드가 돈다.
// 그래서 지금은 알리고 릴리스 페이지를 여는 데까지만 한다 — 인증서가 준비되면
// 이 모듈의 판정을 그대로 두고 그 행만 진짜 업데이트로 승격하면 된다.
//
// 버전 파일(`/desktop-version.json`)은 **빌드 시점에 `apps/desktop/package.json`
// 에서 생성된다**(vite.config.ts의 `desktopVersionManifest`) — 버전을 두 곳에
// 적지 않으므로 갈릴 수 없다. PWA 프리캐시 글롭에 `json`이 없어 이 파일은
// 캐시되지 않는다(그래야 배포 직후의 값을 읽는다).

/** 버전 파일의 모양 — 우리가 만들고 우리가 읽는다. */
export interface ShellRelease {
  /** 가장 새로 나온 껍데기 버전(예: `0.3.0`). */
  version: string;
  /** 받을 곳 — 릴리스 페이지. 앱 창은 우리 출처만 띄우므로 시스템 브라우저로 연다. */
  url: string;
}

/** 확인 결과. `unknown`은 "확인하지 못했다"이고 `current`와 **다르다**. */
export type ShellUpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'unknown' };

/** `0.2.0`·`v0.2.0` → [0, 2, 0]. 숫자 셋으로 읽히지 않으면 `null`. */
function parts(v: string): number[] | null {
  const raw = v.trim().replace(/^v/i, '');
  // 사전 배포 꼬리(`-beta.1`)는 떼고 숫자 부분만 견준다 — 우리 셸은 늘 X.Y.Z다.
  const nums = (raw.split('-')[0] ?? '').split('.');
  if (nums.length === 0 || nums.length > 3) return null;
  const out: number[] = [];
  for (const n of nums) {
    if (!/^\d+$/.test(n)) return null;
    out.push(Number(n));
  }
  while (out.length < 3) out.push(0);
  return out;
}

/**
 * `latest`가 `current`보다 새로운가.
 *
 * **모양을 읽을 수 없으면 거짓이다** — 없는 업데이트를 알리는 쪽이 놓치는 쪽보다
 * 나쁘다(사용자는 받을 것이 없는 다운로드 페이지로 간다). 이 프로젝트의 "모르는
 * 것은 칠하지 않는다"와 같은 규칙이다.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 우리가 만든 파일이지만 **모양은 확인한다** — 못 그릴 값으로 행을 세우지 않는다. */
export function parseShellRelease(raw: unknown): ShellRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === 'string' ? o.version.trim() : '';
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  if (!parts(version)) return null;
  // 여는 것은 시스템 브라우저다 — 스킴을 좁혀 둔다(파일이 바뀌어도 `javascript:`가
  // 지나가지 않게. 하이퍼링크에서 쓰는 것과 같은 판단이다).
  if (!/^https:\/\//i.test(url)) return null;
  return { version, url };
}

export const SHELL_MANIFEST_PATH = '/desktop-version.json';

/**
 * 버전 파일을 읽는다. 없거나(배포 전) 읽히지 않으면 `null` — 그때 화면은
 * "확인하지 못했어요"라 말하고, **최신이라고 말하지 않는다**.
 */
export async function fetchShellRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<ShellRelease | null> {
  try {
    const res = await fetchImpl(`${SHELL_MANIFEST_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseShellRelease(await res.json());
  } catch {
    return null;
  }
}

/**
 * 지금 도는 껍데기 버전과 견줘 상태 하나로 접는다. 셸이 아니면 애초에 부르지
 * 않는다(설정 화면이 그 행 자체를 그리지 않는다).
 */
export async function checkShellUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellUpdateState> {
  const rel = await fetchShellRelease(fetchImpl);
  if (!rel) return { kind: 'unknown' };
  return isNewerVersion(rel.version, currentVersion)
    ? { kind: 'available', version: rel.version, url: rel.url }
    : { kind: 'current' };
}

// ── 화면과 껍데기를 **한 행으로** 접는다(요청) ────────────────────────────────
//
// 업데이트 행이 둘이면 사용자는 "무엇을 먼저 눌러야 하는가"를 스스로 정해야 한다.
// 실은 정할 것이 없다 — **껍데기를 새로 설치하면 앱이 다시 실행되면서 대기 중인
// 서비스 워커가 활성화되므로 화면까지 함께 최신이 된다**(그 출처의 페이지가 전부
// 닫히는 것이 활성화 조건이다). 그래서 둘이 함께 있으면 껍데기 쪽이 이긴다.

/** `UpdatePrompt`가 모듈에 올려 두는 웹 번들의 상태(그 모양만 받는다). */
export interface WebUpdateStatus {
  ready: boolean;
  checking: boolean;
  applying: boolean;
  saveBlocked: boolean;
}

export type MergedUpdateKind =
  /** 확인할 수단이 아예 없다(서비스워커도 셸도 없는 환경). */
  | 'unavailable'
  /** 웹 적용이 저장 실패로 멈췄다 — 사용자가 손을 써야 한다. */
  | 'save-blocked'
  /** 웹 적용이 진행 중 — 곧 리로드된다. */
  | 'applying'
  /** 껍데기 새 판을 받아야 한다(웹 새 판이 함께 있으면 그것까지 해결된다). */
  | 'shell'
  /** 웹 새 판만 대기 중 — 그 자리에서 적용한다. */
  | 'ready'
  | 'checking'
  | 'latest';

export interface MergedUpdate {
  kind: MergedUpdateKind;
  /** `shell`일 때만 — 받을 판과 주소. */
  release?: ShellRelease;
  /** `shell`일 때 웹 새 판도 대기 중인가(설치하면 함께 최신이 된다). */
  alsoWeb?: boolean;
  /** `latest`일 때 껍데기는 **확인하지 못했는가** — 최신이라고 뭉개지 않는다. */
  shellUnknown?: boolean;
}

/**
 * 한 행이 무엇을 말하고 무엇을 누르게 할지 정한다.
 *
 * 순서에 뜻이 있다:
 * 1. **진행 중인 웹 작업이 먼저다**(`save-blocked`·`applying`) — 리로드가 임박한
 *    자리를 다운로드 버튼으로 갈아 끼우면 사용자가 그 사이에 앱을 떠난다.
 * 2. 다음이 **껍데기**다 — 웹 새 판이 함께 있어도 설치가 그것까지 해결한다.
 * 3. 그다음이 웹 새 판, 확인 중, 최신.
 *
 * `shell`이 `null`이면 설치형 앱이 아니다(브라우저·PWA).
 */
export function mergedUpdateState(
  web: WebUpdateStatus,
  webControls: boolean,
  shell: ShellUpdateState | null,
): MergedUpdate {
  if (!webControls && !shell) return { kind: 'unavailable' };
  if (web.saveBlocked) return { kind: 'save-blocked' };
  if (web.applying) return { kind: 'applying' };
  if (shell?.kind === 'available') {
    return { kind: 'shell', release: { version: shell.version, url: shell.url }, alsoWeb: web.ready };
  }
  if (webControls && web.ready) return { kind: 'ready' };
  // 셸의 `idle`은 "아직 물어보지 않았다"다 — 화면을 여는 순간 확인이 시작되므로
  // 확인 중과 같은 자리에 둔다(빈 상태를 한 프레임 보여 주지 않게).
  if (web.checking || shell?.kind === 'checking' || shell?.kind === 'idle') return { kind: 'checking' };
  return { kind: 'latest', shellUnknown: shell?.kind === 'unknown' };
}

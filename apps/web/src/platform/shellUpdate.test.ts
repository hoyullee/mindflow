import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkShellUpdate, isNewerVersion, mergedUpdateState, parseShellRelease } from './shellUpdate';
import type { ShellUpdateState, WebUpdateStatus } from './shellUpdate';

describe('isNewerVersion', () => {
  it('자리별로 견준다 — 문자열 비교가 아니다', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true); // 문자열이면 '1' < '9'
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.2.1', '0.2.0')).toBe(true);
  });

  it('같거나 옛 판이면 거짓', () => {
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
  });

  it('v 접두와 짧은 표기를 받는다', () => {
    expect(isNewerVersion('v0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.3', '0.2.0')).toBe(true);
  });

  it('읽을 수 없는 모양이면 거짓 — 없는 업데이트를 알리지 않는다', () => {
    for (const bad of ['', 'latest', '0.x.1', '1.2.3.4', 'nightly-2026']) {
      expect(isNewerVersion(bad, '0.2.0')).toBe(false);
      expect(isNewerVersion('9.9.9', bad)).toBe(false);
    }
  });
});

describe('parseShellRelease', () => {
  it('모양이 맞으면 읽는다', () => {
    expect(parseShellRelease({ version: ' 0.3.0 ', url: 'https://example.com/r' })).toEqual({
      version: '0.3.0',
      url: 'https://example.com/r',
    });
  });

  it('https가 아닌 주소는 버린다 — 여는 것은 시스템 브라우저다', () => {
    expect(parseShellRelease({ version: '0.3.0', url: 'javascript:alert(1)' })).toBeNull();
    expect(parseShellRelease({ version: '0.3.0', url: 'http://example.com' })).toBeNull();
  });

  it('버전이 없거나 이상하면 버린다', () => {
    expect(parseShellRelease({ url: 'https://example.com' })).toBeNull();
    expect(parseShellRelease({ version: 'latest', url: 'https://example.com' })).toBeNull();
    expect(parseShellRelease(null)).toBeNull();
    expect(parseShellRelease('0.3.0')).toBeNull();
  });
});

describe('checkShellUpdate', () => {
  // `fetch`의 모양으로 둔다 — 그러지 않으면 `mock.calls`가 `[]`로 추론돼
  // 무엇을 어떻게 불렀는지 단정할 수 없다.
  const ok = (body: unknown) =>
    vi.fn<typeof fetch>(async () => ({ ok: true, json: async () => body }) as unknown as Response);

  it('새 판이면 주소까지 함께 돌려준다', async () => {
    const fetchImpl = ok({ version: '0.3.0', url: 'https://example.com/r' });
    await expect(checkShellUpdate('0.2.0', fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      kind: 'available',
      version: '0.3.0',
      url: 'https://example.com/r',
    });
    // 캐시를 타지 않는다 — 배포 직후의 값을 읽어야 한다.
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(/^\/desktop-version\.json\?t=\d+$/);
    expect(init?.cache).toBe('no-store');
  });

  it('같은 판이면 current', async () => {
    const f = ok({ version: '0.2.0', url: 'https://example.com/r' });
    await expect(checkShellUpdate('0.2.0', f as unknown as typeof fetch)).resolves.toEqual({ kind: 'current' });
  });

  it('파일이 없거나 망가졌으면 unknown — 최신이라고 말하지 않는다', async () => {
    const missing = vi.fn(async () => ({ ok: false }) as unknown as Response);
    await expect(checkShellUpdate('0.2.0', missing as unknown as typeof fetch)).resolves.toEqual({ kind: 'unknown' });

    const broken = ok({ nope: true });
    await expect(checkShellUpdate('0.2.0', broken as unknown as typeof fetch)).resolves.toEqual({ kind: 'unknown' });

    const thrown = vi.fn(async () => { throw new Error('offline'); });
    await expect(checkShellUpdate('0.2.0', thrown as unknown as typeof fetch)).resolves.toEqual({ kind: 'unknown' });
  });
});

/**
 * 업데이트 행은 **하나**다(요청) — 화면과 껍데기를 합쳐 세 경우로 접는다.
 *
 * 순서에 뜻이 있다: 진행 중인 웹 작업 > 껍데기 > 웹 새 판 > 확인 중 > 최신.
 */
describe('mergedUpdateState', () => {
  const web = (p: Partial<WebUpdateStatus> = {}): WebUpdateStatus => ({
    ready: false,
    checking: false,
    applying: false,
    saveBlocked: false,
    ...p,
  });
  const avail: ShellUpdateState = { kind: 'available', version: '0.4.0', url: 'https://example.com/r' };

  it('① 웹만 새 판이면 그 자리에서 적용한다', () => {
    expect(mergedUpdateState(web({ ready: true }), true, { kind: 'current' })).toEqual({ kind: 'ready' });
    // 설치형 앱이 아닐 때도 같다.
    expect(mergedUpdateState(web({ ready: true }), true, null)).toEqual({ kind: 'ready' });
  });

  it('② 껍데기만 새 판이면 받을 판과 주소를 돌려준다', () => {
    expect(mergedUpdateState(web(), true, avail)).toEqual({
      kind: 'shell',
      release: { version: '0.4.0', url: 'https://example.com/r' },
      alsoWeb: false,
    });
  });

  it('③ 둘이 함께 있으면 껍데기가 이긴다 — 설치가 화면까지 해결한다', () => {
    expect(mergedUpdateState(web({ ready: true }), true, avail)).toEqual({
      kind: 'shell',
      release: { version: '0.4.0', url: 'https://example.com/r' },
      alsoWeb: true,
    });
  });

  it('진행 중인 웹 작업은 껍데기보다 먼저다 — 리로드가 임박한 자리를 갈아 끼우지 않는다', () => {
    expect(mergedUpdateState(web({ applying: true, ready: true }), true, avail).kind).toBe('applying');
    expect(mergedUpdateState(web({ saveBlocked: true, ready: true }), true, avail).kind).toBe('save-blocked');
  });

  it('확인 중은 둘 중 하나만 돌아도 확인 중이다(셸의 idle도 같은 자리)', () => {
    expect(mergedUpdateState(web({ checking: true }), true, { kind: 'current' }).kind).toBe('checking');
    expect(mergedUpdateState(web(), true, { kind: 'checking' }).kind).toBe('checking');
    expect(mergedUpdateState(web(), true, { kind: 'idle' }).kind).toBe('checking');
  });

  it('껍데기를 확인하지 못한 것은 최신인 것과 다르다', () => {
    expect(mergedUpdateState(web(), true, { kind: 'unknown' })).toEqual({ kind: 'latest', shellUnknown: true });
    expect(mergedUpdateState(web(), true, { kind: 'current' })).toEqual({ kind: 'latest', shellUnknown: false });
  });

  it('확인할 수단이 아예 없으면 버튼을 두지 않는다', () => {
    expect(mergedUpdateState(web(), false, null)).toEqual({ kind: 'unavailable' });
    // 셸이 있으면 그쪽은 확인할 수 있다 — 통째로 포기하지 않는다.
    expect(mergedUpdateState(web(), false, avail).kind).toBe('shell');
  });
});

/**
 * 빌드 설정 계약 — 둘 다 **틀려도 빌드와 테스트가 통과하고**, 앱을 설치해 설정
 * 화면을 열어 봐야 드러나는 종류다(전자는 "확인하지 못했어요"가 영영, 후자는
 * 옛 버전이 캐시에 굳는다).
 */
describe('버전 파일 빌드 계약', () => {
  const cfg = readFileSync(path.resolve(__dirname, '../../vite.config.ts'), 'utf8');

  it('버전을 적어 두지 않고 apps/desktop/package.json에서 읽어 심는다', () => {
    // **등록 자리**를 본다 — 함수 정의(`function desktopVersionManifest(): Plugin`)도
    // 같은 이름을 품으므로 이름만 찾으면 등록을 떼도 통과한다(실제로 겪었다).
    const plugins = /plugins:\s*\[([\s\S]*?)\n\s*\]/.exec(cfg)?.[1] ?? '';
    expect(plugins).toContain('desktopVersionManifest()');
    expect(cfg).toContain("'../desktop/package.json'");
    expect(cfg).toContain("'desktop-version.json'");
  });

  it('프리캐시 글롭에 json이 없다 — 있으면 이 파일이 굳는다', () => {
    const glob = /globPatterns:\s*\[([^\]]*)\]/.exec(cfg)?.[1] ?? '';
    expect(glob).not.toContain('json');
  });
});

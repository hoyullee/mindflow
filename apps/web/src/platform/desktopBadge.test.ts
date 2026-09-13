// 작업 표시줄 배지(요청) — 셸이 있을 때만, 개수는 다듬어서, 옛 설치본에서는 조용히.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { badgeLabel, setDesktopBadge } from './desktopBadge';

afterEach(() => {
  delete (window as { geurio?: unknown }).geurio;
  vi.restoreAllMocks();
});

function shell(extra: Record<string, unknown> = {}) {
  (window as unknown as { geurio: unknown }).geurio = {
    desktop: true,
    version: '0.3.0',
    platform: 'win32',
    openExternal: async () => true,
    onDeepLink: () => () => undefined,
    takePendingDeepLink: async () => null,
    ...extra,
  };
}

describe('배지 글자 — LNB 알림 배지와 같은 규칙', () => {
  it('10을 넘으면 `9+`', () => {
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
    expect(badgeLabel(120)).toBe('9+');
  });
});

describe('셸에 개수를 알린다', () => {
  it('개수를 그대로 넘긴다(그림은 그릴 수 있을 때만)', () => {
    const setBadge = vi.fn().mockResolvedValue(true);
    shell({ setBadge });
    setDesktopBadge(3);
    expect(setBadge).toHaveBeenCalledTimes(1);
    const arg = setBadge.mock.calls[0]![0] as { count: number; png: string | null };
    expect(arg.count).toBe(3);
    // jsdom에는 캔버스가 없다 — 그때도 **개수는 간다**(macOS·Linux는 그림이 필요 없다).
    expect(arg.png === null || arg.png.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('음수·소수는 다듬고 0은 그대로 보낸다 — 0이 곧 "지워라"다', () => {
    const setBadge = vi.fn().mockResolvedValue(true);
    shell({ setBadge });
    setDesktopBadge(-4);
    setDesktopBadge(2.9);
    expect(setBadge.mock.calls.map((c) => (c[0] as { count: number }).count)).toEqual([0, 2]);
  });

  it('옛 설치본(창구 없음)·브라우저에서는 아무 일도 하지 않는다', () => {
    shell(); // setBadge를 내주지 않는 셸
    expect(() => setDesktopBadge(2)).not.toThrow();
    delete (window as { geurio?: unknown }).geurio;
    expect(() => setDesktopBadge(2)).not.toThrow();
  });

  it('셸이 거절해도 화면이 깨지지 않는다', () => {
    shell({ setBadge: vi.fn().mockRejectedValue(new Error('nope')) });
    expect(() => setDesktopBadge(1)).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { DesktopTitleBar } from './DesktopTitleBar';
import type { DesktopBridge } from './desktopBridge';

function shell(extra: Partial<DesktopBridge> = {}): void {
  (window as unknown as { geurio?: Partial<DesktopBridge> }).geurio = {
    desktop: true,
    version: '0.1.0',
    platform: 'win32',
    openExternal: vi.fn(),
    onDeepLink: () => () => {},
    takePendingDeepLink: vi.fn(),
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { geurio?: unknown }).geurio;
  document.documentElement.style.removeProperty('--mf-titlebar');
});

describe('데스크톱 타이틀 바', () => {
  it('브라우저에서는 그리지 않고 자리도 잡지 않는다', () => {
    render(<DesktopTitleBar />);
    expect(document.querySelector('[data-titlebar]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--mf-titlebar')).toBe('');
  });

  it('높이를 내주지 않는 옛 셸에서도 그리지 않는다', () => {
    // 이미 설치된 판은 이 값을 모른다 — 40으로 폴백하면 네이티브 프레임 **아래에**
    // 우리 바가 한 겹 더 그려진다.
    shell();
    render(<DesktopTitleBar />);
    expect(document.querySelector('[data-titlebar]')).toBeNull();
  });

  it('셸이 준 높이로 그리고 그만큼 앱 영역을 줄인다', () => {
    shell({ titleBarHeight: 40 });
    render(<DesktopTitleBar />);
    const bar = document.querySelector('[data-titlebar]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.height).toBe('40px');
    expect(bar.style.position).toBe('fixed');
    // 모달·메뉴보다 위 — 팝업이 열려 있어도 창을 옮기고 닫을 수 있어야 한다.
    expect(Number(bar.style.zIndex)).toBeGreaterThan(400);
    // 브랜드 마크는 우리 것(코랄 칩 + 소용돌이) — 창 컨트롤은 그리지 않는다.
    expect(bar.querySelector('svg[viewBox="0 0 100 100"]')).not.toBeNull();
    expect(bar.textContent).toContain('Geurio');
    expect(bar.querySelectorAll('button').length).toBe(0);
    expect(document.documentElement.style.getPropertyValue('--mf-titlebar')).toBe('40px');
  });

  it('macOS는 신호등 자리를 비우고 브랜드를 창 가운데 둔다', () => {
    // 제보: 신호등 바로 오른쪽에 붙어 있다. macOS는 창 제목을 가운데 두는 관례이고,
    // 그 가운데는 **남은 폭이 아니라 창**의 가운데라 흐름에서 빼내 배치한다.
    shell({ titleBarHeight: 40, platform: 'darwin' });
    render(<DesktopTitleBar />);
    const bar = document.querySelector('[data-titlebar]') as HTMLElement;
    expect(parseFloat(bar.style.paddingLeft)).toBeGreaterThan(60);
    const brand = bar.querySelector('[data-titlebar-brand]') as HTMLElement;
    expect(brand.style.position).toBe('absolute');
    expect(brand.style.left).toBe('50%');
    expect(brand.style.transform).toBe('translateX(-50%)');
  });

  it('Windows는 왼쪽 정렬 그대로다 — 그 OS의 관례다', () => {
    // 오른쪽은 네이티브 오버레이(최소화·최대화·닫기)가 쓴다.
    shell({ titleBarHeight: 40, platform: 'win32' });
    render(<DesktopTitleBar />);
    const brand = document.querySelector('[data-titlebar-brand]') as HTMLElement;
    expect(brand.style.position).toBe('');
    expect(brand.style.left).toBe('');
  });

  it('테마 색을 셸에 알려 준다(같은 값은 한 번만)', () => {
    document.documentElement.style.setProperty('--mf-card', '#262019');
    document.documentElement.style.setProperty('--mf-subtext', '#a2917f');
    const setTitleBarTheme = vi.fn(() => Promise.resolve(true));
    shell({ titleBarHeight: 40, setTitleBarTheme });
    const { rerender } = render(<DesktopTitleBar />);
    expect(setTitleBarTheme).toHaveBeenCalledWith('#262019', '#a2917f');
    rerender(<DesktopTitleBar />);
    expect(setTitleBarTheme).toHaveBeenCalledTimes(1);
    document.documentElement.style.removeProperty('--mf-card');
    document.documentElement.style.removeProperty('--mf-subtext');
  });

  it('모달은 타이틀 바 아래에서 가운데를 잡는다(브라우저에서는 0px = 예전 그대로)', () => {
    // 팝업마다 자기 `padding`을 막에 인라인으로 주므로 padding으로는 밀 수 없다 —
    // 막의 위쪽 자체가 앱 영역에서 시작한다(실측: 갤러리 카드 top 36 → 56, 바 40).
    const src = readFileSync(resolve('src/components/Modal.tsx'), 'utf8');
    expect(src).toContain("top: 'var(--mf-titlebar)'");
    expect(src).not.toContain('inset: 0');
  });

  it('앱 영역은 타이틀 바를 뺀 높이다(화면 루트가 그 값을 쓴다)', () => {
    const css = readFileSync(resolve('src/index.css'), 'utf8');
    expect(css).toContain('--mf-titlebar: 0px');
    expect(css).toContain('--mf-app-h: calc(100dvh - var(--mf-titlebar))');
    expect(css).toContain('padding-top: var(--mf-titlebar)');
    for (const [file, needle] of [
      ['src/features/home/Home.tsx', "height: 'var(--mf-app-h)'"],
      ['src/features/editor/Editor.tsx', "height: 'var(--mf-app-h)'"],
      ['src/features/auth/login.css', 'min-height: var(--mf-app-h)'],
    ] as const) {
      expect(readFileSync(resolve(file), 'utf8'), file).toContain(needle);
    }
  });
});

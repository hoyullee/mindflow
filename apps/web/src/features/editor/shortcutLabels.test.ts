// 단축키 **표기** — 맥 기호 한 벌을 그 기기의 표기로(요청 8).
//
// 이 파일이 지키는 것: 한 벌로 들고 다니는 맥 표기가 윈도·리눅스에서 그 OS의
// 낱말로 나온다는 것. 표기가 어긋나면 사용자는 누를 수 없는 키를 보게 된다.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyLabel, modLabel } from './shortcutLabels';

/** 이 기기가 무엇인지는 `navigator.platform`으로 가른다 — 테스트에서만 바꿔 끼운다. */
function asPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  asPlatform('');
});

describe('단축키 표기', () => {
  it('맥에서는 기호를 그대로 둔다', () => {
    asPlatform('MacIntel');
    expect(modLabel()).toBe('⌘');
    expect(keyLabel('⌘⌥C')).toBe('⌘⌥C');
    expect(keyLabel('⌘⇧V')).toBe('⌘⇧V');
  });

  it('윈도·리눅스에서는 그 OS의 낱말로 — 순서는 적힌 그대로', () => {
    asPlatform('Win32');
    expect(modLabel()).toBe('Ctrl');
    expect(keyLabel('⌘C')).toBe('Ctrl+C');
    expect(keyLabel('⌘⌥C')).toBe('Ctrl+Alt+C');
    expect(keyLabel('⌘⇧V')).toBe('Ctrl+Shift+V');
    // 글자 키만 대문자로 — 기호·화살표는 생긴 그대로다.
    expect(keyLabel('⌘⇧.')).toBe('Ctrl+Shift+.');
    expect(keyLabel('⌥↑')).toBe('Alt+↑');
    expect(keyLabel('⌘\\')).toBe('Ctrl+\\');
  });

  it('홀로 선 맥 글리프는 낱말로 — 윈도 글꼴에 `⌫`·`↵`가 없어 두부가 떴다(실측)', () => {
    asPlatform('Win32');
    expect(keyLabel('⌫')).toBe('Del');
    expect(keyLabel('↵')).toBe('Enter');
    // 맥에서는 그대로다.
    asPlatform('MacIntel');
    expect(keyLabel('⌫')).toBe('⌫');
    expect(keyLabel('↵')).toBe('↵');
  });

  it('그 밖의 수식 없는 표기는 손대지 않는다', () => {
    asPlatform('Win32');
    expect(keyLabel('F2')).toBe('F2');
    expect(keyLabel('')).toBe('');
  });

  it('iOS·iPadOS는 맥과 같은 벌이다', () => {
    asPlatform('iPhone');
    expect(keyLabel('⌘K')).toBe('⌘K');
  });
});

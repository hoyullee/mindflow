import { describe, expect, it } from 'vitest';
import { clipText, normalizeNewlines } from './clipText';

describe('clipText — 클립보드 평문의 줄 끝', () => {
  it('`\\r\\n`(윈도우)·홀로 선 `\\r`(옛 맥)을 `\\n` 하나로', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(normalizeNewlines('a\r\n\r\nb')).toBe('a\n\nb');
  });
  it('이미 `\r`이 섞여 저장된 글을 다시 잘라낸 `\r\r\n`도 줄바꿈 하나 — 한 번 붙이면 낫는다', () => {
    expect(normalizeNewlines('a\r\r\nb\r\r\n\r\r\nc')).toBe('a\nb\n\nc');
  });
  it('클립보드가 없거나 비었으면 빈 글', () => {
    expect(clipText(null)).toBe('');
    expect(clipText({ getData: () => '' } as unknown as DataTransfer)).toBe('');
    expect(clipText({ getData: (t: string) => (t === 'text/plain' ? 'x\r\ny' : '') } as unknown as DataTransfer)).toBe('x\ny');
  });
});

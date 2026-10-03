import { describe, expect, it } from 'vitest';
import { pointerHidesWhileTyping } from './pickerPointer';

describe('pointerHidesWhileTyping', () => {
  it('Windows만 걸린다', () => {
    expect(pointerHidesWhileTyping({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' })).toBe(true);
    expect(pointerHidesWhileTyping({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/140.0' })).toBe(false);
    expect(pointerHidesWhileTyping(undefined)).toBe(false);
  });
});

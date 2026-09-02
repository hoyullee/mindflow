import { afterEach, describe, expect, it } from 'vitest';
import { clearNameBook, knownName, knownNamesFor, rememberName, rememberNames } from './nameBook';

describe('이름 장부(nameBook)', () => {
  afterEach(clearNameBook);

  it('대소문자·공백을 가리지 않고 한 사람으로 본다', () => {
    rememberName(' Eunjin.Yeo@Example.com ', '여은진');
    expect(knownName('eunjin.yeo@example.com')).toBe('여은진');
    expect(knownNamesFor(['EUNJIN.YEO@example.com', 'nobody@example.com'])).toEqual({ 'EUNJIN.YEO@example.com': '여은진' });
  });

  it('먼저 본 이름을 지키고, 빈 이름·이메일과 같은 이름은 적지 않는다', () => {
    rememberName('a@x.com', '첫 이름');
    rememberName('a@x.com', '나중 이름');
    expect(knownName('a@x.com')).toBe('첫 이름');
    rememberNames({ 'b@x.com': '', 'c@x.com': 'c@x.com' });
    expect(knownName('b@x.com')).toBeUndefined();
    expect(knownName('c@x.com')).toBeUndefined();
  });

  it('비우면 다음 계정에 남지 않는다', () => {
    rememberName('a@x.com', '이름');
    clearNameBook();
    expect(knownName('a@x.com')).toBeUndefined();
  });
});

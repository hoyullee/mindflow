import { describe, expect, it } from 'vitest';
import { arrowAt } from './noteArrows';

describe('arrowAt — 친 직후 캐럿 앞의 화살표 짝', () => {
  it('`->` → `→` · `<-` → `←` · `←>`(곧 `<->`) → `↔`', () => {
    expect(arrowAt('a->', 3)).toEqual({ start: 1, len: 2, to: '→' });
    expect(arrowAt('x<-', 3)).toEqual({ start: 1, len: 2, to: '←' });
    expect(arrowAt('←>', 2)).toEqual({ start: 0, len: 2, to: '↔' });
  });
  it('캐럿 바로 앞이 아니면 바꾸지 않는다', () => {
    expect(arrowAt('->a', 3)).toBeNull();
    expect(arrowAt('-', 1)).toBeNull();
    expect(arrowAt('>', 1)).toBeNull();
  });
});

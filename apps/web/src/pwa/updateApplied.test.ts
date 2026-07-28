import { afterEach, describe, expect, it } from 'vitest';
import { consumeUpdateApplied, markUpdateApplied } from './updateApplied';

afterEach(() => sessionStorage.clear());

// 제보: 조용히 적용됐든 토스트로 물어본 뒤 적용됐든, 새 버전이 적용됐다는 알림을 보여 달라.
// 적용은 곧 리로드라 적용한 쪽에서는 띄울 수 없다 — 표식을 남기고 새로 뜬 페이지가 알린다.
describe('updateApplied (적용됐다는 표식)', () => {
  it('표식이 없으면 알리지 않는다 (평범한 방문)', () => {
    expect(consumeUpdateApplied()).toBe(false);
  });

  it('적용 직전에 남긴 표식을 새 페이지가 소비한다', () => {
    markUpdateApplied(1_000);
    expect(consumeUpdateApplied(1_200)).toBe(true);
  });

  it('한 번만 알린다 — 그 다음 리로드에는 뜨지 않는다', () => {
    markUpdateApplied(1_000);
    expect(consumeUpdateApplied(1_100)).toBe(true);
    expect(consumeUpdateApplied(1_200)).toBe(false);
  });

  it('오래된 표식은 무시한다 (리로드가 오지 않은 경우의 유령 알림 방지)', () => {
    markUpdateApplied(1_000);
    expect(consumeUpdateApplied(1_000 + 61_000)).toBe(false);
  });

  it('sessionStorage라 탭을 닫으면 사라진다 (다음 방문에 안 뜬다)', () => {
    markUpdateApplied(1_000);
    sessionStorage.clear(); // 새 탭 = 빈 sessionStorage
    expect(consumeUpdateApplied(1_100)).toBe(false);
  });
});

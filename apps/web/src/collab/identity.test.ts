// 게스트 정체성(이름·색)의 **결정성**. `usePresence.test.ts`는 훅이 이 함수를 쓴다는
// 것까지만 보고, 여기서 성질을 결정적으로 검증한다 — 훅 쪽에서 "무작위 두 개가 서로
// 다르다"를 단정하면 12×12=144개 조합에서 우연히 같을 때 실패하는 깜빡이는 테스트가
// 된다(실제로 이 저장소에서 두 번 겪었다).

import { describe, expect, it } from 'vitest';
import { colorForSeed, nameForSeed } from './identity';

describe('게스트 정체성', () => {
  it('같은 씨앗이면 항상 같은 이름·색 — 재연결·리렌더에 이름이 바뀌지 않는다', () => {
    expect(nameForSeed('1234')).toBe(nameForSeed('1234'));
    expect(colorForSeed('1234')).toBe(colorForSeed('1234'));
    expect(nameForSeed('hoyul@example.com')).toBe(nameForSeed('hoyul@example.com'));
  });

  it('"형용사 동물" 두 낱말 꼴이다', () => {
    expect(nameForSeed('42')).toMatch(/^\S+ \S+$/);
  });

  it('씨앗이 흩어지면 이름도 흩어진다 (한 이름에 몰리지 않는다)', () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => nameForSeed(String(i * 7919))));
    // 144개 조합이므로 200개 씨앗이면 충분히 여러 이름이 나온다. 정확한 개수를 못 박지
    // 않는 이유: 해시 분포에 의존하는 수치를 고정하면 그게 또 깨지기 쉬운 단정이 된다.
    expect(names.size).toBeGreaterThan(20);
  });

  it('색은 팔레트 안의 hex 하나다', () => {
    expect(colorForSeed('x')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

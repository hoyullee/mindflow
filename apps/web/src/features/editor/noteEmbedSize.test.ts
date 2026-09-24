// 임베드 판이 마지막에 몇 px이었나 — 다시 들어왔을 때 자리를 미리 잡으려고 남긴다.

import { beforeEach, describe, expect, it } from 'vitest';
import { readEmbedHeight, writeEmbedHeight } from './noteEmbedSize';

describe('임베드 높이 기억', () => {
  beforeEach(() => localStorage.clear());

  it('적어 둔 높이를 그대로 돌려준다', () => {
    writeEmbedHeight('b1', 342);
    expect(readEmbedHeight('b1')).toBe(342);
    // 모르는 블록은 `null`이다 — 0을 돌려주면 판이 접힌 채로 시작한다.
    expect(readEmbedHeight('b2')).toBeNull();
  });

  it('**범위 밖은 적지 않는다** — 아직 0인 첫 프레임이나 터무니없는 값은 기억할 값이 아니다', () => {
    writeEmbedHeight('b1', 0);
    writeEmbedHeight('b1', 4000);
    writeEmbedHeight('b1', Number.NaN);
    expect(readEmbedHeight('b1')).toBeNull();
  });

  it('소수는 반올림해 적는다 — px 단위의 자리다', () => {
    writeEmbedHeight('b1', 280.6);
    expect(readEmbedHeight('b1')).toBe(281);
  });

  it('많이 열어도 무한히 자라지 않는다 — 오래된 것부터 버린다', () => {
    for (let i = 0; i < 320; i += 1) writeEmbedHeight(`b${i}`, 200 + (i % 50));
    const store = JSON.parse(localStorage.getItem('mf_embed_h') as string) as Record<string, number>;
    expect(Object.keys(store).length).toBeLessThanOrEqual(300);
    // 방금 적은 것은 남아 있고, 맨 처음 것은 없다.
    expect(readEmbedHeight('b319')).not.toBeNull();
    expect(readEmbedHeight('b0')).toBeNull();
  });

  it('망가진 값이 들어 있어도 읽기가 터지지 않는다', () => {
    localStorage.setItem('mf_embed_h', '{not json');
    expect(readEmbedHeight('b1')).toBeNull();
    // 그 위에 적는 것도 된다(깨진 판을 새로 세운다).
    writeEmbedHeight('b1', 300);
    expect(readEmbedHeight('b1')).toBe(300);
  });
});

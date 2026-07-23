import { describe, expect, it } from 'vitest';
import { ROOT_ID } from '@mindflow/mindmap-core';
import { seedDoc } from './storage';

describe('seedDoc — 새 마인드맵 기본값', () => {
  it('루트는 제목만, 기본 이모지 없음 (사용자 요청: "{이모지} 새 마인드맵" 금지)', () => {
    const doc = seedDoc('');
    expect(doc.nodes[ROOT_ID]?.text).toBe('새 마인드맵');
    expect(doc.nodes[ROOT_ID]?.emoji).toBe('');
  });

  it('제목이 주어지면 그대로 쓴다', () => {
    expect(seedDoc('회의 정리').nodes[ROOT_ID]?.text).toBe('회의 정리');
  });
});

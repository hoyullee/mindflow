import { describe, expect, it } from 'vitest';
import type { Float } from '@mindflow/mindmap-core';
import { measureFloatHeight } from './metrics';
import type { TextMeasurer } from './metrics';

// `measureFloatHeight` gives a memo card its REAL (grown-to-fit) height so line
// anchoring / hit-testing use the actual box, not a fixed 44px one (the reported
// bug: a tall memo's connect range stayed pinned to the top).

// Deterministic fake measurer: 8px per char, CJK counted as ~14px — enough to
// force wrapping without depending on a real canvas (jsdom has none).
const fakeMeasurer: TextMeasurer = {
  measure(text) {
    let w = 0;
    for (const ch of text) w += /[가-힣]/.test(ch) ? 14 : 8;
    return w;
  },
};

const mkFloat = (over: Partial<Float>): Float => ({ id: 'f', x: 0, y: 0, w: 190, text: '', ...over });

describe('measureFloatHeight', () => {
  it('returns the 44px default for a short one-line memo', () => {
    expect(measureFloatHeight(mkFloat({ text: '메모' }), fakeMeasurer)).toBe(44);
  });

  it('grows with hard line breaks (a 4-line memo is much taller than 44)', () => {
    const oneLine = measureFloatHeight(mkFloat({ text: '한 줄' }), fakeMeasurer);
    const fourLines = measureFloatHeight(mkFloat({ text: '한 줄\n두 줄\n세 줄\n네 줄' }), fakeMeasurer);
    expect(oneLine).toBe(44);
    expect(fourLines).toBeGreaterThan(90); // 4 × ~20px line-height + padding
    expect(fourLines).toBeGreaterThan(oneLine);
  });

  it('grows when long text soft-wraps past the inner width', () => {
    const wrapped = measureFloatHeight(mkFloat({ text: '아주 아주 아주 아주 아주 아주 아주 긴 한 줄짜리 메모 텍스트입니다 계속 이어집니다' }), fakeMeasurer);
    expect(wrapped).toBeGreaterThan(44); // wrapped onto multiple lines → taller
  });

  it('never shrinks below a user-resized height', () => {
    expect(measureFloatHeight(mkFloat({ text: '메모', h: 160 }), fakeMeasurer)).toBe(160);
  });

  it('collapses to a compact single-line box when collapsed', () => {
    const h = measureFloatHeight(mkFloat({ text: '한 줄\n두 줄\n세 줄', collapsed: true }), fakeMeasurer);
    expect(h).toBeLessThanOrEqual(44);
  });
});

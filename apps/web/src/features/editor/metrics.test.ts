import { describe, expect, it } from 'vitest';
import type { Float, Node } from '@mindflow/mindmap-core';
import { computeMetrics, measureFloatHeight } from './metrics';
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

// 회귀(사용자 제보): 긴 텍스트 노드를 텍스트 폭에 배율을 곱하는 도형(타원·
// 육각형·마름모·평행사변형)으로 바꾼 뒤 크기 조절을 시작하면, 첫 픽셀에
// cw가 기록되는 순간 줄바꿈 허용 폭이 cw 기준으로 넓어지고 → 풀린 긴 줄에
// 배율이 곱해져 자연 폭이 cw를 넘어 좌우로 폭발했다. computeMetrics의
// 과팽창 되돌림(기본 랩 320 재계산)이 이를 막는다.
describe('computeMetrics — resize monotonicity (텍스트 배율 도형)', () => {
  const LONG_TEXT = '아주 긴 텍스트가 들어있는 도형에서 크기 조절을 시작하면 줄바꿈이 다시 계산되면서 폭이 갑자기 커지는 문제를 재현하기 위한 문장입니다';
  const nodeWith = (shape: string, cw?: number): Node =>
    ({ id: 'n1', text: LONG_TEXT, emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0, shape, ...(cw ? { cw } : {}) }) as Node;

  for (const shape of ['ellipse', 'hexagon', 'diamond', 'parallelogram', 'round', 'rect', 'pill', 'underline']) {
    it(`${shape}: cw를 +5px 늘리면 폭도 정확히 +5px만 커진다 (폭발 금지)`, () => {
      const natural = computeMetrics(nodeWith(shape), 1, fakeMeasurer);
      const resized = computeMetrics(nodeWith(shape, natural.w + 5), 1, fakeMeasurer);
      expect(resized.w).toBe(natural.w + 5);
    });
  }

  it('cw가 충분히 커지면 넓힌 줄바꿈(텍스트 풀림)이 자연히 반영된다', () => {
    const natural = computeMetrics(nodeWith('ellipse'), 1, fakeMeasurer);
    const big = computeMetrics(nodeWith('ellipse', Math.ceil(natural.w * 4)), 1, fakeMeasurer);
    expect(big.w).toBe(Math.ceil(natural.w * 4)); // 여전히 max(자연폭, cw) = cw
    expect(big.h).toBeLessThanOrEqual(natural.h); // 줄 수가 줄어 높이 감소 = 풀림의 증거
  });

  it('wrapW는 실제 사용한 랩 폭을 보고한다 (미리보기 줄바꿈 동기화 계약)', () => {
    const natural = computeMetrics(nodeWith('ellipse'), 1, fakeMeasurer);
    expect(natural.wrapW).toBe(320);
    // 과팽창이 되돌려진 경우에도 320을 보고해야 미리보기가 같은 폭으로 감싼다
    const resized = computeMetrics(nodeWith('ellipse', natural.w + 5), 1, fakeMeasurer);
    expect(resized.wrapW).toBe(320);
  });
});

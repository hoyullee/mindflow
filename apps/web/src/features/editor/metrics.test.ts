import { describe, expect, it } from 'vitest';
import type { Float, Node } from '@mindflow/mindmap-core';
import { CanvasTextMeasurer, computeMetrics, measureFloatHeight } from './metrics';
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

  // 회귀(사용자 제보): 여러 줄짜리 긴 텍스트를 넣은 도형의 좌우 크기를 조절하면
  // 위아래 크기가 제멋대로 오르내렸다. 원인은 위 과팽창 되돌림이 **엉뚱하게**
  // 발동한 것 — `wrapMeasure`가 줄을 끊을 때 후행 공백까지 줄 폭에 넣어 자연 폭이
  // cw를 몇 px 넘겼고, 그 순간 랩 폭이 320으로 떨어져 줄 수가 늘며 높이가 뛰었다.
  // 폭을 계속 끌면 조건이 켜졌다 꺼졌다 하면서 높이가 진동한다.
  describe('가로로 늘려도 세로가 흔들리지 않는다', () => {
    // 여기서는 `fakeMeasurer`(정수 폭)를 쓰지 않는다 — 폭이 정수로 딱 떨어지면
    // 후행 공백이 maxW를 넘기지 못해 버그가 재현되지 않는다. 실제 앱이 캔버스를
    // 못 쓸 때 쓰는 근사 측정기(소수 폭)가 재현 조건이고, 실브라우저 캔버스도
    // 소수 폭이라 이쪽이 현실에 가깝다.
    const realish = new CanvasTextMeasurer();

    // 공백이 섞인 여러 줄 텍스트 — 후행 공백이 줄 끝에 걸려야 재현된다.
    const MULTILINE =
      '원티드에서 첫 이력서 작성 시 적립\n' +
      '[원티드 홈 > 이력서] 에서 [새 이력서 작성] 버튼을 클릭하여 이력서를 작성\n' +
      '원티드 이력서 양식을 사용하여 이력서를 작성한 경우에만 포인트 적립 대상\n' +
      '이력서는 400자 이상 작성 후 [작성 완료] 버튼을 눌러 이력서가 생성되어야 포인트를 적립 가능';
    const shaped = (shape: string, cw: number, ch?: number): Node =>
      ({ id: 'n1', text: MULTILINE, emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0, shape, cw, ...(ch ? { ch } : {}) }) as Node;

    // depth 2 / 시작 폭 400 = 제보된 재현 조건(수정 전 round·rect에서 높이가 9번 튀었다).
    const START = 400;
    const DEPTH = 2;

    for (const shape of ['round', 'rect', 'pill', 'ellipse', 'hexagon', 'diamond', 'parallelogram']) {
      it(`${shape}: 가로로 끄는 동안 높이가 커지지 않고 랩 폭도 되돌아가지 않는다`, () => {
        // 리사이즈 시작 시점의 크기를 cw/ch로 고정 = 실제 드래그와 같은 조건
        // (beginNodeResize가 현재 기하를 ow/oh로 잡고, 가로 드래그는 dy=0이라
        // ch가 시작 높이에 그대로 머문다).
        const ch = computeMetrics(shaped(shape, START), DEPTH, realish).h;
        let prevH = Infinity;
        let prevWrap = -Infinity;
        for (let cw = START; cw <= 1200; cw += 5) {
          const r = computeMetrics(shaped(shape, cw, ch), DEPTH, realish);
          // 사용자가 본 증상: 폭을 넓히는데 높이가 제멋대로 오르내렸다.
          expect(r.h).toBeLessThanOrEqual(prevH);
          // 그 원인: 랩 폭이 cw↔320을 오가며 줄 수가 바뀌었다. 폭을 넓히는 동안
          // 랩 폭은 줄어들 수 없다 — 이 단조성이 깨지는 게 곧 높이 진동이다.
          expect(r.wrapW).toBeGreaterThanOrEqual(prevWrap);
          prevH = r.h;
          prevWrap = r.wrapW;
        }
      });
    }
  });

  it('wrapW는 실제 사용한 랩 폭을 보고한다 (미리보기 줄바꿈 동기화 계약)', () => {
    const natural = computeMetrics(nodeWith('ellipse'), 1, fakeMeasurer);
    expect(natural.wrapW).toBe(320);
    // 과팽창이 되돌려진 경우에도 320을 보고해야 미리보기가 같은 폭으로 감싼다
    const resized = computeMetrics(nodeWith('ellipse', natural.w + 5), 1, fakeMeasurer);
    expect(resized.wrapW).toBe(320);
  });
});

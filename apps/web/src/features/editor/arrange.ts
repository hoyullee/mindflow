// 정렬·분배 계산 — 화면 좌표의 **박스 목록**만 다루는 순수 함수(요청).
//
// 에디터의 대상은 종류가 제각각이다(메모·자유 주제·연결선·그리기 획). 각자 좌표를
// 담는 방식이 다르므로(플로트는 좌상단+측정 높이, 노드는 중심+geom, 선은 두 끝점,
// 획은 점 배열) 컨트롤러가 전부 **좌상단 기준 박스**로 환산해 여기 넘기고, 여기서는
// "얼마나 옮길지"(dx,dy)만 돌려준다. 실제 이동은 종류별 변형이 맡는다 — 그래서 이
// 파일은 DOM도 문서 모델도 모르고, 계산만 단위 테스트할 수 있다.

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeOp = 'hspace' | 'vspace';
export type ArrangeOp = AlignOp | DistributeOp;

/** 좌상단 기준 박스. */
export interface ArrangeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Delta {
  dx: number;
  dy: number;
}

export function isDistributeOp(op: ArrangeOp): op is DistributeOp {
  return op === 'hspace' || op === 'vspace';
}

/** 정렬은 2개, 분배는 3개부터 뜻이 있다(둘은 이미 "균등"하다). */
export function minTargets(op: ArrangeOp): number {
  return isDistributeOp(op) ? 3 : 2;
}

/**
 * 선택 전체를 감싸는 상자를 기준으로 정렬한다(Figma·PowerPoint와 같은 규칙 —
 * "무엇에 맞출 것인가"를 사용자가 따로 고르지 않아도 되고, 어느 하나가 기준일
 * 때보다 결과가 예측하기 쉽다).
 */
function alignDeltas(boxes: Record<string, ArrangeBox>, op: AlignOp): Record<string, Delta> {
  const ids = Object.keys(boxes);
  const out: Record<string, Delta> = {};
  if (ids.length < 2) return out;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ids.forEach((id) => {
    const b = boxes[id]!;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  ids.forEach((id) => {
    const b = boxes[id]!;
    let dx = 0;
    let dy = 0;
    if (op === 'left') dx = minX - b.x;
    else if (op === 'right') dx = maxX - (b.x + b.w);
    else if (op === 'hcenter') dx = cx - (b.x + b.w / 2);
    else if (op === 'top') dy = minY - b.y;
    else if (op === 'bottom') dy = maxY - (b.y + b.h);
    else dy = cy - (b.y + b.h / 2);
    out[id] = { dx, dy };
  });
  return out;
}

/**
 * 간격을 균등하게 — 양 끝 두 개는 **그대로 두고** 사이 것들을 옮긴다.
 *
 * 중심을 균등 배치하지 않고 **가장자리 사이 간격**을 균등하게 하는 이유: 크기가
 * 제각각인 스티커들에서 중심 균등은 큰 것 옆이 좁아 보인다(PowerPoint의 "간격을
 * 동일하게", Figma의 distribute spacing과 같은 규칙).
 */
function distributeDeltas(boxes: Record<string, ArrangeBox>, op: DistributeOp): Record<string, Delta> {
  const ids = Object.keys(boxes);
  const out: Record<string, Delta> = {};
  if (ids.length < 3) return out;
  const horiz = op === 'hspace';
  const pos = (b: ArrangeBox): number => (horiz ? b.x : b.y);
  const size = (b: ArrangeBox): number => (horiz ? b.w : b.h);
  const sorted = [...ids].sort((a, b) => pos(boxes[a]!) - pos(boxes[b]!));
  const first = boxes[sorted[0]!]!;
  const last = boxes[sorted[sorted.length - 1]!]!;
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((acc, id) => acc + size(boxes[id]!), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first);
  sorted.forEach((id, i) => {
    const b = boxes[id]!;
    // 양 끝은 고정 — 떠 있는 사이 것들만 자리를 다시 잡는다.
    const target = i === 0 ? pos(first) : i === sorted.length - 1 ? pos(last) : cursor;
    const d = target - pos(b);
    out[id] = horiz ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor = target + size(b) + gap;
  });
  return out;
}

/** 정렬·분배 공통 진입점 — 옮길 양(dx,dy)을 id별로 돌려준다(0이면 그대로). */
export function arrangeDeltas(boxes: Record<string, ArrangeBox>, op: ArrangeOp): Record<string, Delta> {
  return isDistributeOp(op) ? distributeDeltas(boxes, op) : alignDeltas(boxes, op as AlignOp);
}

/** 격자 간격(캔버스 단위) — 화면의 도트 배경은 팬/줌과 무관한 **장식**이라
 * 문서 좌표의 격자가 아니다(배경 레이어는 팬 레이어 밖에 있다). 그래서 격자는
 * 우리가 정한 문서 좌표계의 값이다: 10은 메모(200×90)를 나란히 놓기에 충분히
 * 촘촘하면서, 붙는 느낌이 손을 방해하지 않는 크기다. */
export const SNAP_GRID = 10;

/** 격자에 맞춘 값. `on`이 false면 그대로 — 호출부가 분기하지 않게 여기서 받는다. */
export function snapValue(v: number, on: boolean, grid = SNAP_GRID): number {
  return on ? Math.round(v / grid) * grid : v;
}

// ── 스마트 가이드(맞춤 안내선) ─────────────────────────────────────────────
//
// 끌고 있는 상자의 여섯 기준선(왼쪽·가로중심·오른쪽 / 위·세로중심·아래)을 **다른
// 객체들의 같은 기준선**과 견줘, 허용치 안에서 가장 가까운 것에 붙인다. 격자보다
// 먼저 적용한다: 격자는 "어딘가 반듯한 자리"지만 안내선은 "이것과 맞춘다"라는
// 사용자의 의도에 훨씬 가깝다(그래서 둘 다 켜져 있어도 안내선이 이긴다).

export type GuideAxis = 'x' | 'y';

/** 그릴 안내선 하나 — 축 위치(`at`)와 그 선이 걸치는 구간(`from`~`to`). */
export interface SnapGuide {
  axis: GuideAxis;
  at: number;
  from: number;
  to: number;
}

export interface GuideResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/** 상자의 축별 기준선 셋 — 시작·중심·끝. */
function linesOf(b: ArrangeBox, axis: GuideAxis): [number, number, number] {
  return axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h];
}

function matchAxis(moving: ArrangeBox, others: ArrangeBox[], axis: GuideAxis, tol: number): { delta: number; at: number; hits: ArrangeBox[] } | null {
  const mine = linesOf(moving, axis);
  let best: { delta: number; at: number } | null = null;
  others.forEach((o) => {
    linesOf(o, axis).forEach((line) => {
      mine.forEach((m) => {
        const delta = line - m;
        if (Math.abs(delta) > tol) return;
        // 같은 거리면 먼저 만난 것을 지킨다(끌 때 안내선이 흔들리지 않게).
        if (!best || Math.abs(delta) < Math.abs(best.delta) - 0.001) best = { delta, at: line };
      });
    });
  });
  if (!best) return null;
  const chosen: { delta: number; at: number } = best;
  // 같은 선에 걸린 다른 상자들도 모아 안내선을 그만큼 길게 그린다.
  const hits = others.filter((o) => linesOf(o, axis).some((line) => Math.abs(line - chosen.at) < 0.001));
  return { delta: chosen.delta, at: chosen.at, hits };
}

/**
 * 끌고 있는 상자를 이웃에 맞춘다. 축마다 따로 판단하므로 가로만·세로만 붙는 것도
 * 자연스럽다. `tol`은 **캔버스 단위**(호출부가 화면 px을 줌으로 나눠 넘긴다 —
 * 확대해도 손끝 감각이 같아야 한다).
 */
export function alignGuides(moving: ArrangeBox, others: ArrangeBox[], tol: number): GuideResult {
  const mx = matchAxis(moving, others, 'x', tol);
  const my = matchAxis(moving, others, 'y', tol);
  const x = moving.x + (mx?.delta ?? 0);
  const y = moving.y + (my?.delta ?? 0);
  const snapped: ArrangeBox = { ...moving, x, y };
  const guides: SnapGuide[] = [];
  if (mx) {
    // 세로 안내선 — 걸린 상자들과 끌고 있는 상자를 세로로 잇는다.
    const boxes = [snapped, ...mx.hits];
    guides.push({ axis: 'x', at: mx.at, from: Math.min(...boxes.map((b) => b.y)), to: Math.max(...boxes.map((b) => b.y + b.h)) });
  }
  if (my) {
    const boxes = [snapped, ...my.hits];
    guides.push({ axis: 'y', at: my.at, from: Math.min(...boxes.map((b) => b.x)), to: Math.max(...boxes.map((b) => b.x + b.w)) });
  }
  return { x, y, guides };
}

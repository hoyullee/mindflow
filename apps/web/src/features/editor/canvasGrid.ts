/** 캔버스 도트 격자 — 배율에 따른 간격·반지름(순수).
 *
 * 격자는 **문서 좌표에 붙어 있다**(요청: Figma처럼 실제 비율로) — 확대하면 벌어지고
 * 축소하면 좁아진다. 다만 좁히기만 하면 축소에서 도트가 얼룩처럼 뭉친다(0.25배에서
 * 6.5px 간격 = 시각 잡음, 실측). Figma도 같은 자리에서 **격자 단계를 건너뛴다** —
 * 간격이 너무 좁아지면 두 칸·네 칸마다 하나만 그린다. 배수가 2의 거듭제곱이라
 * 남는 도트는 여전히 문서 격자 위에 정확히 서고(비율이 어긋나지 않는다) 눈에는
 * 편안한 간격이 유지된다.
 */
export const GRID_UNIT = 26;
/** 이보다 좁아지면 한 단계 건너뛴다(화면 px). */
const MIN_CELL = 14;

export interface DotGrid {
  /** 화면 px 기준 격자 간격. */
  cell: number;
  /** 도트 반지름(화면 px). */
  radius: number;
  /** 문서 격자 몇 칸마다 하나를 그리는가(1·2·4…). */
  step: number;
}

export function dotGrid(zoom: number): DotGrid {
  const base = GRID_UNIT * Math.max(zoom, 0.01);
  let step = 1;
  while (base * step < MIN_CELL && step < 64) step *= 2;
  return {
    cell: base * step,
    // 반지름도 배율을 따르되 하한을 둔다 — 1px 아래로 내려가면 도트가 통째로
    // 사라져 "격자가 없어졌다"로 보인다.
    radius: Math.max(0.8, Math.min(1.2 * zoom, 3.2)),
    step,
  };
}

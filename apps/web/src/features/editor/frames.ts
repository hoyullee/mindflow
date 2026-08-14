// 프레임(영역)을 **그릇**으로 — "무엇이 이 프레임 안에 있는가"를 정하는 순수 규칙.
//
// 소속을 문서에 적는 필드(`Float.zone` 같은 것)를 두지 않고 **기하로 판정**한다.
// 두 방식은 사실 대부분의 순간에 같은 답을 낸다(소속 필드를 쓰더라도 그 값을
// 정하는 것은 결국 놓는 순간의 기하다) — 갈리는 것은 나중에 프레임을 옮기거나
// 줄여서 **저장된 소속과 화면이 어긋날 때**이고, 그때는 화면이 이기는 편이 낫다:
// 이 앱의 프레임은 눈에 보이는 사각형이고 사용자가 읽는 규칙은 "이 안에 있는 것"
// 하나다. 덤으로 모델·직렬화·CRDT·마이그레이션이 전혀 늘지 않고, 소속 필드를
// 빠뜨린 경로가 만드는 "화면엔 안에 있는데 따라오지 않는" 유령 상태도 없다.
//
// 판정은 **중심점**이다(넓이 겹침이 아니라): 가장자리에 걸친 스티커가 두 프레임에
// 동시에 속하는 일이 없고, 사용자가 "이건 이 칸에 넣은 것"이라고 느끼는 지점과
// 일치한다.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IdBox extends Box {
  id: string;
}

/** 상자의 중심이 프레임 안에 있는가. 경계에 정확히 걸치면 안쪽으로 친다. */
export function centerInside(frame: Box, box: Box): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h;
}

/**
 * 상자가 프레임에 **완전히** 들어가는가.
 *
 * 프레임이 프레임을 담을 때 쓰는 규칙이다(물건은 위의 중심 규칙 그대로). 중심만
 * 보면 **서로가 서로를 담는 일이 생긴다** — 큰 프레임의 중심이 작은 프레임 안에
 * 들어가는 배치가 흔하고(실측: 작은 240×160 안에 620×420의 중심이 든다),
 * 부분 겹침에서도 양쪽 중심이 상대 안에 들어갈 수 있다. 그러면 어느 쪽을 끌어도
 * 상대가 통째로 따라와 화면이 꼬인다(제보). 완전 포함은 한쪽으로만 성립하므로
 * 계층이 언제나 한 방향이다: 안에 든 프레임은 따라오고, 부분 겹침은 형제다.
 */
export function fullyInside(frame: Box, box: Box): boolean {
  return box.x >= frame.x && box.y >= frame.y && box.x + box.w <= frame.x + frame.w && box.y + box.h <= frame.y + frame.h;
}

/** 겹친 프레임들 중 이 점을 담는 **가장 작은** 것 — 클릭·우클릭이 늘 안쪽에 닿게. */
export function innermostFrameAt(frames: IdBox[], x: number, y: number, padTop = 0): string | null {
  let best: IdBox | null = null;
  frames.forEach((f) => {
    if (x < f.x || x > f.x + f.w || y < f.y - padTop || y > f.y + f.h) return;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  });
  return best ? (best as IdBox).id : null;
}

/** 이 프레임이 담고 있는 것들의 id. */
export function idsInFrame(frame: Box, boxes: IdBox[]): string[] {
  return boxes.filter((b) => centerInside(frame, b)).map((b) => b.id);
}

/**
 * 이 상자를 담게 될 프레임 — 여러 개가 겹쳐 있으면 **가장 작은(안쪽) 것**을 고른다.
 * 드래그 중 "여기에 넣는 중"을 알려 주는 강조에 쓴다(어느 프레임을 끌든 자기 안의
 * 것은 함께 따라오므로, 소속 자체는 겹친 프레임 모두에 대해 성립한다).
 */
export function innermostFrameFor(frames: IdBox[], box: Box): string | null {
  let best: IdBox | null = null;
  frames.forEach((f) => {
    if (!centerInside(f, box)) return;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  });
  return best ? (best as IdBox).id : null;
}

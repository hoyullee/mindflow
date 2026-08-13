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

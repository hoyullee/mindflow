// 일정 칩의 색 — **칸반 에디터와 같은 규칙**을 쓴다.
//
// 칩은 "분류색 옅은 알약 + 열 색 점"이다(디자인 원본의 Geurio 마감 문법). 색을 여기서
// 새로 정하지 않고 `kanbanMeta`의 그 함수들을 그대로 부르는 이유는 드리프트다 — 같은
// 카드가 에디터·홈 썸네일·대시보드 위젯·일정 화면에서 다른 색이면 그게 곧 버그다.
//
// 팔레트는 칸반 화면과 같은 **고정 UI_THEME**(칸반 에디터는 문서 테마를 쓰지 않는다 —
// #513에서 위젯이 문서 테마를 읽어 색이 갈렸던 그 교훈).

import { UI_THEME, mixHex } from '../../editor/theme';
import { columnColor, tagColor, tagInk } from '../../editor/kanbanMeta';
import type { CalendarEntry } from './entries';

export interface EntryChip {
  bg: string;
  fg: string;
  dot: string;
  /**
   * 시간표 블록·날짜별 행의 **면** — 디자인 시안의 두 값(제보: 우리 것은 색이 너무
   * 진했다): Geurio·칸반은 따뜻한 중립 `rgb(247,243,238)`, 구글 일정은 옅은 파랑
   * `rgb(241,245,252)`. 값을 그대로 박지 않고 **카드 면에서 파생**한다(라이트에서
   * 그 값이 정확히 나오는 앵커·비율 — 다크 홈에서도 어두운 면 위에서 성립).
   * 왼쪽 색 바(`dot`)는 그대로라, 면은 물러나고 바가 출처·상태를 말한다.
   */
  tint: string;
}

/**
 * `surface`는 칩이 놓이는 면(홈 테마의 카드 면·글자색)이다. hue는 고정 팔레트에서,
 * **밝기는 면에서** — 그래서 다크 홈에서도 칩이 격자 위에 홀로 빛나지 않는다.
 */
export function entryChip(e: CalendarEntry, surface: ChipSurface): EntryChip {
  // 분류가 없는 카드도 알약이어야 하니 이름 없는 값으로 색을 뽑는다(결정적).
  const base = e.tagColor ?? tagColor(e.tag, UI_THEME.palette);
  const dot = columnColor({ id: e.colId, title: e.colName, ...(e.colColor ? { color: e.colColor } : {}) }, e.colIndex, UI_THEME.palette);
  return {
    bg: mixHex(surface.card, base, 0.16),
    fg: tagInk(base, surface.text),
    dot,
    // 라이트 카드(#FFFDFB) 실측: 그 밖 rgb(247,243,238)은 시안 값 그대로, 구글은
    // rgb(241,245,251) — 시안(252)과 파랑 1/255 차이(카드 파랑이 251이라 한 비율로는
    // 못 올린다). 육안 구분 불가라 파생 규칙을 지키는 쪽을 골랐다.
    tint: e.google ? mixHex(surface.card, '#63a4ff', 0.09) : mixHex(surface.card, '#9b8059', 0.08),
  };
}

export interface ChipSurface {
  card: string;
  text: string;
}

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
}

export function entryChip(e: CalendarEntry): EntryChip {
  const th = UI_THEME;
  // 분류가 없는 카드도 알약이어야 하니 이름 없는 값으로 색을 뽑는다(결정적).
  const base = e.tagColor ?? tagColor(e.tag, th.palette);
  return {
    bg: mixHex(th.panel, base, 0.16),
    fg: tagInk(base, th.text),
    dot: columnColor({ id: e.colId, title: e.colName, ...(e.colColor ? { color: e.colColor } : {}) }, e.colIndex, th.palette),
  };
}

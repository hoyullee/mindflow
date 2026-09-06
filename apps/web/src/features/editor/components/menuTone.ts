// 에디터의 우클릭 메뉴 색 — 인라인 `Theme` 객체를 공용 `MenuTone`으로 옮긴다.
//
// 홈은 CSS 변수(`CSS_MENU_TONE`)를 쓰고 에디터는 자기 팔레트를 인라인으로 든다.
// 두 세계가 **같은 디자인**(`components/menuDesign.ts`)을 쓰려면 색만 이렇게
// 옮겨 주면 된다(`DateTone`·`ShareTheme`와 같은 처방).

import type { MenuTone } from '../../../components/menuDesign';
import { hexA } from '../theme';
import type { Theme } from '../theme';

/** 위험(삭제) 행의 색 — 테마와 무관하게 "위험"으로 읽히는 값. */
export const MENU_DANGER = '#d64545';

export function editorMenuTone(th: Theme, danger: string = MENU_DANGER): MenuTone {
  return {
    panel: th.panel,
    border: th.border,
    text: th.text,
    subtext: th.subtext,
    // hover는 **강조색 옅은 틴트 + 강조색 글자**다(칸반 카드 메뉴의 값 그대로).
    hoverBg: hexA(th.accent, 0.1),
    hoverInk: th.accent,
    danger,
    dangerBg: hexA(danger, 0.1),
    divider: th.border,
    faint: th.subtext,
  };
}

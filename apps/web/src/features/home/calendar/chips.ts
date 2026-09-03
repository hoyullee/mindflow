// 일정 칩의 색 — **칸반 에디터와 같은 규칙**을 쓴다.
//
// 칩은 "분류색 옅은 알약 + 열 색 점"이다(디자인 원본의 Geurio 마감 문법). 색을 여기서
// 새로 정하지 않고 `kanbanMeta`의 그 함수들을 그대로 부르는 이유는 드리프트다 — 같은
// 카드가 에디터·홈 썸네일·대시보드 위젯·일정 화면에서 다른 색이면 그게 곧 버그다.
//
// 팔레트는 칸반 화면과 같은 **고정 UI_THEME**(칸반 에디터는 문서 테마를 쓰지 않는다 —
// #513에서 위젯이 문서 테마를 읽어 색이 갈렸던 그 교훈).

import type { CSSProperties } from 'react';
import { UI_THEME, mixHex } from '../../editor/theme';
import { columnColor, tagColor, tagInk } from '../../editor/kanbanMeta';
import type { CalendarEntry } from './entries';

/**
 * 구글에서 온 일정의 표식 색(요청) — 캘린더마다 다른 색 대신 **구글 파랑 하나**로
 * 통일한다: 이 표식이 말하는 것은 "어느 캘린더"가 아니라 "구글에서 온 일정"이다.
 */
export const GOOGLE_MARK = '#4a78d0';

export interface EntryChip {
  bg: string;
  fg: string;
  dot: string;
  /**
   * 이 항목의 **정체성 색** — 칩의 면·잉크가 여기서 파생된다(우리 일정·카드는 분류색,
   * 구글은 그 일정의 색). 일별 팝업의 왼쪽 색 바가 이 값을 쓴다(제보: 팝업의 바가
   * 출처 hue 네 개 중 하나라 **칸의 칩과 색이 달라** 같은 일정으로 읽히지 않았다).
   */
  base: string;
  /**
   * 제목 앞 표식의 모양 — 우리 일정은 점, **구글 일정은 둥근 막대**(요청).
   * 색만 다르면 점 두 개가 나란히 있을 때 출처가 눈에 안 들어온다.
   */
  mark: 'dot' | 'bar';
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
  // 구글 일정은 **그 일정의 색**을 쓴다(요청 ⑤) — 사용자가 구글에서 지정한 이벤트
  // 색이고, 지정하지 않았으면 캘린더 색이다(`useGoogleCalendar`가 풀어 `colColor`에
  // 실어 준다). "구글에서 왔다"는 신호는 **색이 아니라 막대 모양**이 맡는다 — 그래야
  // 사용자가 고른 색을 지키면서 출처도 눈에 들어온다.
  // 우리 일정·카드는 분류색(분류가 없어도 이름 없는 값으로 결정적으로 뽑는다).
  const base = e.google ? (e.colColor ?? GOOGLE_MARK) : (e.tagColor ?? tagColor(e.tag, UI_THEME.palette));
  const dot = e.google ? base : columnColor({ id: e.colId, title: e.colName, ...(e.colColor ? { color: e.colColor } : {}) }, e.colIndex, UI_THEME.palette);
  return {
    base,
    bg: mixHex(surface.card, base, 0.16),
    // **구글 일정의 글자는 언제나 본문 색**(요청) — 색으로 말하는 것은 표식(막대)
    // 하나면 충분하고, 제목까지 그 색을 따르면 옅은 색에서 읽기 힘들다.
    // 우리 일정·카드는 예전처럼 분류색에서 눌러 뽑은 잉크를 쓴다.
    fg: e.google ? surface.text : tagInk(base, surface.text),
    dot,
    mark: e.google ? 'bar' : 'dot',
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

/**
 * **종일 일정인가**(요청 ①②). 시각이 있으면 시간 일정이고, 없으면 종일이다 —
 * 칸반 마감도 여기 든다(마감은 종일로 다룬다는 기존 결정).
 *
 * 화면 규칙(구글 캘린더 관례): 종일은 **면을 채운 칩**, 시간 일정은 **표식 + 시작
 * 시각 + 제목**. 그래서 칸을 훑을 때 "하루를 통째로 쓰는 일"과 "몇 시의 일"이 갈린다.
 */
export function isAllDayEntry(e: CalendarEntry): boolean {
  return !e.startTime;
}

/**
 * 칩에 붙는 시작 시각(요청 ②) — 칸이 좁아 정시는 `오전 9시`로 줄인다(구글 캘린더도
 * 같은 방식). 분이 있으면 `오후 2:30`.
 */
export function chipTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === undefined || Number.isNaN(h)) return hhmm;
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${ampm} ${h12}:${String(m).padStart(2, '0')}` : `${ampm} ${h12}시`;
}

/**
 * 제목 앞 표식의 꼴 — 점(우리 일정)과 둥근 막대(구글 일정)를 **한 곳에서** 정한다.
 * 소비처가 넷(월 격자 칩·기간 고스트·마감 목록·대시보드 위젯)이라 값을 흩어 두면
 * 어느 화면에서만 점으로 남는다.
 */
export function markStyle(chip: EntryChip): CSSProperties {
  return chip.mark === 'bar'
    ? { width: 3, height: 11, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' }
    : { width: 5, height: 5, borderRadius: 999, background: chip.dot, flex: '0 0 auto', display: 'block' };
}

/**
 * 날짜 숫자의 옷 — **오늘**과 **고른 날**을 한 곳에서 정한다(월 격자·대시보드 위젯이
 * 같은 함수를 쓴다. 값을 흩어 두면 한 화면에서만 표시가 달라진다).
 *
 * 예전에는 고른 날을 **속 빈 링**으로 둘렀는데 튀어 보였고(제보: 마음에 안 든다),
 * 오늘+선택은 지워진 토큰(`--mf-cal-ring`)을 가리켜 **아무 표시도 나오지 않았다**.
 * 지금은 애플 캘린더의 관례를 따른다 — **고른 날은 채운 원**(잉크 면 + 카드 잉크,
 * 어느 요일 틴트 위에서도 또렷하고 다크에서는 토큰이 뒤집혀 그대로 성립한다),
 * **오늘은 강조색 원**, 오늘을 고르면 그 원에 **옅은 후광**을 두른다(딱딱한 링이
 * 아니라 강조색을 물 탄 `accentMute`라 부드럽다).
 *
 * 칸 배경은 여전히 손대지 않는다 — 그 자리는 이미 세 가지(이웃 달·주말·드롭 대기)를
 * 겸하고 있어 넷째 뜻을 얹으면 어느 하나가 가려진다.
 */
export function dayNumTone(selected: boolean, isToday: boolean, dayInk?: string): CSSProperties {
  if (isToday) return { background: 'var(--mf-accent)', color: 'var(--mf-accent-ink)', fontWeight: 800, ...(selected ? { boxShadow: '0 0 0 3px var(--mf-accent-mute)' } : {}) };
  // 고른 날은 **채운 원**이다(오늘과 같은 선택 언어). 다만 토·일·공휴일이면 그 원을
  // **그 날의 색**으로 채운다(요청 ④) — 예전에는 무조건 잉크색으로 덮어 "이 날은
  // 일요일이다"라는 신호가 고르는 순간 사라졌다. 지금은 파랑·빨강이 더 또렷하다.
  if (selected) return { background: dayInk ?? 'var(--mf-text)', color: 'var(--mf-card)', fontWeight: 800 };
  return {};
}

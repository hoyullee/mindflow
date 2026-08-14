// 칸반 카드 색 라벨 — 카드 배경(`KanbanCard.bg`)으로 저장한다.
//
// 모델은 M1부터 있었고 고를 UI만 없었다. 값은 그냥 색 문자열이라 직렬화·CRDT·
// undo·내보내기가 아무것도 바뀌지 않는다.
//
// 색은 **연한 틴트**만 쓴다: 카드 배경 전체를 칠하므로 진한 색을 넣으면 본문
// 글자(`th.text`)의 대비가 무너진다. 라벨은 "이 카드가 어느 갈래인가"를 흘깃
// 알려 주는 표식이지 강조 장치가 아니다.

export interface CardLabel {
  /** 저장되는 값 — `null`이면 라벨 없음(기본 카드 배경). */
  bg: string | null;
  name: string;
}

// 값은 흰 카드 위에 아주 옅게 얹히는 톤이다(제보: "카드에 어울리게 더 옅어야
// 할 것 같다") — 예전 값은 스티커처럼 진해 분류 배지·본문과 경쟁했다.
export const CARD_LABELS: readonly CardLabel[] = [
  { bg: null, name: '없음' },
  { bg: '#fdf0ec', name: '빨강' },
  { bg: '#fdf4e8', name: '주황' },
  { bg: '#fbf8e4', name: '노랑' },
  { bg: '#edf7f0', name: '초록' },
  { bg: '#edf4fc', name: '파랑' },
  { bg: '#f2edfc', name: '보라' },
  { bg: '#f3f1ee', name: '회색' },
];

/** 지금 카드에 걸린 라벨 이름(없으면 '없음') — 버튼 접근 이름에 쓴다. */
export function cardLabelName(bg: string | null | undefined): string {
  return CARD_LABELS.find((l) => l.bg === (bg ?? null))?.name ?? '사용자 색';
}

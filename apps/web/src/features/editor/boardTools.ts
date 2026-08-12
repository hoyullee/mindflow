// 화이트보드 그리기 도구의 공용 상수·순수 함수 — 컨트롤러(입력·커밋)와 도구
// 막대(UI)가 같은 값을 봐야 "고른 색·굵기"와 "그려진 획"이 어긋나지 않는다.

/** 선택 / 펜 / 하이라이터 / 획 지우개. */
export type BoardTool = 'select' | 'pen' | 'hl' | 'eraser';

export const PEN_COLORS = ['#2b2b2b', '#d92626', '#2f7fd6', '#2f9e63', '#e0a53c'];
export const PEN_WIDTHS = [2, 4, 8];

/** 형광펜 팔레트 — 밝은 바탕 위에서 글자를 덮어도 읽히는 채도의 형광색.
 * 펜 팔레트와 굳이 다른 값을 쓰는 이유는 곱하기 합성 때문이다: 어두운 색으로
 * 칠하면 밑의 글자가 그대로 어두워져 하이라이트가 아니라 먹칠이 된다. */
export const HL_COLORS = ['#ffe14d', '#9be36a', '#7cc7ff', '#ff9ecb', '#ffb45c'];
/** 심 굵기 — 형광펜은 글자 줄을 덮는 도구라 펜보다 훨씬 굵다. */
export const HL_WIDTHS = [12, 20, 30];

/**
 * 하이라이터 획의 불투명도 — 소비처 넷(에디터 렌더·PNG·SVG·홈 썸네일)이 **같은
 * 값**을 써야 화면과 내보낸 파일이 같아 보인다.
 *
 * 곱하기 합성(multiply)과 함께 쓴다: 알파만 낮추면 흰 바탕에서는 예뻐 보여도
 * 색 있는 메모 위에서 뿌옇게 뜬다(형광펜은 밑을 가리는 게 아니라 걸러 낸다).
 */
export const HL_OPACITY = 0.42;

/** 이 획이 하이라이터인가 — `Stroke.hl`은 true일 때만 존재한다(옵션 필드). */
export function isHighlighter(s: { hl?: boolean }): boolean {
  return s.hl === true;
}

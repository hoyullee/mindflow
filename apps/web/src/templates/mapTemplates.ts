// 맵 템플릿 — "새로 만들기"가 여는 갤러리의 내용.
//
// 설계의 핵심: **템플릿은 그냥 `Doc` 하나다.** 별도 포맷을 두지 않으므로
// 갤러리 썸네일(`realPreview`)·저장·협업·undo·내보내기가 전부 기존 새 맵 경로를
// 그대로 탄다 — 새로 짜는 것은 이 파일의 데이터와 `buildTemplateDoc`뿐이다.
//
// 위치가 `apps/web`인 이유: 코어(`@mindflow/mindmap-core`)는 순수 엔진이고
// 템플릿은 한국어 문구가 든 **제품 콘텐츠**다.
//
// 좌표를 적지 않는 이유: 트리 노드의 x/y는 `layout()`이 정한다. 값이 필요한 것은
// 자유 도형인 메모(플로트)뿐이라, 메모는 트리가 반드시 비켜 가는 자리에만 둔다
// (아래 `memo` 주석 참고).

import type { Doc, Float, LayoutMode, Node, NodeMap } from '@mindflow/mindmap-core';
import { DEFAULT_EDGE_STYLE, DEFAULT_THEME_KEY, ROOT_ID } from '@mindflow/mindmap-core';

/** 화이트보드의 기본 테마 — 순백 캔버스(`THEMES.white`). 마인드맵의 기본값
 * (`DEFAULT_THEME_KEY` = 코랄)과 갈리는 유일한 지점이다. */
export const BOARD_THEME_KEY = 'white';

/** 템플릿 트리의 한 가지. 색은 적지 않는다 — `colorOf`가 첫 단계 순서대로
 * 테마 팔레트를 돌려주므로 가지 색이 저절로 칠해진다. */
export interface TemplateBranch {
  text: string;
  emoji?: string;
  children?: TemplateBranch[];
}

export interface MapTemplate {
  id: string;
  /** 갤러리 카드 이름이자 새 맵의 제목이자 루트 도형의 글자 — 셋이 늘 같다. */
  name: string;
  /** 카드에 붙는 한 줄 설명. "언제 쓰는가"를 적는다. */
  desc: string;
  /** 루트 도형의 이모지. */
  emoji: string;
  layoutMode: LayoutMode;
  branches: TemplateBranch[];
  /**
   * 메모(플로트). `right` 레이아웃은 트리가 **전부 x > 0**에 놓이므로
   * (`layoutSided`: 자식 x = 부모폭/2 + 110 + 자기폭/2) 왼쪽은 반드시 빈다.
   * 그래서 메모는 `right` 템플릿에만, 음수 x에만 둔다 — 트리 크기는 글자
   * 실측에 따라 달라져서 미리 알 수 없고, 겹친 채로 열리면 첫인상이 나쁘다.
   */
  memo?: { text: string; x: number; y: number; w: number };
}

export const MAP_TEMPLATES: MapTemplate[] = [
  {
    id: 'brainstorm',
    name: '브레인스토밍',
    desc: '떠오르는 생각을 사방으로 펼쳐 볼 때',
    emoji: '💡',
    layoutMode: 'radial',
    branches: [
      { text: '아이디어', emoji: '💡', children: [{ text: '엉뚱해도 일단 적기' }] },
      { text: '좋은 점', emoji: '👍' },
      { text: '걱정되는 점', emoji: '⚠️' },
      { text: '다음 할 일', emoji: '✅' },
    ],
  },
  {
    id: 'meeting',
    name: '회의록',
    desc: '안건부터 결정 사항과 할 일까지',
    emoji: '📝',
    layoutMode: 'right',
    branches: [
      { text: '안건', emoji: '📌', children: [{ text: '안건 1' }, { text: '안건 2' }] },
      { text: '논의', emoji: '💬' },
      { text: '결정 사항', emoji: '✅' },
      // 리스트 마커가 곧 데이터라, 이렇게 적어 두면 열자마자 번호 목록으로 그려진다.
      { text: '할 일', emoji: '📋', children: [{ text: '1. 할 일 · 담당 · 기한\n2. 할 일 · 담당 · 기한' }] },
    ],
    memo: { text: '일시 ·\n참석자 ·\n장소 ·', x: -300, y: -50, w: 210 },
  },
  {
    id: 'weekly',
    name: '주간 계획',
    desc: '이번 주에 할 일과 진행 상황',
    emoji: '🗓️',
    layoutMode: 'right',
    branches: [
      { text: '이번 주 목표', emoji: '🎯' },
      { text: '해야 할 일', emoji: '📋', children: [{ text: '- 할 일\n- 할 일\n- 할 일' }] },
      { text: '진행 중', emoji: '🔄' },
      { text: '마친 일', emoji: '🎉' },
    ],
    memo: { text: '이번 주 한 줄 회고', x: -300, y: -30, w: 210 },
  },
  {
    id: 'project',
    name: '프로젝트 기획',
    desc: '목표·범위·일정·리스크를 한눈에',
    emoji: '🚀',
    layoutMode: 'radial',
    branches: [
      { text: '목표', emoji: '🎯', children: [{ text: '무엇을 이루면 성공인가' }] },
      { text: '범위', emoji: '📦', children: [{ text: '포함' }, { text: '제외' }] },
      { text: '일정', emoji: '🗓️', children: [{ text: '마일스톤' }] },
      { text: '담당', emoji: '👥' },
      { text: '리스크', emoji: '⚠️' },
    ],
  },
  {
    id: 'decision',
    name: '의사결정',
    desc: '선택지의 장단점을 나란히 놓고 고르기',
    emoji: '⚖️',
    layoutMode: 'radial',
    branches: [
      { text: '무엇을 정하나', emoji: '❓' },
      { text: '선택지 A', emoji: '🅰️', children: [{ text: '장점', emoji: '👍' }, { text: '단점', emoji: '👎' }] },
      { text: '선택지 B', emoji: '🅱️', children: [{ text: '장점', emoji: '👍' }, { text: '단점', emoji: '👎' }] },
      { text: '판단 기준', emoji: '📊' },
      { text: '결론', emoji: '✅' },
    ],
  },
  {
    id: 'study',
    name: '학습 정리',
    desc: '배운 것을 구조로 남기기',
    emoji: '📚',
    layoutMode: 'right',
    branches: [
      { text: '핵심 개념', emoji: '🔑', children: [{ text: '개념 1' }, { text: '개념 2' }] },
      { text: '알게 된 것', emoji: '💡' },
      { text: '헷갈리는 것', emoji: '❓' },
      { text: '더 찾아볼 것', emoji: '🔍' },
    ],
  },
];

/**
 * 화이트보드 템플릿 — 보드에는 트리가 없으므로 **메모의 배치**가 곧 템플릿이다.
 *
 * 어휘를 보드가 실제로 만들 수 있는 것(메모·이미지·잉크)으로 제한한다: 사용자가
 * 지웠다가 **다시 만들 수 없는 물건**(영역·연결선)을 템플릿만 슬쩍 심어 두면
 * "이건 어떻게 되살리지?"가 된다. 열 제목도 그냥 색 있는 메모다.
 *
 * 좌표는 원점을 가운데 두게 잡는다 — 첫 센터링이 장면 바운즈의 중심을 잡으므로
 * 열자마자 전체가 화면 한가운데에 놓인다.
 */
export interface BoardTemplateMemo {
  text: string;
  x: number;
  y: number;
  w: number;
  /** 최소 높이. 없으면 글자에 맞춰 자란다(빈 카드는 44). 스티커처럼 보이게 쓴다. */
  h?: number;
  /** 카드 배경. 없으면 기본 노랑(스티커). */
  bg?: string;
  /** 굵게 — 열 제목처럼 한 줄짜리 머리에 쓴다(rich 런 하나로 저장된다). */
  bold?: boolean;
}

export interface BoardTemplate {
  id: string;
  /** 갤러리 카드 이름이자 새 보드의 제목. */
  name: string;
  desc: string;
  memos: BoardTemplateMemo[];
}

// 열 세 개짜리 보드의 공통 격자 — 메모 폭 260 + 간격 40(전체 860, 원점 기준 좌우 대칭).
// 세로는 [제목][카드][카드]로 96 + 간격 18. 값이 겹치면 열자마자 카드가 포개져
// 보이므로 테스트가 "어떤 두 메모도 겹치지 않는다"를 지킨다.
const COL_X = [-430, -130, 170];
const CARD_W = 260;
const CARD_H = 96;
const HEAD_Y = -190;
const CARD_Y = [-120, -6];

// 2×2 매트릭스용 격자 — 넓은 칸 둘을 좌우로, 각 칸은 [제목][카드]. 가로 간격 80,
// 세로는 제목(44) 아래 카드(96)를 두고 칸 사이를 34 띄운다(겹침 없음, 테스트가 지킨다).
const QUAD_X = [-420, 40];
const QUAD_W = 380;
const QUAD_HEAD_Y = [-230, -20];
const QUAD_CARD_Y = [-150, 60];

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'board-retro',
    name: '회고 (KPT)',
    desc: '잘한 것 · 아쉬운 것 · 다음에 해볼 것',
    memos: [
      { text: 'Keep · 잘한 것', x: COL_X[0]!, y: HEAD_Y, w: CARD_W, bg: '#dff2e5', bold: true },
      { text: 'Problem · 아쉬운 것', x: COL_X[1]!, y: HEAD_Y, w: CARD_W, bg: '#ffe3e0', bold: true },
      { text: 'Try · 다음에 해볼 것', x: COL_X[2]!, y: HEAD_Y, w: CARD_W, bg: '#e0e9ff', bold: true },
      { text: '예) 배포가 자동화되어 손이 덜 갔다', x: COL_X[0]!, y: CARD_Y[0]!, w: CARD_W, h: CARD_H },
      { text: '', x: COL_X[0]!, y: CARD_Y[1]!, w: CARD_W, h: CARD_H },
      { text: '예) 리뷰가 늦어 배포가 밀렸다', x: COL_X[1]!, y: CARD_Y[0]!, w: CARD_W, h: CARD_H },
      { text: '', x: COL_X[1]!, y: CARD_Y[1]!, w: CARD_W, h: CARD_H },
      { text: '예) 리뷰 담당을 미리 정해 두기', x: COL_X[2]!, y: CARD_Y[0]!, w: CARD_W, h: CARD_H },
      { text: '', x: COL_X[2]!, y: CARD_Y[1]!, w: CARD_W, h: CARD_H },
    ],
  },
  {
    // 칸반은 **별도 기능**으로 만들 예정이라 템플릿에서 뺐다(요청) — 열을 옮기는
    // 일은 붙였다 떼는 스티커보다 규칙이 있는 보드가 맞다.
    //
    // 대신 들어온 2×2 매트릭스는 세 열짜리(회고)·격자(아이디어)와 모양이 겹치지
    // 않고, 스티커를 옮겨 담는 것 자체가 결론이 되는 판이다(점 투표와도 맞물린다).
    id: 'board-priority',
    name: '우선순위 정하기',
    desc: '임팩트와 노력으로 네 칸에 나눠 담기',
    memos: [
      { text: '지금 하기 · 임팩트 크고 노력 적음', x: QUAD_X[0]!, y: QUAD_HEAD_Y[0]!, w: QUAD_W, bg: '#dff2e5', bold: true },
      { text: '계획하기 · 임팩트 크고 노력 큼', x: QUAD_X[1]!, y: QUAD_HEAD_Y[0]!, w: QUAD_W, bg: '#e0e9ff', bold: true },
      { text: '여유되면 · 임팩트 작고 노력 적음', x: QUAD_X[0]!, y: QUAD_HEAD_Y[1]!, w: QUAD_W, bg: '#eceef2', bold: true },
      { text: '하지 않기 · 임팩트 작고 노력 큼', x: QUAD_X[1]!, y: QUAD_HEAD_Y[1]!, w: QUAD_W, bg: '#ffe3e0', bold: true },
      { text: '예) 로그인 오류 메시지 고치기', x: QUAD_X[0]!, y: QUAD_CARD_Y[0]!, w: QUAD_W, h: CARD_H },
      { text: '예) 검색 개편', x: QUAD_X[1]!, y: QUAD_CARD_Y[0]!, w: QUAD_W, h: CARD_H },
      { text: '', x: QUAD_X[0]!, y: QUAD_CARD_Y[1]!, w: QUAD_W, h: CARD_H },
      { text: '', x: QUAD_X[1]!, y: QUAD_CARD_Y[1]!, w: QUAD_W, h: CARD_H },
    ],
  },
  {
    // 이름이 맵 템플릿의 '브레인스토밍'과 겹치면 갤러리 한 화면에 같은 이름이
    // 둘이 되어 무엇이 다른지 알 수 없다 — 보드 쪽은 하는 일(스티커 붙이기)로 부른다.
    id: 'board-ideas',
    name: '아이디어 스티커',
    desc: '떠오르는 대로 붙이고 나중에 묶기',
    memos: [
      { text: '무엇을 고민하고 있나요?', x: -230, y: -210, w: 460, bg: '#e0e9ff', bold: true },
      { text: '예) 엉뚱해도 일단 적기 — 고르는 건 나중에', x: -415, y: -130, w: 250, h: CARD_H },
      { text: '', x: -125, y: -130, w: 250, h: CARD_H },
      { text: '', x: 165, y: -130, w: 250, h: CARD_H },
      { text: '', x: -415, y: -16, w: 250, h: CARD_H },
      { text: '', x: -125, y: -16, w: 250, h: CARD_H },
      { text: '', x: 165, y: -16, w: 250, h: CARD_H },
    ],
  },
];

export function findBoardTemplate(id: string | null | undefined): BoardTemplate | null {
  if (!id) return null;
  return BOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function findTemplate(id: string | null | undefined): MapTemplate | null {
  if (!id) return null;
  return MAP_TEMPLATES.find((t) => t.id === id) ?? null;
}

function mkNode(id: string, text: string, emoji: string, parent: string | null): Node {
  return { id, text, emoji, parent, children: [], collapsed: false, color: null, x: 0, y: 0 };
}

/**
 * 템플릿 id → 새 문서. 모르는 id면 `null`(호출부가 평범한 빈 맵으로 떨어진다).
 *
 * 노드 id는 `t1`, `t2` …로 **결정적**이다. 문서마다 저장이 갈리므로 두 맵이 같은
 * id를 가져도 상관없고, 에디터가 새로 만드는 id(`x1_<타임스탬프>`, `createIdFactory`)와
 * 모양이 달라 한 문서 안에서 부딪히지도 않는다.
 */
export function buildTemplateDoc(id: string | null | undefined): Doc | null {
  // 화이트보드 — 트리 없는 빈 보드(`Doc.kind === 'board'`). 갤러리의 "화이트보드"
  // 칸이 `tpl=board`로 들어온다. layoutMode는 board에서 쓰이지 않지만 직렬화
  // 스키마의 필수 필드라 기본값을 채워 둔다.
  if (id === 'board') {
    // 메모 하나로 시작한다 — 텅 빈 흰 화면은 "무엇을 할 수 있는지"를 하나도
    // 알려 주지 않는다(제보: 너무 허전하다). 첫 메모가 곧 안내이자 예시다.
    // 좌표는 원점을 가운데 두게 잡는다(첫 센터링이 장면 바운즈 중심을 잡으므로
    // 이 메모가 화면 한가운데에 열린다).
    const starter: Float = { id: 'bf1', x: -125, y: -55, w: 250, text: '여기에 생각을 적어 보세요.\n\n메모는 두 번 눌러 고치고, 끌어서 어디든 옮길 수 있어요.' };
    // 보드의 기본 테마는 **화이트**(순백 캔버스) — 예전에는 테마와 무관하게 흰
    // 배경을 덮어썼는데, 그러면 스타일 메뉴에서 테마를 바꿔도 아무것도 안 바뀌었다
    // (제보). 흰 배경을 테마 하나로 만들면 기본 인상은 그대로면서 바꿀 수도 있다.
    return { v: 1, nodes: {}, floats: [starter], lines: [], zones: [], layoutMode: 'right', themeKey: BOARD_THEME_KEY, edgeStyle: DEFAULT_EDGE_STYLE, kind: 'board' };
  }
  const bt = findBoardTemplate(id);
  if (bt) {
    const floats: Float[] = bt.memos.map((m, i) => ({
      id: `bt${i + 1}`,
      x: m.x,
      y: m.y,
      w: m.w,
      text: m.text,
      ...(m.h ? { h: m.h } : {}),
      ...(m.bg ? { bg: m.bg } : {}),
      // 굵게는 rich 런 하나 — `text`와 글자가 같아야 한다(모델 계약).
      ...(m.bold && m.text ? { rich: [{ t: m.text, b: true }] } : {}),
    }));
    return { v: 1, nodes: {}, floats, lines: [], zones: [], layoutMode: 'right', themeKey: BOARD_THEME_KEY, edgeStyle: DEFAULT_EDGE_STYLE, kind: 'board' };
  }

  const t = findTemplate(id);
  if (!t) return null;

  const root = mkNode(ROOT_ID, t.name, t.emoji, null);
  const nodes: NodeMap = { [ROOT_ID]: root };
  let seq = 0;

  const walk = (branch: TemplateBranch, parent: Node): void => {
    const nid = `t${++seq}`;
    const n = mkNode(nid, branch.text, branch.emoji ?? '', parent.id);
    nodes[nid] = n;
    parent.children.push(nid);
    (branch.children ?? []).forEach((c) => walk(c, n));
  };
  t.branches.forEach((b) => walk(b, root));

  const floats: Float[] = t.memo ? [{ id: 'tf1', x: t.memo.x, y: t.memo.y, w: t.memo.w, text: t.memo.text }] : [];

  return {
    v: 1,
    nodes,
    floats,
    lines: [],
    zones: [],
    layoutMode: t.layoutMode,
    themeKey: DEFAULT_THEME_KEY,
    edgeStyle: DEFAULT_EDGE_STYLE,
  };
}

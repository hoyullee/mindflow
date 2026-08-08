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

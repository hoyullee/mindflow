// 마크다운 → 맵. 두 가지를 함께 읽는다.
//
// ① **우리가 내보낸 `.md`**(`toMarkdown`) — 왕복이 보장돼야 한다:
//    `# 제목` / `- 항목`(2칸 들여쓰기) / `  > 노트` / `## 개별 주제` / `## 메모`
// ② **바깥에서 만든 평범한 마크다운** — 남의 문서를 가져올 수 있어야 쓸모가 있다:
//    `##`~`######` 제목 계층, 번호 목록, 체크박스, 문단, 코드 펜스, 프런트매터.
//
// 두 형식이 부딪히는 지점은 `##`뿐이다. `toMarkdown`이 쓰는 두 문구(`개별 주제`·`메모`)만
// 섹션 전환으로 보고 나머지 `##`은 제목 계층으로 읽는다 — 그 두 낱말을 제목으로 쓴 남의
// 문서는 드물고, 왕복 보장이 더 값지다.

import { applyMarkdownLinks, applyMarkdownShortcuts } from '@mindflow/mindmap-core';
import type { RichRun } from '@mindflow/mindmap-core';

export interface OutlineNode {
  [key: string]: unknown;
  id: string;
  text: string;
  emoji: string;
  parent: string | null;
  children: string[];
  collapsed: boolean;
  color: null;
  x?: number;
  y?: number;
}

export interface ParsedOutline {
  v: number;
  nodes: Record<string, OutlineNode>;
  floats: { id: string; x: number; y: number; w: number; text: string; rich?: RichRun[] | null }[];
  lines: unknown[];
  zones: unknown[];
  layoutMode: string;
  themeKey: string;
  needsLayout: boolean;
}

// 레이아웃은 **트리만** 배치한다 — 메모(플로트)와 자유 도형(`free`)은 자기 좌표를
// 스스로 들고 있어야 하므로 가져오기가 직접 줘야 한다. 0,0으로 두면 루트와 서로
// 위에 겹쳐 쌓인다.
const MEMO_X = 240;
const MEMO_TOP = 220;
const MEMO_GAP = 110;
/** 자유 도형의 x/y는 박스 **중심**이다(노드는 중심 기준). */
const FREE_X = -460;
const FREE_TOP = 240;
const FREE_GAP = 150;

/** `toMarkdown`이 쓰는 섹션 제목 — 이 둘만 섹션 전환이고 나머지 `##`은 제목 계층이다. */
const SECTION_FREE = '개별 주제';
const SECTION_MEMO = '메모';

/** 목록 항목: `-`/`*`/`+` 또는 `1.`/`1)`. */
const ITEM_RE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.+)$/;
/** 체크박스는 표시를 떼고 글자만 남긴다 — 이 앱에는 체크박스가 없다. */
const TASK_RE = /^\[([ xX])\]\s+/;
/** 수평선(`---`, `***`, `___`). 항목·프런트매터와 헷갈리지 않게 3자 이상만. */
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s*(?:```|~~~)/;

/** 들여쓰기 → 단계(1부터). 탭은 2칸으로 친다. */
function indentOf(ws: string): number {
  return Math.floor(ws.replace(/\t/g, '  ').length / 2) + 1;
}

/** 인라인 마크다운(`**굵게**`·`[텍스트](주소)` …)을 rich 런으로. 링크를 **먼저**
 * 걷어내는 이유는 주소 안의 `*`/`_`가 강조 마커로 오탐되지 않게 하기 위해서다. */
function inlineRich(text: string): { text: string; rich: RichRun[] | null } {
  let cur: { text: string; rich: RichRun[] | null } = { text, rich: null };
  const linked = applyMarkdownLinks(cur);
  if (linked) cur = linked;
  const styled = applyMarkdownShortcuts(cur);
  if (styled) cur = styled;
  return cur;
}

/**
 * 마크다운 텍스트 → 맵 문서. 가져올 게 하나도 없으면 `null`.
 *
 * (예전 이름 `parseOutline` — 우리 내보내기만 읽던 시절의 이름이라 지금은
 * `parseMarkdown`이 정확하지만, 호출부·테스트가 쓰는 이름을 유지한다.)
 */
export function parseOutline(text: string, fallbackTitle: string): ParsedOutline | null {
  const lines = String(text).split(/\r?\n/);
  let uid = 0;
  const mk = (t: string, parent: string | null): OutlineNode => ({
    id: 'n' + ++uid,
    text: t,
    emoji: '',
    parent,
    children: [],
    collapsed: false,
    color: null,
  });
  const nodes: Record<string, OutlineNode> = {};
  const root: OutlineNode = { id: 'root', text: fallbackTitle || '가져온 맵', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 };
  nodes.root = root;

  const memos: string[] = [];
  let section: 'tree' | 'free' | 'memo' = 'tree';
  let itemCount = 0;
  let freeCount = 0;
  let sawTitle = false;
  /** 제목(`#`) 계층 스택 — 목록은 가장 가까운 제목 아래에 쌓인다. */
  let hStack: { level: number; id: string }[] = [];
  /** 현재 섹션의 목록 부모 스택. 자유 도형 섹션은 매 항목이 새 뿌리다. */
  let stack: { depth: number; id: string }[] = [{ depth: 0, id: 'root' }];
  /** 방금 만든 노드 — `>` 노트와 문단이 붙을 대상. */
  let lastNodeId: string | null = 'root';
  let inFence = false;
  /** 맨 앞 YAML 프런트매터(`---` … `---`) 안인가. */
  let inFrontMatter = false;

  const addNote = (body: string): void => {
    const target = lastNodeId ? nodes[lastNodeId] : null;
    if (!target || !body) return;
    target.note = target.note ? `${String(target.note)}\n${body}` : body;
  };

  /** 목록 스택을 현재 제목(없으면 root) 아래로 되돌린다. */
  const resetListStack = (): void => {
    const base = hStack.length ? (hStack[hStack.length - 1]?.id ?? 'root') : 'root';
    stack = [{ depth: 0, id: base }];
  };

  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li] ?? '';

    // 프런트매터: 파일 맨 앞의 `---`부터 다음 `---`까지 통째로 건너뛴다.
    if (inFrontMatter) {
      if (/^\s*---\s*$/.test(ln)) inFrontMatter = false;
      continue;
    }
    if (li === 0 && /^\s*---\s*$/.test(ln) && lines.slice(1).some((l) => /^\s*---\s*$/.test(l))) {
      inFrontMatter = true;
      continue;
    }

    // 코드 펜스 안은 읽지 않는다 — 그 안의 `- `가 항목으로 잘못 잡히면
    // 남의 문서 구조가 통째로 어그러진다.
    if (FENCE_RE.test(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (HR_RE.test(ln)) continue;

    const h = ln.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = (h[1] ?? '#').length;
      const label = (h[2] ?? '').trim();
      // `toMarkdown`의 두 섹션 — 제목 계층이 아니라 구획 전환이다.
      if (level === 2 && (label === SECTION_FREE || label === SECTION_MEMO)) {
        section = label === SECTION_FREE ? 'free' : 'memo';
        hStack = [];
        stack = [];
        lastNodeId = null;
        continue;
      }
      if (section !== 'tree') continue; // 메모/개별 주제 구획 안의 제목은 무시
      if (level === 1 && !sawTitle && itemCount === 0) {
        // 첫 `#`은 맵 이름이다(우리 내보내기의 첫 줄이자, 남의 문서에서도 문서 제목).
        root.text = label;
        sawTitle = true;
        lastNodeId = 'root';
        continue;
      }
      // 나머지 제목은 계층이 된다 — 자기보다 얕은 제목 아래로 들어간다.
      while (hStack.length && (hStack[hStack.length - 1]?.level ?? 0) >= level) hStack.pop();
      const parent = hStack.length ? (hStack[hStack.length - 1]?.id ?? 'root') : 'root';
      const n = mk(label, parent);
      nodes[n.id] = n;
      nodes[parent]?.children.push(n.id);
      hStack.push({ level, id: n.id });
      itemCount++;
      lastNodeId = n.id;
      resetListStack();
      continue;
    }

    const note = ln.match(/^\s*>\s*(.+)/);
    if (note) {
      addNote((note[1] ?? '').trim());
      continue;
    }

    const m = ln.match(ITEM_RE);
    if (m) {
      const label = (m[2] ?? '').trim().replace(TASK_RE, '');
      if (section === 'memo') {
        memos.push(label);
        continue;
      }
      const depth = indentOf(m[1] ?? '');
      itemCount++;
      if (section === 'free' && (depth <= 1 || !stack.length)) {
        // 자유 도형 섹션의 최상위 항목 = 트리에 붙지 않는 독립 도형. 자기 좌표를
        // 들고 있어야 하므로 여기서 자리를 준다(위 상수 참고).
        const n = mk(label, null);
        n.free = true;
        n.x = FREE_X;
        n.y = FREE_TOP + freeCount * FREE_GAP;
        freeCount++;
        nodes[n.id] = n;
        stack = [{ depth: 1, id: n.id }];
        lastNodeId = n.id;
        continue;
      }
      while (stack.length > 1 && (stack[stack.length - 1]?.depth ?? 0) >= depth) stack.pop();
      const parent = stack[stack.length - 1]?.id ?? 'root';
      const n = mk(label, parent);
      nodes[n.id] = n;
      nodes[parent]?.children.push(n.id);
      stack.push({ depth, id: n.id });
      lastNodeId = n.id;
      continue;
    }

    // 남은 것 = 문단. 바로 앞 노드의 노트로 넣는다 — 버리면 남의 문서에서 정작
    // 내용인 산문이 통째로 사라진다. 노트는 캔버스에 펼쳐지지 않으므로(표시만)
    // 화면이 어지러워지지도 않는다.
    const body = ln.trim();
    if (body && section !== 'memo') addNote(body);
  }

  // 가져오기는 **구조**(항목·제목 계층·메모)를 옮기는 일이다. 구조가 하나도 없으면
  // 맵이 아니다 — 예전 규칙("제목만 있는 파일은 개요가 아니다")을 그대로 지킨다.
  // 문단(노트)은 구조에 딸려 오는 살이라 그것만으로는 가져오지 않는다. 대신 `##`
  // 제목이 하나라도 있으면 계층이 잡히므로 "제목 여러 개 + 산문" 문서는 잘 들어온다.
  if (!itemCount && !memos.length) return null;

  // 인라인 서식은 마지막에 한 번 — 노드 글자와 메모 모두.
  Object.values(nodes).forEach((n) => {
    const r = inlineRich(n.text);
    n.text = r.text;
    if (r.rich) n.rich = r.rich;
  });
  const floats = memos.map((t, i) => {
    const r = inlineRich(t);
    return { id: 'fm' + (i + 1), x: MEMO_X, y: MEMO_TOP + i * MEMO_GAP, w: 180, text: r.text, ...(r.rich ? { rich: r.rich } : {}) };
  });

  return { v: 1, nodes, floats, lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral', needsLayout: true };
}

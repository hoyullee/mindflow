// 에디터 객체 복사/잘라내기/붙여넣기 — 선택된 객체(노드 서브트리·메모·선·영역)를
// 담아 두었다가 다른 위치에 그대로 다시 만든다.
//
// `mutations.ts`와 같은 성격의 "앱 편집 동작"이라 여기(웹)에 둔다 — 코어는
// 모델/직렬화/레이아웃/기하/히스토리/마크다운만 소유한다(ADR-0001). 모든 함수는
// 순수 `(state) => state` 변환이라 훅에서 떼어내 그대로 테스트할 수 있다.
//
// 클립보드는 **에디터 세션 메모리**에만 산다(OS 클립보드 아님). 노드 이미지가
// 데이터 URL이라 localStorage로 미러링하면 용량을 넘길 수 있고, OS 클립보드는
// 권한·비동기·모바일 제약이 있어서다. 대신 같은 탭 안에서는 항상 즉시 동작한다.

import type { Doc, Float, Line, Node, Zone } from '@mindflow/mindmap-core';
import { ROOT_ID, cloneNodes } from '@mindflow/mindmap-core';
import type { IdFactory } from './mutations';
import { descendants } from './tree';
import type { MultiSelection, Selection } from './types';

/** 노드에 붙여넣을 때 원본과 겹치지 않도록 주는 기본 어긋남(캔버스 단위). */
const PASTE_OFFSET = 24;

export interface ClipboardPayload {
  /** 복사된 노드 전체(각 루트의 서브트리 포함). parent/children 참조는 이 배열 안에서 닫혀 있다. */
  nodes: Node[];
  /** `nodes` 중 복사 대상으로 직접 지정된 최상위 노드 id들(서브트리의 뿌리). */
  nodeRoots: string[];
  floats: Float[];
  lines: Line[];
  zones: Zone[];
}

/** 붙여넣기 위치: 노드에 붙이면 그 노드의 자식으로, 좌표에 붙이면 그 지점에 자유 배치. */
export type PasteTarget = { kind: 'node'; id: string } | { kind: 'point'; x: number; y: number };

export function clipboardCount(c: ClipboardPayload | null): number {
  if (!c) return 0;
  return c.nodeRoots.length + c.floats.length + c.lines.length + c.zones.length;
}

export function isClipboardEmpty(c: ClipboardPayload | null): boolean {
  return clipboardCount(c) === 0;
}

/**
 * 선택된 노드 id 중 **최상위만** 남긴다 — 조상이 함께 선택돼 있으면 그 자손은
 * 어차피 서브트리로 따라오므로, 남겨 두면 같은 노드가 두 번 복사된다.
 * 루트는 복사 대상에서 제외한다(삭제와 동일한 규칙 — 맵 전체 복제는 의미가 없다).
 */
function topLevelNodeIds(doc: Doc, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    if (id === ROOT_ID || !doc.nodes[id]) return false;
    for (let p = doc.nodes[id]?.parent ?? null; p; p = doc.nodes[p]?.parent ?? null) {
      if (set.has(p)) return false; // 조상이 이미 선택됨 → 서브트리로 따라온다
    }
    return true;
  });
}

/**
 * 현재 선택(단일 또는 다중)을 클립보드 페이로드로 모은다. 복사할 게 없으면 `null`
 * (루트만 선택된 경우 등) — 호출부는 클립보드를 건드리지 않는다.
 */
export function collectClipboard(doc: Doc, selection: Selection | null, multi: MultiSelection | null): ClipboardPayload | null {
  let nodeIds: string[] = [];
  let floatIds: string[] = [];
  let lineIds: string[] = [];
  let zoneIds: string[] = [];

  const multiTotal = multi ? multi.nodes.length + multi.floats.length + multi.lines.length : 0;
  if (multi && multiTotal > 1) {
    nodeIds = multi.nodes;
    floatIds = multi.floats;
    lineIds = multi.lines;
  } else if (selection) {
    if (selection.kind === 'node') nodeIds = [selection.id];
    else if (selection.kind === 'float') floatIds = [selection.id];
    else if (selection.kind === 'line') lineIds = [selection.id];
    else zoneIds = [selection.id];
  }

  const roots = topLevelNodeIds(doc, nodeIds);
  // 각 루트의 서브트리를 통째로 — 깊은 복사는 붙여넣기 시점에 id를 새로 매기며 한다.
  const collected: Node[] = [];
  const seen = new Set<string>();
  roots.forEach((rid) => {
    [rid, ...descendants(doc.nodes, rid)].forEach((id) => {
      const n = doc.nodes[id];
      if (n && !seen.has(id)) {
        seen.add(id);
        collected.push(n);
      }
    });
  });

  const floats = doc.floats.filter((f) => floatIds.includes(f.id));
  const lines = doc.lines.filter((l) => lineIds.includes(l.id));
  const zones = doc.zones.filter((z) => zoneIds.includes(z.id));

  const payload: ClipboardPayload = { nodes: collected, nodeRoots: roots, floats, lines, zones };
  return clipboardCount(payload) ? payload : null;
}

/** 페이로드에서 위치를 가진 항목들의 좌상단 기준점 — '좌표에 붙여넣기'의 정렬 기준. */
function payloadOrigin(clip: ClipboardPayload): { x: number; y: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  clip.nodeRoots.forEach((id) => {
    const n = clip.nodes.find((c) => c.id === id);
    if (n) {
      xs.push(n.x);
      ys.push(n.y);
    }
  });
  clip.floats.forEach((f) => {
    xs.push(f.x);
    ys.push(f.y);
  });
  clip.lines.forEach((l) => {
    xs.push(Math.min(l.x1, l.x2));
    ys.push(Math.min(l.y1, l.y2));
  });
  clip.zones.forEach((z) => {
    xs.push(z.x);
    ys.push(z.y);
  });
  if (!xs.length || !ys.length) return null;
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

export interface PasteResult {
  doc: Doc;
  /** 붙여넣은 결과가 하나면 그 객체를 선택한다(추가 동작들과 같은 관례). */
  selection: Selection | null;
  /** 여럿이면 다중 선택으로 잡아 준다(영역은 다중 선택 대상이 아니라 제외). */
  multi: MultiSelection | null;
}

/**
 * 클립보드 내용을 새 id로 다시 만들어 문서에 넣는다.
 *
 * - `target.kind === 'node'`: 노드 루트들은 그 노드의 **자식**으로 붙는다(자유 도형이었어도
 *   붙는 순간 연결된 노드가 된다). 메모/선/영역은 위치 기반이라 원본에서 살짝 어긋나게 둔다.
 * - `target.kind === 'point'`: 전부 그 지점을 기준으로 상대 위치를 유지한 채 배치되고,
 *   노드 루트는 자유 도형이 된다.
 *
 * 선의 앵커(a1/a2)는 **함께 복사된 대상만** 새 사본으로 다시 연결한다. 밖을 가리키던
 * 앵커는 떼어낸다 — 그대로 두면 사본이 원본 노드에 그대로 붙어 붙여넣기가 눈에 보이지
 * 않는다(좌표 대신 앵커로 위치가 결정되므로).
 */
export function pasteClipboard(doc: Doc, clip: ClipboardPayload | null, target: PasteTarget, newId: IdFactory): PasteResult | null {
  if (!clip || isClipboardEmpty(clip)) return null;
  // 잘라내기 후 대상 노드 자체가 사라졌을 수 있다 → 좌표 붙여넣기로 내려앉는다.
  const intoNode = target.kind === 'node' && !!doc.nodes[target.id] ? target.id : null;

  const origin = payloadOrigin(clip);
  let dx = PASTE_OFFSET;
  let dy = PASTE_OFFSET;
  if (target.kind === 'point' && origin) {
    dx = target.x - origin.x;
    dy = target.y - origin.y;
  }

  // 1) id 재매핑 테이블 — 노드/메모는 선 앵커 재연결에도 쓰인다.
  const nodeIdMap = new Map<string, string>();
  clip.nodes.forEach((n) => nodeIdMap.set(n.id, newId('x')));
  const floatIdMap = new Map<string, string>();
  clip.floats.forEach((f) => floatIdMap.set(f.id, newId('f')));

  // 2) 노드 — 서브트리 구조를 유지한 채 새 id로.
  const nodes = cloneNodes(doc.nodes);
  const rootSet = new Set(clip.nodeRoots);
  const parentBase = intoNode ? doc.nodes[intoNode] : null;
  clip.nodes.forEach((src) => {
    const id = nodeIdMap.get(src.id);
    if (!id) return;
    const copy: Node = {
      ...src,
      id,
      children: src.children.map((c) => nodeIdMap.get(c)).filter((c): c is string => !!c),
      parent: src.parent ? (nodeIdMap.get(src.parent) ?? null) : null,
    };
    if (rootSet.has(src.id)) {
      if (intoNode && parentBase) {
        // 자식으로 편입 — 자유 도형 표식과 루트 전용 side는 떨어져 나간다
        // (레이아웃이 새 부모 기준으로 위치·방향을 다시 계산한다).
        copy.parent = intoNode;
        delete copy.free;
        delete copy.side;
        copy.x = parentBase.x + 120;
        copy.y = parentBase.y;
      } else {
        copy.parent = null;
        copy.free = true;
        copy.x = src.x + dx;
        copy.y = src.y + dy;
      }
    }
    nodes[id] = copy;
  });
  if (intoNode && nodes[intoNode]) {
    const parent = nodes[intoNode];
    if (parent.collapsed) parent.collapsed = false; // 접혀 있으면 펴서 보이게(추가 동작들과 동일)
    parent.children = [...parent.children, ...clip.nodeRoots.map((r) => nodeIdMap.get(r)).filter((r): r is string => !!r)];
  }

  // 3) 메모/영역 — 위치만 옮겨 그대로.
  const floats = [...doc.floats];
  clip.floats.forEach((f) => {
    const id = floatIdMap.get(f.id);
    if (id) floats.push({ ...f, id, x: f.x + dx, y: f.y + dy });
  });
  const zones = [...doc.zones];
  const zoneIds: string[] = [];
  clip.zones.forEach((z) => {
    const id = newId('z');
    zoneIds.push(id);
    zones.push({ ...z, id, x: z.x + dx, y: z.y + dy });
  });

  // 4) 선 — 앵커는 함께 복사된 대상만 재연결, 나머지는 떼어낸다.
  const lines = [...doc.lines];
  const lineIds: string[] = [];
  clip.lines.forEach((l) => {
    const id = newId('l');
    lineIds.push(id);
    const copy: Line = { ...l, id, x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy };
    const remap = (a: Line['a1']): Line['a1'] => {
      if (!a) return undefined;
      const mapped = a.kind === 'node' ? nodeIdMap.get(a.id) : floatIdMap.get(a.id);
      return mapped ? { ...a, id: mapped } : undefined;
    };
    const a1 = remap(l.a1);
    const a2 = remap(l.a2);
    if (a1) copy.a1 = a1;
    else delete copy.a1;
    if (a2) copy.a2 = a2;
    else delete copy.a2;
    lines.push(copy);
  });

  // 5) 붙여넣은 결과를 선택 상태로 — 하나면 단일, 여럿이면 다중(영역 제외).
  const newNodeRoots = clip.nodeRoots.map((r) => nodeIdMap.get(r)).filter((r): r is string => !!r);
  const newFloatIds = clip.floats.map((f) => floatIdMap.get(f.id)).filter((f): f is string => !!f);
  const total = newNodeRoots.length + newFloatIds.length + lineIds.length + zoneIds.length;
  let selection: Selection | null = null;
  let multi: MultiSelection | null = null;
  if (total === 1) {
    if (newNodeRoots[0]) selection = { kind: 'node', id: newNodeRoots[0] };
    else if (newFloatIds[0]) selection = { kind: 'float', id: newFloatIds[0] };
    else if (lineIds[0]) selection = { kind: 'line', id: lineIds[0] };
    else if (zoneIds[0]) selection = { kind: 'zone', id: zoneIds[0] };
  } else if (total > 1 && newNodeRoots.length + newFloatIds.length + lineIds.length > 1) {
    // 획은 클립보드에 담기지 않는다(복사·붙여넣기 범위 밖) — 붙여넣은 결과의
    // 다중 선택에도 없다.
    multi = { nodes: newNodeRoots, floats: newFloatIds, lines: lineIds, strokes: [] };
  }

  return { doc: { ...doc, nodes, floats, lines, zones }, selection, multi };
}

// 공책 본문에 편 **보드 임베드**의 순수 규칙 — 보기 기본값·칸반 셈·개요 트리·프레임 맞춤.
//
// 왜 파일을 가르나: 임베드는 종류가 셋이고 종류마다 "무엇을 보여 줄지"를 계산해야
// 하는데, 그 계산은 전부 **문서를 읽어 숫자와 목록을 내는 일**이라 DOM이 필요 없다.
// 화면(`NoteBoardEmbed.tsx`)은 그 값을 그리기만 한다 — 그래야 셈이 테스트로 잡힌다.
//
// 이 파일은 보드 **원본을 바꾸지 않는다**. 카드를 옮기는 일(`moveKanbanCard`)만 새
// 문서를 만들어 돌려주고, 저장은 부르는 쪽이 한다(낙관적 반영 + 실패 시 되돌리기).

import type { Doc, KanbanCard, KanbanColumn, NoteBlock, NoteEmbedView, Node, Zone } from '@mindflow/mindmap-core';

/** 본문 임베드가 다루는 종류 — 공책은 미리보기가 없다(한 줄 카드로 남는다). */
export type EmbedKind = 'map' | 'board' | 'kanban' | 'note';

/**
 * 그 문서의 종류. `kind`가 없는 옛 문서는 **마인드맵**이다(직렬화의 기본값과 같다 —
 * `serializeDoc`이 마인드맵일 때만 `kind`를 적지 않는다).
 */
export function embedKindOf(doc: Pick<Doc, 'kind'> | null | undefined): EmbedKind {
  const k = doc?.kind;
  return k === 'board' || k === 'kanban' || k === 'note' ? k : 'map';
}

/** 사람이 읽는 종류 이름 — 머리줄 메타와 고르기 목록이 함께 쓴다. */
export function embedKindName(kind: EmbedKind): string {
  return kind === 'kanban' ? '칸반 보드' : kind === 'board' ? '화이트보드' : kind === 'note' ? '공책' : '마인드맵';
}

/**
 * 본문에서 **무엇을 할 수 있는가**(머리줄 배지) — 스펙 §3.2-3. 없으면 빈 문자열이다.
 *
 * 칸반만 한 가지 편집(열 이동)을 허용한다 — 그때만 배지를 단다.
 *
 * **「보기 전용」은 달지 않는다**(요청). 임베드는 원래 읽는 자리이고 본문의 다른 어떤
 * 블록도 "여기서는 못 고칩니다"를 써 붙이지 않는다 — 판마다 붙은 그 배지는 알려 주는
 * 것 없이 머리줄만 좁혔다(같은 뜻의 안내 줄을 본문에서 걷어 낸 것과 한 결정이다).
 * 배지는 **되는 일이 따로 있을 때만** 말한다.
 */
export function embedRuleLabel(kind: EmbedKind, canEdit: boolean): string {
  return kind === 'kanban' && canEdit ? '열 이동만' : '';
}

/* ───────────────────────────── 보기 상태 기본값 ───────────────────────────── */

/**
 * 펼침인가. **기본이 `lg`**다(스펙 §2) — 한 줄 링크로는 "그 보드의 지금 상태"를 알 수
 * 없고, 본문에 붙이는 이유가 그것이기 때문이다. 그래서 `embed`가 아예 없는 옛 블록도
 * 펼쳐서 보여 준다.
 */
export function embedSize(block: Pick<NoteBlock, 'embed'>): 'sm' | 'lg' {
  return block.embed?.size === 'sm' ? 'sm' : 'lg';
}

/**
 * 칸반 보기 — 기본은 **두 번째 열**(대개 「진행 중」)이다. 열이 하나뿐이면 첫 열.
 *
 * 왜 두 번째인가: 회의록에 칸반을 붙이는 사람이 보여 주려는 것은 대개 "지금 무엇을
 * 하고 있나"다. 첫 열(할 일)은 쌓여만 가고 마지막 열(완료)은 지나간 것이다.
 */
export function kanbanView(block: Pick<NoteBlock, 'embed'>, columns: readonly KanbanColumn[]): { col: number; mine: boolean } {
  const v = block.embed?.kanban;
  const fallback = columns.length > 1 ? 1 : 0;
  const col = typeof v?.col === 'number' && v.col >= 0 && v.col < columns.length ? v.col : fallback;
  return { col, mine: !!v?.mine };
}

/**
 * 마인드맵 보기 — 기본은 **맵**, 앞의 두 가지를 펼쳐 둔다.
 *
 * 스펙은 개요가 기본이었는데(글 옆에는 글이 어울린다는 생각) 실제로 써 보니 반대였다
 * (요청): 맵을 본문에 붙이는 사람이 보여 주려는 것은 **그 맵의 생김새**다 — 가지가
 * 어떻게 뻗었는지가 한눈에 안 들어오면 굳이 붙일 이유가 없다. 개요는 골라서 본다.
 */
export function mindmapView(block: Pick<NoteBlock, 'embed'>): { view: 'outline' | 'map'; open: number[] } {
  const v = block.embed?.mindmap;
  return {
    view: v?.view === 'outline' ? 'outline' : 'map',
    open: Array.isArray(v?.open) ? v.open.filter((n) => Number.isInteger(n) && n >= 0) : [0, 1],
  };
}

/** 화이트보드 보기 — 기본은 `전체` 프레임, 중간 높이(스펙 §7.2). */
export function whiteboardView(block: Pick<NoteBlock, 'embed'>): { frame: number; height: 's' | 'm' | 'l' } {
  const v = block.embed?.whiteboard;
  const h = v?.height;
  return { frame: typeof v?.frame === 'number' && v.frame >= 0 ? v.frame : 0, height: h === 's' || h === 'l' ? h : 'm' };
}

/** 창 높이(px) — 작게 200 / 중간 280 / 크게 380(스펙 §7.2). */
export const WB_HEIGHT: Record<'s' | 'm' | 'l', number> = { s: 200, m: 280, l: 380 };

/**
 * 보기 상태에 **덧칠할 조각** — 저장된 모양(`NoteEmbedView`)과 달리 안쪽 칸이 전부
 * 선택이다. 「내 카드만」 하나만 뒤집을 때 고른 열까지 같이 적게 만들지 않으려는 것이다.
 */
export interface NoteEmbedPatch {
  size?: 'sm' | 'lg';
  kanban?: Partial<{ col: number; mine: boolean }>;
  mindmap?: Partial<{ view: 'outline' | 'map'; open: number[] }>;
  whiteboard?: Partial<{ frame: number; height: 's' | 'm' | 'l' }>;
}

export function mergeEmbed(prev: NoteEmbedView | undefined, patch: NoteEmbedPatch): NoteEmbedView {
  // 안쪽 칸은 **덮어쓰지 않고 겹친다**(`{...prev, ...patch}`) — 그래야 「내 카드만」
  // 하나를 뒤집어도 고른 열이 살아남는다. 통째 스프레드를 쓰지 않는 이유가 이것이다.
  const kanban = patch.kanban || prev?.kanban ? { col: 0, mine: false, ...prev?.kanban, ...patch.kanban } : undefined;
  /**
   * 빈 자리의 기본값은 **읽는 쪽과 같아야** 한다(`mindmapView`).
   *
   * 예전에는 여기가 `{ view: 'outline', open: [] }`였는데 읽는 쪽은 `open: [0, 1]`이라,
   * 아무것도 적히지 않은 임베드에서 보기를 한 번 바꾸는 순간 **펼쳐져 있던 두 가지가
   * 접혔다**(기본을 맵으로 돌리면서 드러났다 — 맵 → 개요로 가면 늘 접혀 있었다).
   */
  const mindmap = patch.mindmap || prev?.mindmap ? { view: 'map' as const, open: [0, 1], ...prev?.mindmap, ...patch.mindmap } : undefined;
  const whiteboard = patch.whiteboard || prev?.whiteboard ? { frame: 0, height: 'm' as const, ...prev?.whiteboard, ...patch.whiteboard } : undefined;
  return {
    ...prev,
    ...(patch.size ? { size: patch.size } : {}),
    ...(kanban ? { kanban } : {}),
    ...(mindmap ? { mindmap } : {}),
    ...(whiteboard ? { whiteboard } : {}),
  };
}

/* ───────────────────────────── 칸반 ───────────────────────────── */

export interface KanbanColStat {
  id: string;
  title: string;
  color: string | null;
  /** 지금 걸러진 기준의 카드 수(「내 카드만」이 켜지면 그 수). */
  count: number;
  /** 거른 것과 무관한 전체 수 — 진행률 막대가 쓴다(스펙 §5.2 마지막 줄). */
  total: number;
}

export interface KanbanStat {
  cols: KanbanColStat[];
  /** 전체 카드 수(거르기 무관). */
  total: number;
  /** **마지막 열**의 카드 수 — `완료 {done}/{total}`. */
  done: number;
}

/** 이 카드가 내 것인가 — 담당자 이메일이 나와 같을 때만. */
function isMine(card: KanbanCard, me: string): boolean {
  return !!me && (card.owner ?? '').toLowerCase() === me.toLowerCase();
}

/**
 * 열별 카드 수와 진행률(스펙 §5.1-5.2).
 *
 * **막대는 언제나 전체 기준**이고 열 탭의 숫자만 거른다 — 「내 카드만」은 보는 범위를
 * 좁히는 것이지 보드의 진행을 바꾸는 것이 아니다.
 */
export function kanbanStats(doc: Pick<Doc, 'columns' | 'cards'>, opts: { mine: boolean; me: string }): KanbanStat {
  const columns = doc.columns ?? [];
  const cards = doc.cards ?? [];
  const cols = columns.map((c) => {
    const inCol = cards.filter((k) => k.col === c.id);
    return {
      id: c.id,
      title: c.title,
      color: c.color ?? null,
      count: opts.mine ? inCol.filter((k) => isMine(k, opts.me)).length : inCol.length,
      total: inCol.length,
    };
  });
  const total = cols.reduce((n, c) => n + c.total, 0);
  return { cols, total, done: cols.length ? (cols[cols.length - 1] as KanbanColStat).total : 0 };
}

/**
 * 그 열의 카드 — 순서는 보드와 같고(`pos` 오름차순), **여섯 장까지**다(스펙 §5.3).
 *
 * `more`는 잘린 장수다 — 안내 줄이 `카드 N장 더 보기`로 쓴다.
 */
export function kanbanCards(
  doc: Pick<Doc, 'columns' | 'cards'>,
  opts: { col: number; mine: boolean; me: string; max?: number },
): { cards: KanbanCard[]; more: number } {
  const columns = doc.columns ?? [];
  const col = columns[opts.col];
  if (!col) return { cards: [], more: 0 };
  const all = (doc.cards ?? [])
    .filter((k) => k.col === col.id && (!opts.mine || isMine(k, opts.me)))
    .slice()
    .sort((a, b) => a.pos - b.pos);
  const max = opts.max ?? 6;
  return { cards: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * 카드를 다른 열로 — **끝에 놓는다**(스펙 §5.4: 열 안 순서 바꾸기는 없다).
 *
 * 같은 열이면 문서를 그대로 돌려준다(값이 같으면 저장도 하지 않는다 — 부르는 쪽이
 * 참조 비교로 가른다).
 */
export function moveKanbanCard(doc: Doc, cardId: string, toCol: number): Doc {
  const columns = doc.columns ?? [];
  const target = columns[toCol];
  const cards = doc.cards ?? [];
  const card = cards.find((k) => k.id === cardId);
  if (!target || !card || card.col === target.id) return doc;
  const last = cards.filter((k) => k.col === target.id).reduce((n, k) => Math.max(n, k.pos), 0);
  return { ...doc, cards: cards.map((k) => (k.id === cardId ? { ...k, col: target.id, pos: last + 1 } : k)) };
}

/* ───────────────────────────── 마인드맵 ───────────────────────────── */

export interface OutlineChild {
  id: string;
  text: string;
  /** 가지에서 몇 단 아래인가(1 = 가지의 바로 아래). 화면이 이만큼 들여 쓴다. */
  depth: number;
}

export interface OutlineBranch {
  id: string;
  text: string;
  color: string | null;
  /**
   * 이 가지 아래의 **모든 자손**을 깊이 우선으로 편 목록(요청).
   *
   * 스펙은 2단계까지만 펴고 그 아래는 `+N`으로 접었는데, 펼치기를 눌러도 손자가
   * 보이지 않아 "펼쳤는데 다 안 나온다"가 됐다(제보). 펼침은 **다 보여 주는 일**이니
   * 깊이를 들여쓰기로 말하고 수는 접지 않는다.
   */
  children: OutlineChild[];
  /** 이 가지 아래에 있는 **모든** 자손 수 — 행 끝의 회색 숫자. */
  count: number;
}

export interface Outline {
  /** 중심 주제(뿌리). 없으면 `null`(빈 맵). */
  root: { id: string; text: string } | null;
  branches: OutlineBranch[];
}

function nodeText(n: Node | undefined): string {
  return (n?.text ?? '').trim() || '제목 없음';
}

/**
 * 맵을 **개요 트리**로(스펙 §6.2).
 *
 * 자유 노드(`free`)는 뿌리에 매달리지 않으므로 개요에 넣지 않는다 — 개요는 "이 맵의
 * 줄기"를 보여 주는 자리이고, 떠 있는 메모는 그 줄기가 아니다.
 */
export function outlineOf(doc: Pick<Doc, 'nodes'>): Outline {
  const nodes = doc.nodes ?? {};
  const list = Object.values(nodes) as Node[];
  const root = list.find((n) => !n.parent && !n.free) ?? null;
  if (!root) return { root: null, branches: [] };
  const kid = (id: string): Node | undefined => nodes[id];
  const countAll = (id: string): number => {
    const n = kid(id);
    if (!n) return 0;
    return (n.children ?? []).reduce((sum, c) => sum + 1 + countAll(c), 0);
  };
  /** 그 가지 아래 전부 — 깊이 우선(문서의 자식 순서 그대로). */
  const flatten = (id: string, depth: number, seen: Set<string>): OutlineChild[] => {
    const n = kid(id);
    // 사이클은 문서가 깨졌을 때만 나지만, 나면 여기서 무한히 돈다.
    if (!n || seen.has(id)) return [];
    seen.add(id);
    return (n.children ?? []).flatMap((c) => {
      const node = kid(c);
      if (!node) return [];
      return [{ id: node.id, text: nodeText(node), depth }, ...flatten(node.id, depth + 1, seen)];
    });
  };
  const branches = (root.children ?? [])
    .map((bid) => kid(bid))
    .filter((n): n is Node => !!n)
    .map((b) => ({
      id: b.id,
      text: nodeText(b),
      color: b.color ?? null,
      children: flatten(b.id, 1, new Set<string>()),
      count: countAll(b.id),
    }));
  return { root: { id: root.id, text: nodeText(root) }, branches };
}

/* ───────────────────────────── 화이트보드 ───────────────────────────── */

export interface EmbedFrame {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 화이트보드의 **프레임 칩 목록** — 첫 칸은 언제나 `전체`(스펙 §7.1).
 *
 * `전체`의 사각형은 보드에 있는 모든 것(메모·구역·노드)을 감싸는 상자다. 아무것도
 * 없으면 기본 창 하나를 돌려준다 — 폭·높이가 0이면 맞춤 계산이 나눗셈에서 무너진다.
 */
export function embedFrames(doc: Pick<Doc, 'floats' | 'zones' | 'nodes'>): EmbedFrame[] {
  const zones = (doc.zones ?? []) as Zone[];
  const boxes: { x: number; y: number; w: number; h: number }[] = [
    ...(doc.floats ?? []).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h ?? 120 })),
    ...zones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
    ...Object.values(doc.nodes ?? {}).map((n) => ({ x: (n as Node).x, y: (n as Node).y, w: 160, h: 44 })),
  ];
  const all = boxes.length
    ? {
        x: Math.min(...boxes.map((b) => b.x)),
        y: Math.min(...boxes.map((b) => b.y)),
        w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
        h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
      }
    : { x: 0, y: 0, w: 800, h: 500 };
  return [
    { id: '', label: '전체', x: all.x, y: all.y, w: Math.max(1, all.w), h: Math.max(1, all.h) },
    ...zones.map((z) => ({ id: z.id, label: z.label || '프레임', x: z.x, y: z.y, w: Math.max(1, z.w), h: Math.max(1, z.h) })),
  ];
}

/**
 * 그 프레임이 창에 **맞춤**으로 들어오는 팬·줌(스펙 §7.1 — 여백 8%).
 *
 * 배율은 20%~250%로 묶는다(§7.2) — 아주 작은 프레임이 250%를 넘게 확대되면 글자만
 * 커지고 무엇인지 알 수 없다.
 */
export function fitFrame(frame: EmbedFrame, view: { w: number; h: number }): { x: number; y: number; z: number } {
  if (view.w <= 0 || view.h <= 0) return { x: 0, y: 0, z: 1 };
  const pad = 0.08;
  const raw = Math.min((view.w * (1 - pad * 2)) / frame.w, (view.h * (1 - pad * 2)) / frame.h);
  const z = Math.min(2.5, Math.max(0.2, raw));
  return { x: view.w / 2 - (frame.x + frame.w / 2) * z, y: view.h / 2 - (frame.y + frame.h / 2) * z, z };
}

/** 확대·축소 한 단계(스펙 §7.2 — ×1.1 / ×0.9), 창 **가운데** 기준. */
export function zoomAt(cur: { x: number; y: number; z: number }, factor: number, view: { w: number; h: number }): { x: number; y: number; z: number } {
  const z = Math.min(2.5, Math.max(0.2, cur.z * factor));
  const k = z / cur.z;
  return { x: view.w / 2 - (view.w / 2 - cur.x) * k, y: view.h / 2 - (view.h / 2 - cur.y) * k, z };
}

/* ───────────────────────────── 주소 ───────────────────────────── */

/**
 * 우리 보드 주소에서 문서 id를 뽑는다 — 붙여넣은 주소를 임베드로 바꿀 때 쓴다(스펙 §9).
 *
 * 받는 모양은 셋이다: `/editor?map=<id>` · `https://geurio.com/editor?map=<id>` ·
 * 해시가 붙은 같은 주소. 우리 주소가 **아니면 빈 문자열**이고, 그때는 평범한 링크로
 * 둔다 — 남의 사이트 주소를 미리보기라고 펴 놓을 수는 없다.
 *
 * `origin`을 받는 이유는 순수하게 두기 위해서다(`window`를 여기서 읽지 않는다).
 */
export function boardDocIdFromUrl(raw: string, origin: string): string {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return '';
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    return '';
  }
  // 절대 주소면 우리 출처여야 한다(상대 주소는 `origin`이 붙어 언제나 우리 것이다).
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && url.origin !== new URL(origin).origin) return '';
  if (url.pathname !== '/editor') return '';
  return url.searchParams.get('map') ?? '';
}

/** 한 페이지가 **작게** 넣기 시작하는 경계 — 여섯 번째부터다(스펙 §9). */
export const EMBED_LARGE_MAX = 5;

// 공책 — 페이지와 블록의 순수 규칙(문서 종류 `'note'`).
//
// 다른 세 종류와 다른 점 하나가 이 파일의 모양을 정한다: **좌표가 없다.** 캔버스가
// 아니라 글이므로 순서가 전부이고, 순서는 **배열 순서**다(칸반 카드의 `pos` 분수
// 인덱스를 쓰지 않는다).
//
// 왜 배열이어도 되는가: 칸반이 `pos`를 쓰는 이유는 끊긴 두 사람이 각자 카드를 옮길
// 때 배열 필드가 한쪽을 통째로 삼키기 때문인데(#332), 공책은 **실시간 공동 편집을
// 붙이지 않는다**(요청: 공유는 보기 권한까지). 그래서 배열이 가장 단순하고, 나중에
// 공동 편집을 붙일 때 순서 모델을 다시 정하면 된다 — 지금 `pos`를 깔아 두면 쓰지도
// 않는 복잡함을 문서마다 저장하게 된다.

import type { NoteBlock, NoteBlockKind, NoteCover, NoteListItem, NotePage, RichRun } from './model';
import { isStyledRuns } from './richtext';

/** 블록이 **어느 칸을 쓰는가** — 종류별 분기를 여기 한곳에 모은다. */
export type NoteBlockShape = 'runs' | 'items' | 'table' | 'link' | 'img' | 'empty';

/**
 * 이 블록의 본문이 어디에 들어 있는가.
 *
 * `NoteBlock`이 칸을 전부 선택으로 들고 있으므로(모델 주석 참고), "이 종류는 어디를
 * 보면 되나"의 답이 흩어지면 렌더·검색·내보내기가 각자 다르게 추측한다. 그 답을
 * 한 함수로 둔다.
 */
export function noteBlockShape(kind: NoteBlockKind): NoteBlockShape {
  switch (kind) {
    case 'ul':
    case 'ol':
    case 'ck':
      return 'items';
    case 'table':
      return 'table';
    case 'link':
      return 'link';
    case 'img':
      return 'img';
    case 'hr':
      return 'empty';
    default:
      return 'runs';
  }
}

/** 이 종류가 글을 담는가 — 편집기가 캐럿을 둘 수 있는 블록인지. */
export function noteBlockIsText(kind: NoteBlockKind): boolean {
  const shape = noteBlockShape(kind);
  return shape === 'runs' || shape === 'items' || shape === 'table';
}

/** 런 배열을 평문으로 — 검색·목록 요약·내보내기가 함께 쓴다. */
export function runsText(runs: RichRun[] | null | undefined): string {
  return (runs ?? []).map((r) => r.t || '').join('');
}

/** 평문 한 줄을 런 배열로(서식 없음). 빈 문자열도 런 하나로 둔다 — 편집기가 캐럿을
 *  놓을 자리가 필요하다. */
export function textRuns(text: string): RichRun[] {
  return [{ t: text, b: false, c: null }];
}

/** 서식이 없으면 런을 접는다 — 저장본이 평문일 때 키가 붙지 않게(맵과 같은 규칙). */
export function normalizeRuns(runs: RichRun[]): RichRun[] {
  const joined = runsText(runs);
  return isStyledRuns(runs) ? runs.filter((r) => r.t) : textRuns(joined);
}

let seq = 0;
/**
 * 새 id. **주입 없이 여기서 만든다** — 공책은 실시간 병합을 하지 않으므로 전역
 * 유일성이 필요 없고(문서 안에서만 유일하면 된다), 호출부마다 id 생성기를 넘기면
 * 템플릿·붙여넣기 경로가 전부 지저분해진다. 시각 + 증가 수라 같은 밀리초에 여러
 * 개를 만들어도 갈린다.
 */
export function noteId(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

/** 빈 문단 하나 — 새 페이지·빈 블록 자리에 쓴다. */
export function emptyBlock(kind: NoteBlockKind = 'p'): NoteBlock {
  const shape = noteBlockShape(kind);
  const block: NoteBlock = { id: noteId('bk'), kind };
  if (shape === 'runs') block.runs = textRuns('');
  // 토글만 **두 줄**을 쓴다: `runs`가 접어 둔 머리, `items[0]`이 펼쳤을 때의 내용.
  // 중첩 트리로 만들지 않은 이유는 `retypeBlock`·순서·삭제가 통째로 달라지기
  // 때문이고, 접는 쓰임의 대부분은 "긴 설명을 감춰 두기"라 한 줄로 충분하다.
  if (kind === 'toggle') block.items = [emptyItem()];
  else if (shape === 'items') block.items = [emptyItem()];
  else if (shape === 'table') block.rows = [[textRuns(''), textRuns('')], [textRuns(''), textRuns('')]];
  return block;
}

/** 빈 목록 항목 하나. */
export function emptyItem(): NoteListItem {
  return { id: noteId('it'), runs: textRuns('') };
}

/** 새 페이지 한 장. `blocks`를 주면 템플릿에서 시작한다. */
export function newPage(title = '', blocks?: NoteBlock[], now = new Date()): NotePage {
  return {
    id: noteId('pg'),
    title,
    blocks: blocks && blocks.length ? blocks : [emptyBlock('p')],
    updatedAt: now.toISOString(),
  };
}

/**
 * 페이지 목록에서 한 장을 지운다 — **마지막 한 장은 지우지 않는다.**
 *
 * 페이지가 없는 공책은 열 것이 없다(디자인도 "공책에는 페이지가 한 장 이상 있어야
 * 해요"로 막는다). 지우지 못했으면 **같은 배열을 그대로** 돌려주므로 호출부는
 * `next === pages`로 "막혔다"를 알 수 있다.
 */
export function removePage(pages: NotePage[], pageId: string): NotePage[] {
  if (pages.length <= 1) return pages;
  const next = pages.filter((p) => p.id !== pageId);
  return next.length === pages.length ? pages : next;
}

/** 페이지를 `index` 자리로 옮긴 목록(순서가 곧 배열이다). */
export function movePage(pages: NotePage[], pageId: string, index: number): NotePage[] {
  const from = pages.findIndex((p) => p.id === pageId);
  if (from < 0) return pages;
  const rest = pages.filter((p) => p.id !== pageId);
  const to = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, to), pages[from] as NotePage, ...rest.slice(to)];
}

/** 블록을 `index` 자리로 옮긴 목록. */
export function moveBlock(blocks: NoteBlock[], blockId: string, index: number): NoteBlock[] {
  const from = blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return blocks;
  const rest = blocks.filter((b) => b.id !== blockId);
  const to = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, to), blocks[from] as NoteBlock, ...rest.slice(to)];
}

/**
 * 블록 종류를 바꾼다 — **글은 살린다.**
 *
 * 문단 ↔ 목록처럼 담는 칸이 다른 종류로 옮길 때 글을 버리면 사용자는 방금 쓴 것을
 * 잃는다. 그래서 평문으로 한 번 내렸다가 새 칸에 담는다(서식은 런이 그대로 옮겨
 * 가는 경우에만 남는다 — 문단↔제목↔인용은 같은 `runs` 칸이라 온전하다).
 */
export function retypeBlock(block: NoteBlock, kind: NoteBlockKind): NoteBlock {
  if (block.kind === kind) return block;
  const from = noteBlockShape(block.kind);
  const to = noteBlockShape(kind);
  const next: NoteBlock = { id: block.id, kind };
  if (block.align) next.align = block.align;
  if (block.indent) next.indent = block.indent;
  if (to === 'runs') {
    next.runs = from === 'runs' ? (block.runs ?? textRuns('')) : textRuns(blockText(block));
    if (kind === 'callout') next.tone = block.tone ?? 'warn';
    if (kind === 'toggle') {
      next.open = block.open ?? true;
      // 머리와 본문 둘을 쓴다(`emptyBlock` 참고) — 옮겨 온 글은 머리에 남고
      // 본문 자리는 비워 둔다.
      next.items = block.items?.length ? block.items : [emptyItem()];
    }
  } else if (to === 'items') {
    next.items =
      from === 'items'
        ? (block.items ?? [emptyItem()]).map((it) => ({ ...it, ...(kind === 'ck' ? { done: !!it.done } : {}) }))
        : [{ id: noteId('it'), runs: block.runs ?? textRuns(blockText(block)) }];
    if (kind !== 'ck') next.items = next.items.map(({ id, runs }) => ({ id, runs }));
  } else if (to === 'table') {
    next.rows = block.rows ?? [[textRuns(blockText(block)), textRuns('')], [textRuns(''), textRuns('')]];
  } else if (to === 'link') {
    if (block.docId) next.docId = block.docId;
  } else if (to === 'img') {
    if (block.src) next.src = block.src;
  }
  return next;
}

/** 블록 한 덩이의 평문 — 검색과 목록 요약이 쓴다. 줄 구분은 개행이다. */
export function blockText(block: NoteBlock): string {
  switch (noteBlockShape(block.kind)) {
    case 'runs':
      return runsText(block.runs);
    case 'items':
      return (block.items ?? []).map((it) => runsText(it.runs)).join('\n');
    case 'table':
      return (block.rows ?? []).map((row) => row.map((cell) => runsText(cell)).join('\t')).join('\n');
    default:
      // 구분선·이미지·보드 링크는 글이 없다 — 검색에 걸릴 말이 없으므로 빈 문자열.
      return '';
  }
}

/** 페이지 본문의 평문 전체 — **제목은 넣지 않는다**(호출부가 제목을 따로 다룬다). */
export function pageText(page: NotePage): string {
  return page.blocks.map(blockText).filter(Boolean).join('\n');
}

/** 목록 카드에 보이는 **첫 줄** — 디자인의 공책 카드가 본문 첫 줄을 그대로 보여 준다. */
export function pageExcerpt(page: NotePage, max = 140): string {
  const first = page.blocks.map(blockText).find((t) => t.trim());
  const line = (first ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 이 공책에서 마지막으로 고쳐진 시각(페이지 중 가장 최근). */
export function noteUpdatedAt(pages: NotePage[]): string | null {
  let best: string | null = null;
  pages.forEach((p) => {
    if (p.updatedAt && (!best || p.updatedAt > best)) best = p.updatedAt;
  });
  return best;
}

/** 체크리스트 진행 — 스페이스 카드의 `1/3`이 이 값이다. 없으면 `null`. */
export function noteChecklistProgress(pages: NotePage[]): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  pages.forEach((p) =>
    p.blocks.forEach((b) => {
      if (b.kind !== 'ck') return;
      (b.items ?? []).forEach((it) => {
        total += 1;
        if (it.done) done += 1;
      });
    }),
  );
  return total ? { done, total } : null;
}

/* ── 표지 ─────────────────────────────────────────────────────────────────── */

/** 태그별 기본 표지 색 — 디자인의 `TAG_COVER`. */
const TAG_COVER: Record<string, string> = {
  회의록: '#8E5A80',
  회고: '#B4512E',
  정책: '#3E66B8',
  카피: '#9A6A14',
  리서치: '#2F7D57',
  스크랩: '#6E655C',
};

/** 태그별 기본 스케치 — 디자인의 `TAG_SKETCH`. */
const TAG_SKETCH: Record<string, NoteCover['sketch']> = {
  회의록: 'grid',
  회고: 'grid',
  정책: 'list',
  카피: 'list',
  리서치: 'clip',
  스크랩: 'clip',
};

/** 아무 단서도 없을 때의 표지 색(흑연). */
export const NOTE_COVER_FALLBACK = '#6E655C';

/**
 * 이 공책의 표지 색 — **사용자 지정 > 태그 기본 > 흑연**.
 *
 * 우선순위를 함수로 두는 이유는 디자인이 세 겹이기 때문이다: 직접 고른 색이 있으면
 * 그것, 없으면 태그가 정해 주고, 태그도 없으면 기본값. 카드·에디터·표지 메뉴가
 * 각자 판단하면 같은 공책이 자리마다 다른 색으로 보인다.
 */
export function noteCoverColor(cover: NoteCover | null | undefined): string {
  if (cover?.color) return cover.color;
  const tag = cover?.tag;
  return (tag && TAG_COVER[tag]) || NOTE_COVER_FALLBACK;
}

/** 표지 스케치 — 색과 같은 우선순위(없으면 `'grid'`). */
export function noteCoverSketch(cover: NoteCover | null | undefined): NonNullable<NoteCover['sketch']> {
  if (cover?.sketch) return cover.sketch;
  const tag = cover?.tag;
  return (tag && TAG_SKETCH[tag]) || 'grid';
}

/** 태그 색(칩) — 디자인의 `NOTE_TAGS`. 모르는 태그는 회색. */
const TAG_INK: Record<string, string> = {
  회의록: '#C98BB4',
  정책: '#7FA6E8',
  카피: '#E8A93C',
  리서치: '#69B08A',
  스크랩: '#B0A69B',
  회고: '#E8845C',
};

/**
 * 새로 만든 태그의 색 — **이름 해시로 팔레트에서 고른다**(디자인의 `tagColorFor`).
 * 같은 이름이면 언제나 같은 색이라, 기기·세션이 달라도 그 태그의 색이 흔들리지 않는다.
 */
const TAG_PALETTE: readonly string[] = ['#D8794F', '#7C9BD8', '#69B08A', '#C98BB4', '#D8A24F', '#5EC8C0', '#A9724F', '#E45DA0'];

/**
 * 태그를 만들 때 **고를 수 있는 점 색**(값, 이름) — 해시가 고르는 그 여덟이다.
 *
 * 팔레트를 따로 만들지 않은 이유: 고르지 않으면 이 중 하나가 자동으로 걸리므로,
 * 목록이 같아야 "고른 색"과 "저절로 정해진 색"이 같은 계열로 보인다.
 */
export const NOTE_TAG_COLORS: readonly (readonly [string, string])[] = [
  ['#D8794F', '주황'],
  ['#7C9BD8', '파랑'],
  ['#69B08A', '초록'],
  ['#C98BB4', '자두'],
  ['#D8A24F', '노랑'],
  ['#5EC8C0', '청록'],
  ['#A9724F', '갈색'],
  ['#E45DA0', '분홍'],
];

/**
 * 공책·페이지 태그 칩의 색.
 *
 * 순서: **사람이 고른 색**(`colors` — 문서의 `tagColors`) → 기본 여섯(디자인이 고른
 * 색) → 이름 해시 팔레트. 마지막 단계가 있는 이유는, 예전에는 모르는 이름을 전부
 * 회색으로 칠해 직접 만든 태그끼리 구분이 되지 않았기 때문이다.
 */
export function noteTagColor(tag: string | null | undefined, colors?: Record<string, string> | null): string {
  const name = tag?.trim();
  if (!name) return '#B0A69B';
  // **사람이 고른 색이 먼저다** — 기본 여섯도 덮어쓸 수 있다(그 이름을 다른 뜻으로
  // 쓰는 팀이 있다). 문서에 적힌 값이라 그 공책을 여는 모든 사람이 같은 색을 본다.
  const picked = colors?.[name];
  if (picked) return picked;
  const known = TAG_INK[name];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length]!;
}

/** 고를 수 있는 태그 목록 — 디자인의 태그 메뉴 순서 그대로. */
export const NOTE_TAGS: readonly string[] = ['회의록', '정책', '카피', '리서치', '스크랩', '회고'];

/** 고를 수 있는 표지 색 — 디자인의 `COVERS`(값, 이름). */
export const NOTE_COVERS: readonly (readonly [string, string])[] = [
  ['#B4512E', '테라코타'],
  ['#9A6A14', '겨자'],
  ['#2F7D57', '숲'],
  ['#3E66B8', '코발트'],
  ['#8E5A80', '자두'],
  ['#6E655C', '흑연'],
];

/** 형광펜 색 — 키와 실제 색(런의 `hl`이 이 키를 든다). */
const HIGHLIGHTS: Record<string, string> = {
  yellow: '#FBEFC0',
  green: '#D9EFDC',
  blue: '#DCE8FA',
  pink: '#F9DDE8',
  gray: '#E8E2DA',
};

/** 형광펜 키 → 실제 색. 모르는 키는 `null`(칠하지 않는다). */
export function noteHighlightColor(key: string | null | undefined): string | null {
  return (key && HIGHLIGHTS[key]) || null;
}

/** 고를 수 있는 형광펜 — 키·이름 순서(디자인의 `HL`). */
export const NOTE_HIGHLIGHTS: readonly (readonly [string, string])[] = [
  ['yellow', '노랑'],
  ['green', '초록'],
  ['blue', '파랑'],
  ['pink', '분홍'],
  ['gray', '회색'],
];

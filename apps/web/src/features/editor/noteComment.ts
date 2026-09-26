// 공책 **본문 인라인 댓글**(스펙 6절)의 순수 규칙 — 어디에 걸렸는가를 런에서 읽고,
// 어디에 걸 수 있는지를 가른다. DOM도 React도 보지 않는다(테스트가 쉬운 자리).
//
// ## 본문과 서버가 나누어 드는 것
//
// 본문(`RichRun.cm`)이 드는 것은 **스레드 id 하나**다. 누가 무엇을 썼고 해결했는지는
// 댓글 저장소(0020 `document_comments`)에 있다 — 그래야 문서를 되돌려도 논의가
// 남고(버전 기록), 자동저장마다 통째로 오가는 값이 무거워지지 않는다.
//
// 스레드를 저장소에 **어떻게** 얹는가: 뿌리 댓글의 `nodeId`를 `nm:<스레드id>`로 둔다.
// 그 칸은 자유 문자열이고(0020 — 본문 jsonb 안의 키라 참조 무결성을 걸 수 없다),
// 답글(`parentId`)·해결(`setResolved`)·좋아요·멘션이 이미 그 위에 서 있다. 새 테이블을
// 만들지 않는 값은 **마이그레이션 없이** 이 기능이 선다는 것이다.
//
// ## 인용문은 스냅샷이 아니라 **지금 본문**이다
//
// 스펙 6-7은 만들 때의 원문을 스레드에 스냅샷으로 두자고 적었지만, 여기서는 본문의
// 형광 구간에서 **그때그때 읽는다**. 표식이 글자를 따라가므로(같은 절이 정한 규칙)
// 인용도 함께 따라가고, 서버에 칸을 더하지 않아도 된다. 대가는 하나다 — 글이 통째로
// 지워지면 표식도 사라져 인용을 되살릴 수 없다("원문이 지워졌어요"는 인용 없이 뜬다).

import type { NoteBlock, NotePage, RichRun } from '@mindflow/mindmap-core';
import { noteBlockShape, noteId, runsText } from '@mindflow/mindmap-core';

/** 뿌리 댓글의 `nodeId` 앞머리 — 주제(노드) 댓글과 한 표에 살면서 갈린다. */
export const THREAD_NODE_PREFIX = 'nm:';

/** 스레드 id → 댓글 저장소가 쓰는 대상 id. */
export function threadNodeId(threadId: string): string {
  return THREAD_NODE_PREFIX + threadId;
}

/** 그 반대 — 본문 댓글이 아니면 `null`(페이지 댓글은 여기서 걸러진다). */
export function threadIdOfNode(nodeId: string): string | null {
  return nodeId.startsWith(THREAD_NODE_PREFIX) ? nodeId.slice(THREAD_NODE_PREFIX.length) : null;
}

/** 새 스레드 id — 문서 안에서만 유일하면 된다(공책은 실시간 병합을 하지 않는다). */
export function newThreadId(): string {
  return noteId('cm');
}

export interface CommentSpan {
  id: string;
  /** `[a, b)` — 런을 펼친 글자 좌표(편집 박스의 선택 좌표와 같은 자)다. */
  a: number;
  b: number;
}

/**
 * 이 줄에 걸린 댓글 구간들 — 같은 스레드가 서식 경계로 갈려 여러 런이 되어도 **하나로**
 * 모은다(`runsToHtml`이 런마다 감싸므로 DOM은 여러 조각이지만 논리는 한 구간이다).
 */
export function commentSpans(runs: RichRun[] | null | undefined): CommentSpan[] {
  const out: CommentSpan[] = [];
  let at = 0;
  (runs ?? []).forEach((r) => {
    const len = (r.t || '').length;
    if (r.cm) {
      const last = out[out.length - 1];
      if (last && last.id === r.cm && last.b === at) last.b = at + len;
      else out.push({ id: r.cm, a: at, b: at + len });
    }
    at += len;
  });
  return out;
}

/** `[a, b)`가 이미 걸린 구간과 겹치는가 — 1판은 겹치는 댓글을 허용하지 않는다(6-2). */
export function overlapsComment(runs: RichRun[] | null | undefined, a: number, b: number): boolean {
  return commentSpans(runs).some((s) => s.a < b && a < s.b);
}

/** 그 스레드의 **인용문** — 이 줄에 없으면 빈 문자열. */
export function quoteOf(runs: RichRun[] | null | undefined, threadId: string): string {
  const text = runsText(runs);
  const hit = commentSpans(runs).filter((s) => s.id === threadId);
  if (!hit.length) return '';
  return text.slice(hit[0]!.a, hit[hit.length - 1]!.b);
}

/**
 * **댓글을 달 수 있는 줄인가**(6-2: 위젯 블록은 대상에서 뺀다).
 *
 * 남기는 것: 글을 담는 블록(문단·제목·인용·콜아웃·토글·코드)과 **글머리·번호 목록**.
 * 빼는 것: 표 · 체크리스트 · 그림 · 구분선 · 삽입한 문서. 표와 체크리스트를 빼는 이유는
 * 스펙이 적은 그대로이고, 나머지 셋은 애초에 캐럿이 서지 않는다.
 */
export function canCommentOn(block: NoteBlock | null | undefined): boolean {
  if (!block) return false;
  if (block.kind === 'ck') return false;
  const shape = noteBlockShape(block.kind);
  return shape === 'runs' || shape === 'items';
}

export interface CommentSite extends CommentSpan {
  pageId: string;
  blockId: string;
  /** 목록 항목이면 그 id — 블록 자신의 `runs`면 `null`. */
  itemId: string | null;
  /** 편집기가 쓰는 줄 키(`<블록id>` 또는 `<블록id>:<항목id>`). */
  lineKey: string;
  quote: string;
}

/**
 * 이 공책 전체에서 본문 댓글이 걸린 자리 — 우측 패널이 스레드를 본문에 이어 붙일 때
 * 쓴다. **문서를 훑는 자리는 여기 하나**여야 한다(빠뜨리면 그 자리의 스레드만 조용히
 * 패널에서 사라진다 — 0043에서 겪은 것과 같은 모양의 사고다).
 */
export function noteCommentSites(pages: NotePage[] | null | undefined, pageId?: string | null): CommentSite[] {
  const out: CommentSite[] = [];
  (pages ?? []).forEach((pg) => {
    if (pageId && pg.id !== pageId) return;
    (pg.blocks ?? []).forEach((b) => {
      const eat = (runs: RichRun[] | null | undefined, itemId: string | null): void => {
        const text = runsText(runs);
        commentSpans(runs).forEach((s) => {
          out.push({ ...s, pageId: pg.id, blockId: b.id, itemId, lineKey: itemId ? `${b.id}:${itemId}` : b.id, quote: text.slice(s.a, s.b) });
        });
      };
      eat(b.runs, null);
      (b.items ?? []).forEach((it) => eat(it.runs, it.id));
    });
  });
  return out;
}

// ── 댓글 창의 자리(6-4) ────────────────────────────────────────────────────

/** 댓글 창의 폭 — 스펙 6-4. */
export const COMMENT_BOX_W = 328;

export interface BoxPos {
  left: number;
  /** 아래로 열렸을 때의 `top` — 위로 열렸으면 `null`. */
  top: number | null;
  /** 위로 열렸을 때의 `bottom`(화면 아래에서) — 아래로 열렸으면 `null`.
   *  높이를 몰라도 서게 하려고 `top`이 아니라 이 값으로 붙인다. */
  bottom: number | null;
  maxHeight: number;
  place: 'below' | 'above';
}

/**
 * 형광 부분을 기준으로 댓글 창을 세울 자리(6-4).
 *
 * "아래 공간이 330px보다 넓거나 위보다 넓으면 아래로" — 즉 **웬만하면 아래**이고,
 * 아래가 좁고 위가 더 넓을 때만 위로 넘긴다. 높이는 열린 쪽 공간에서 16을 뺀 값을
 * 160~460으로 조인다(창이 화면 밖으로 잘리지 않게 — 6-4의 마지막 줄).
 */
export function commentBoxPos(rect: { left: number; top: number; bottom: number }, vw: number, vh: number, gap = 8, pad = 12): BoxPos {
  const below = vh - rect.bottom - gap;
  const above = rect.top - gap;
  const place: 'below' | 'above' = below > 330 || below >= above ? 'below' : 'above';
  const room = place === 'below' ? below : above;
  const maxHeight = Math.min(460, Math.max(160, room - 16));
  const left = Math.max(pad, Math.min(rect.left, Math.max(pad, vw - COMMENT_BOX_W - pad)));
  return place === 'below'
    ? { left, top: rect.bottom + gap, bottom: null, maxHeight, place }
    : { left, top: null, bottom: vh - rect.top + gap, maxHeight, place };
}

// ── 패널 ↔ 본문 (문서 이벤트) ──────────────────────────────────────────────

/**
 * 「본문 댓글」 카드를 누르면 **본문의 그 형광으로** 간다(6-6).
 *
 * 패널(`CommentPanel`)과 본문(`NoteEditor`)은 서로의 상태를 모른다 — 한쪽은 에디터
 * 화면의 오른쪽 열이고 한쪽은 본문 단이라 공통 부모가 라우트뿐이다. 둘을 잇는 값이
 * 스레드 id 하나뿐이므로 컨텍스트를 새로 세우지 않고 **문서 이벤트**로 부른다
 * (`NOTE_ARMED_EVENT`가 툴바와 편집 박스를 잇는 방식과 같다).
 */
export const NOTE_CM_OPEN_EVENT = 'mf-note-comment-open';

export function openNoteComment(threadId: string): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(NOTE_CM_OPEN_EVENT, { detail: threadId }));
}

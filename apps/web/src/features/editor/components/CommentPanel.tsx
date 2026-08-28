// 주제(노드)에 붙는 댓글 패널 — 스레드(답글)·멘션·해결 표시(0021).
//
// 자리: 데스크톱은 **오른쪽**(속성 패널이 왼쪽이라 둘이 함께 떠도 부딪히지 않는다.
// 위로는 접속자 아바타, 아래로는 미니맵/줌 묶음을 피한다), 모바일은 바텀 시트.
//
// 대상은 "지금 고른 주제" 하나다 — 주제를 바꾸면 패널이 따라간다(useEditorState).
// 문서 전체 댓글은 루트 주제의 댓글로 대신한다(0020의 설계 메모 참고).
//
// 용어(요청): 캔버스(맵·화이트보드)에서 핀에 붙는 논의는 **스레드**, 칸반 카드에
// 붙는 목록형 논의는 **댓글**이다. 두 자리를 이 파일이 함께 그리므로 화면 문구는
// `thread`(핀인가) 하나로 갈린다 — 알림 문구만 중립어('댓글')를 쓴다(양쪽에서 온다).
//
// 스레드 모델: 최상위 댓글이 스레드 뿌리, 답글은 단층(대댓글 없음 — 0021 트리거).
// 해결 표시는 뿌리에만 있고, 해결된 스레드는 접힌 구획으로 내려간다 — 남은 논의만
// 눈에 들어오게(배지도 미해결 스레드만 센다).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { participantAvatars } from '../useParticipantAvatars';
import { createPortal } from 'react-dom';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { CommentMention, DocComment, ShareParticipant } from '../../../adapters/ports';
import { panelTitleLine } from './panel/panelPrimitives';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import { useIsTouchDevice } from '../../../hooks/useMediaQuery';
import { useSoftKeyboardOpen } from '../../../hooks/useKeyboardInset';
import { CARD_SHADOW, MONO_FONT, glassCard } from '../chrome';
import { anchoredBoxPos } from './commentAnchor';
import { BOARD_BAR_LIFT } from './BoardToolbar';
import { Avatar } from './commentPinShape';
import { formatFullDateTime, formatLastEdited } from '../../home/timeFormat';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { useShareStore } from '../../../adapters/BackendContext';
import { useAuthUser } from '../../../adapters/useAuthUser';

interface Thread {
  root: DocComment;
  replies: DocComment[];
}

/**
 * 댓글 대상의 종류가 드러나는 한 줄 제목(순수). 없으면 null이고, 그때는 부제 줄을
 * 아예 그리지 않는다.
 *
 * 캔버스 문서에서 댓글은 **핀에만** 붙는다(요청 ⑧) — 핀에는 이름이 없고 자리가 곧
 * 정체라 부제로 할 말이 없다. 예전에는 그런 대상에 "사라진 대상"이라고 적었는데,
 * 멀쩡한 핀을 열어 놓고 사라졌다고 말하는 꼴이었다(제보 ⑥).
 */

/**
 * 댓글 열이 실제로 쓰는 것 — **에디터 컨트롤러 전체가 아니라 이 열 가지**다.
 *
 * 왜 좁혔나: 이 열을 **홈의 일정 상세 팝업**도 쓴다(디자인 원본의 오른쪽 열). 홈에는
 * 에디터 컨트롤러가 없고, 같은 목록·작성·좋아요·멘션을 두 벌로 만들면 한쪽에만
 * 기능이 붙는다(`ShareModal`·`FeedbackModal`에서 이미 쓴 구조적 프롭 방식).
 *
 * `EditorController`가 이 멤버를 모두 가지고 있으므로 **에디터 호출부는 그대로**다
 * (구조적 타이핑) — 홈은 댓글 포트로 같은 모양을 만들어 넘긴다.
 */
export interface CommentHost {
  uiTheme: Theme;
  docId: string;
  comments: DocComment[];
  commentsLoading: boolean;
  myName: string;
  myAvatar: string | null;
  addComment: (nodeId: string, body: string, opts?: { parentId?: string; mentions?: CommentMention[] }) => Promise<{ error?: string }>;
  removeComment: (commentId: string) => Promise<{ error?: string }>;
  likeComment: (commentId: string, liked: boolean) => Promise<{ error?: string }>;
  /** 입력창에서 Escape — 에디터는 패널을 닫는다. 없으면 아무것도 하지 않는다(홈의
   *  상세 팝업은 모달 자신이 Escape를 받아 닫히므로 여기서 가로채면 두 번 닫는 셈). */
  closeComments?: () => void;
}

export function commentTargetLabel(doc: EditorController['doc'], id: string): string | null {
  // 칸반 — 대상은 카드다. 문서 전체 댓글은 마인드맵과 같은 자리(ROOT_ID)를 쓰는데,
  // 칸반에는 루트 주제가 없으므로 "보드 전체"라고 말한다.
  if (doc.kind === 'kanban') {
    const c = (doc.cards ?? []).find((x) => x.id === id);
    if (c) return `카드 · ${panelTitleLine(c.text) || '카드'}`;
    if (id === ROOT_ID) return '보드 전체';
    return '사라진 카드';
  }
  return null;
}

const PANEL_W = 326;
/** 높이를 아직 재지 못한 첫 프레임에 쓰는 어림값(곧 실측으로 교정된다). */
const PANEL_H_GUESS = 300;
/** 화면 위·아래로 남겨 두는 여유 — 팝업이 화면 끝에 딱 붙지 않게. */
const PANEL_V_MARGIN = 24;

/**
 * 데스크톱 팝업의 자리 — 대상이 **핀이면 그 핀 옆**(요청 ⑦: 객체 근처에), 아니면
 * 예전처럼 우상단(칸반 카드·보드 전체 댓글).
 *
 * 핀 옆에 두는 이유는 단순하다: 캔버스에 여럿 꽂힌 핀 중 **어느 것의 논의인지**를
 * 화면 구석의 패널은 말해 주지 못한다(핀에는 이름도 없다 — 그래서 부제도 없앴다).
 *
 * 높이는 **실측값**을 넘긴다: 팝업이 내용만큼 자라므로(요청) 고정값으로 자리를
 * 잡으면 짧은 스레드는 필요 이상으로 위로 밀리고, 긴 스레드는 화면을 넘는다.
 */
function panelPos(controller: EditorController, h: number, bottomInset: number): CSSProperties {
  const pin = (controller.doc.commentPins ?? []).find((p) => p.id === controller.commentsNodeId);
  if (!pin || !controller.vw || !controller.vh) return { right: 16, top: 80 };
  const { left, top } = anchoredBoxPos({ pan: controller.pan, zoom: controller.zoom, vw: controller.vw, vh: controller.vh }, pin, PANEL_W, h, undefined, bottomInset);
  return { left, top };
}

export function CommentPanel({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const nodeId = controller.commentsNodeId;
  const open = controller.commentsOpen;
  // 팝업 높이는 **내용이 정한다**(요청) — 자리를 잡으려면 그 값을 알아야 하므로
  // 페인트 전에 재고(useLayoutEffect), 글이 늘어날 때마다 다시 잰다.
  const panelRef = useRef<HTMLElement | null>(null);
  const [panelH, setPanelH] = useState(PANEL_H_GUESS);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || isMobile || !open) return;
    const measure = (): void => setPanelH(el.offsetHeight || PANEL_H_GUESS);
    measure();
    // jsdom에는 ResizeObserver가 없다 — 첫 실측만으로도 자리는 맞는다.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, open, nodeId, controller.comments.length]);

  /** ⋯의 스레드 삭제 확인창(제보 ①) — 훅이므로 조기 return 위에 둔다. */
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!open) return null;

  const title = commentTargetLabel(controller.doc, nodeId);
  /** 보드의 하단 도구 막대는 z가 이 팝업보다 높다 — 그 높이만큼 자리를 내준다
   * (팝업이 화면 아래까지 자라면 막대가 입력칸을 덮는다). */
  const bottomReserve = controller.isBoard && !controller.readOnly ? BOARD_BAR_LIFT : 0;

  const wrap: CSSProperties = isMobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '55dvh',
        border: `1px solid ${th.border}`,
        borderBottom: 'none',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 30px rgba(0,0,0,.14)',
        zIndex: 27,
        background: th.panel,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        position: 'absolute',
        // 디자인 원본의 댓글 패널(326) — 유리질 카드 + 더 둥근 모서리.
        width: PANEL_W,
        ...panelPos(controller, panelH, bottomReserve),
        // 높이는 내용만큼 자라고, **화면을 벗어나지 않는 선**에서 멈춘다(요청) —
        // 예전에는 420px 고정 상한이라 짧은 글에도 그 안에서 스크롤이 났다.
        // 보드에서는 하단 도구 막대(이 팝업보다 위에 그려진다)의 자리를 비워 둔다.
        maxHeight: Math.max(220, (controller.vh || 800) - PANEL_V_MARGIN * 2 - bottomReserve),
        ...glassCard(th, 0.97),
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        zIndex: 16,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      };

  // 핀 = **하나의 스레드**다(시안 ①) — 머리에 스레드의 글 수와 해결 토글이 선다.
  // 칸반 카드는 여러 논의가 붙는 자리라 예전처럼 목록이다.
  const pinThread = !!(controller.doc.commentPins ?? []).find((p) => p.id === nodeId);
  const msgs = controller.comments.filter((c) => c.nodeId === nodeId);
  const root = msgs.find((c) => !c.parentId) ?? null;
  const resolved = !!root?.resolved;

  const panel = (
    <aside
      ref={panelRef}
      style={{
        ...wrap,
        // 스크롤바 색은 CSS가 알 수 없는 인라인 테마값이라 변수로 내려 준다.
        ['--mf-cmt-sb' as string]: hexA(th.text, 0.16),
        ['--mf-cmt-sb-hover' as string]: hexA(th.text, 0.32),
      }}
      data-comment-panel
      aria-label={pinThread ? '스레드' : '댓글'}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px 11px 16px', borderBottom: `1px solid ${th.border}` }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.01em', color: th.text }}>{pinThread ? '스레드' : '댓글'}</span>
          {pinThread ? (
            <span data-thread-count style={{ minWidth: 20, padding: '1px 6px', borderRadius: 999, background: th.panel2, color: th.subtext, fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
              {msgs.length}
            </span>
          ) : (
            // 부제는 **할 말이 있을 때만**(칸반 카드·보드 전체).
            title && (
              <span title={title} style={{ fontSize: 11.5, color: th.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title}
              </span>
            )
          )}
        </div>
        {/* 해결 — 시안 ①. 논의가 끝났음을 핀에도 표시한다(초록 체크). 뿌리 글에만 붙고,
            스레드가 아직 없으면(빈 핀) 누를 것도 없다. */}
        {pinThread && root && (
          <button
            type="button"
            className="mf-ed-btn"
            data-resolve-toggle
            aria-pressed={resolved}
            title={resolved ? '해결 표시 지우기' : '해결됨으로 표시'}
            onClick={() => void controller.resolveComment(root.id, !resolved)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: isMobile ? 36 : 26,
              padding: '0 9px',
              borderRadius: 999,
              border: `1px solid ${resolved ? '#2f9e63' : th.border}`,
              background: resolved ? hexA('#2f9e63', 0.12) : 'transparent',
              color: resolved ? '#2f9e63' : th.subtext,
              fontFamily: 'inherit',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 12.5 9.5 18 20 6.5" />
            </svg>
            해결
          </button>
        )}
        {/* ⋯ — 스레드 통째로 지우기(각 글의 '삭제'는 그 글만 지운다). 내 스레드일 때만.
            **확인을 먼저 받는다**(제보 ①): 글 여러 개가 한 번에 사라지고, 댓글은
            본문이 아니라 별도 저장소에 살아서 실행 취소로 돌아오지 않는다. */}
        {pinThread && root?.mine && <ThreadMenu th={th} isMobile={isMobile} onDelete={() => setConfirmDelete(true)} />}
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.closeComments}
          aria-label={pinThread ? '스레드 닫기' : '댓글 닫기'}
          title="닫기"
          style={{ width: isMobile ? 44 : 26, height: isMobile ? 44 : 26, border: 'none', background: 'transparent', color: th.subtext, borderRadius: 7, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit', flexShrink: 0 }}
        >
          ✕
        </button>
      </header>
      <CommentThreads controller={controller} nodeId={nodeId} scroll thread={pinThread} />
    </aside>
  );

  return (
    <>
      {panel}
      {/* 확인창은 **패널 밖**(body)에 그린다 — 유리질 카드의 `backdrop-filter`가
          fixed 자식의 기준 상자가 되고 `overflow: hidden`이 잘라서, 안에 두면
          전체 화면 막이 패널 크기로 오그라든다(실브라우저에서 확인). */}
      {confirmDelete &&
        typeof document !== 'undefined' &&
        createPortal(
          <ConfirmDeleteThread
            count={msgs.length}
            theme={th}
            isMobile={isMobile}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              const res = await controller.removeThread(nodeId);
              // 실패했으면 확인창을 열어 둔 채 이유를 보여 준다(닫아 버리면 왜 남았는지
              // 알 수 없다). 성공하면 핀이 정리되며 패널 자체가 닫힌다.
              if (!res.error) setConfirmDelete(false);
              return res;
            }}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * 스레드 삭제 확인(제보 ①).
 *
 * ⋯의 삭제는 예전에 **첫 글 하나만** 지웠다 — 여러 번 눌러야 스레드가 비었고,
 * 그 사이 무엇이 지워지는지도 알 수 없었다. 이제 스레드의 글을 한 번에 지우므로
 * **몇 개가 사라지는지 밝히고** 한 번 묻는다. 칸반 열 삭제 확인창과 같은 결이되,
 * 되돌릴 수 있다는 말은 하지 않는다 — 댓글은 본문(문서)이 아니라 별도 저장소에
 * 살아서 실행 취소로 돌아오지 않는다(핀만 되돌아온다).
 *
 * 파괴적 버튼에 처음부터 초점이 가지 않게 **취소에 초점**을 둔다.
 */
function ConfirmDeleteThread({
  count,
  theme: th,
  isMobile,
  onCancel,
  onConfirm,
}: {
  count: number;
  theme: EditorController['uiTheme'];
  isMobile: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<{ error?: string }>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const btn: CSSProperties = { height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
  return (
    <div
      data-confirm-delete-thread-veil
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 350, background: hexA('#2e2a26', 0.34), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        data-confirm-delete-thread
        role="dialog"
        aria-modal="true"
        aria-label="스레드 삭제 확인"
        style={{ width: 'min(380px, 100%)', boxSizing: 'border-box', padding: 20, borderRadius: 16, background: th.panel, border: `1px solid ${th.border}`, boxShadow: '0 40px 90px -40px rgba(0,0,0,.6)' }}
      >
        <strong style={{ display: 'block', fontSize: 15.5, color: th.text, marginBottom: 8 }}>이 스레드를 삭제할까요?</strong>
        <p data-confirm-body style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: th.subtext }}>
          {`글 ${count}개가 모두 사라지고 캔버스의 핀도 함께 없어져요.`} 되돌릴 수 없어요.
        </p>
        {error && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#c0532e' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button ref={cancelRef} type="button" className="mf-ed-btn" data-confirm-cancel onClick={onCancel} disabled={busy} style={{ ...btn, border: `1px solid ${th.border}`, background: th.panel, color: th.text }}>
            취소
          </button>
          <button
            type="button"
            className="mf-ed-btn"
            data-confirm-delete
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm().then((res) => {
                setBusy(false);
                if (res.error) setError(res.error);
              });
            }}
            style={{ ...btn, border: '1px solid #c0532e', background: '#c0532e', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 스레드 목록 + 작성칸 — **패널과 카드 상세가 함께 쓰는 몸통**.
 *
 * 카드 상세 모달 안에서도 같은 댓글을 다루게 하려고(요청) 떼어 냈다. 로직(스레드
 * 구성·답글·해결·멘션·실시간)은 한 벌이고, 다른 것은 껍데기뿐이다: 패널은 자기
 * 높이 안에서 목록만 스크롤하고(`scroll`), 모달 안에서는 흐름에 따라 늘어난다
 * (모달 자신이 스크롤한다).
 */
/** 그 글이 **보이도록** 목록을 옮긴다(제보: 길게 쓴 답글이 화면 밖에 남았다).
 *
 * 규칙 둘: 글이 보이는 높이보다 길면 **머리**를 위에 두고(끝으로 가면 꼬리만
 * 보여 읽을 수가 없다), 짧으면 아래가 걸리지 않을 만큼만 민다. 레이아웃을 잴 수
 * 없으면(테스트 환경) 예전처럼 끝으로 간다. */
function revealComment(list: HTMLElement, id: string, scroll: boolean): void {
  const el = list.querySelector(`[data-comment-item="${id}"]`) as HTMLElement | null;
  if (!el) return;
  if (!scroll) {
    // 카드 상세 모달은 바깥이 스크롤한다 — 어디가 스크롤 상자인지 모르므로 맡긴다.
    const tall = el.offsetHeight > (typeof window !== 'undefined' ? window.innerHeight : 0);
    el.scrollIntoView?.({ block: tall ? 'start' : 'nearest' });
    return;
  }
  const view = list.clientHeight;
  if (!view) {
    list.scrollTop = list.scrollHeight;
    return;
  }
  const r = el.getBoundingClientRect();
  const lr = list.getBoundingClientRect();
  const top = r.top - lr.top + list.scrollTop;
  const PAD = 8;
  const target = r.height + PAD * 2 > view ? top - PAD : top + r.height + PAD - view;
  list.scrollTop = Math.max(0, Math.min(target, Math.max(0, list.scrollHeight - view)));
}

export function CommentThreads({ controller, nodeId, scroll = false, thread = false }: { controller: CommentHost; nodeId: string; scroll?: boolean; thread?: boolean }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 방금 **내가** 남긴 글로 목록을 옮기기 위한 표시(요청 ②) — 제출 **직전**의 id
   * 집합이다. 목록이 갱신되면 그중에 없던 글이 내가 쓴 것이므로, 그 글을 찾아
   * 그리로 옮긴다. 내 제출에만 세운다 — 남의 글이 실시간으로 도착할 때마다 읽던
   * 자리가 튀면 안 된다.
   *
   * 예전에는 "목록 끝으로"였는데 두 가지가 어긋났다(제보): 답글은 스레드 안에
   * 끼어들어 **끝이 아니고**, 아주 긴 글은 끝으로 가면 그 글의 **꼬리**가 보인다. */
  const focusAfterRef = useRef<Set<string> | null>(null);
  /** 멘션 자동완성 대상 — 이 문서의 참가자(소유자 + 초대받은 사람). */
  const participants = useCommentParticipants(controller.docId);

  // 대상이 바뀌면 열려 있던 답글 입력은 그 대상의 것이므로 접는다.
  useEffect(() => {
    setReplyTo(null);
    setError(null);
  }, [nodeId]);

  useLayoutEffect(() => {
    const before = focusAfterRef.current;
    if (!before) return;
    const list = listRef.current;
    if (!list) return;
    const added = controller.comments.find((c) => c.nodeId === nodeId && !before.has(c.id));
    if (!added) return; // 아직 목록이 갱신되지 않았다 — 다음 렌더에서 다시 본다
    focusAfterRef.current = null;
    // 자리는 **두 번** 잡는다: 이 커밋에서 한 번, 다음 프레임에 한 번. 패널은 자기
    // 높이를 재서 상태로 올리므로(위 `panelH`) 이 시점의 목록 높이가 최종이 아니고,
    // 그러면 `scrollTop`이 옛 높이로 잘려 끝에 못 닿는다.
    const run = (): void => revealComment(list, added.id, scroll);
    run();
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : null;
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [controller.comments, nodeId, scroll]);

  const forNode = controller.comments.filter((c) => c.nodeId === nodeId);
  const threads: Thread[] = forNode
    .filter((c) => !c.parentId)
    .map((root) => ({ root, replies: forNode.filter((r) => r.parentId === root.id) }));
  // 아래 입력은 **언제나 새 스레드 글**이다(요청 ②) — 예전에는 핀에서 이 칸이
  // 첫 글의 답글로 들어가, 답글 버튼으로 남긴 것과 구별되지 않았다. 답글은
  // 각 글의 `답글` 버튼이 여는 입력칸만 맡는다(그쪽 문구는 그대로 '답글 남기기').

  /** 제출 직전의 id 집합을 남긴다 — 목록이 갱신된 뒤 "없던 글"이 곧 내가 쓴 글이다.
   * **보내기 전에** 세워야 한다: `addComment`가 돌아올 때는 목록이 이미 갱신돼 있어
   * 그 뒤에 세우면 효과가 다시 돌 일이 없다. */
  const markMine = (): void => {
    focusAfterRef.current = new Set(controller.comments.filter((c) => c.nodeId === nodeId).map((c) => c.id));
  };
  const submitThread = async (body: string, mentions: CommentMention[]) => {
    markMine();
    const res = await controller.addComment(nodeId, body, mentions.length ? { mentions } : undefined);
    setError(res.error ?? null);
    if (res.error) focusAfterRef.current = null;
    return !res.error;
  };
  const submitReply = async (parentId: string, body: string, mentions: CommentMention[]) => {
    // 답글도 같은 길을 쓴다(제보) — 예전에는 답글에 아예 표시를 세우지 않아, 길게
    // 쓴 답글이 화면 밖에 남았다. 답글은 스레드 안에 끼어드니 "끝으로"로는 못 찾는다.
    markMine();
    const res = await controller.addComment(nodeId, body, { parentId, ...(mentions.length ? { mentions } : {}) });
    setError(res.error ?? null);
    if (res.error) focusAfterRef.current = null;
    else setReplyTo(null);
    return !res.error;
  };

  return (
    <>
      <div
        ref={listRef}
        className={scroll ? 'mf-cmt-scroll' : undefined}
        style={scroll ? { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 12px 10px' } : { padding: '2px 0 6px' }}
        data-comment-list
      >
        {controller.commentsLoading && !threads.length ? (
          <div style={{ fontSize: 12, color: th.subtext, padding: '12px 0' }}>불러오는 중…</div>
        ) : threads.length ? (
          <>
            {/* 해결 표시는 걷어냈다(요청) — 논의를 접는 대신 **좋아요**로 공감을 남긴다.
                그래서 스레드는 하나의 목록이고, 배지도 전부를 센다. */}
            {threads.map((t) => (
              <ThreadView
                key={t.root.id}
                thread={t}
                controller={controller}
                isMobile={isMobile}
                participants={participants}
                pinMode={thread}
                replyOpen={replyTo === t.root.id}
                onReplyToggle={() => setReplyTo((prev) => (prev === t.root.id ? null : t.root.id))}
                onReplySubmit={(body, mentions) => submitReply(t.root.id, body, mentions)}
              />
            ))}
          </>
        ) : (
          <div style={{ fontSize: 12, color: th.subtext, lineHeight: 1.6, padding: '12px 0' }}>{thread ? '아직 남긴 글이 없어요. 의견을 남겨 보세요.' : '아직 댓글이 없어요. 의견을 남겨 보세요.'}</div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${th.border}`, padding: scroll ? (isMobile ? '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))' : '10px 12px') : '10px 0 0' }}>
        {error && <div style={{ fontSize: 11.5, color: '#d92626', marginBottom: 6 }}>{error}</div>}
        <CommentComposer
          controller={controller}
          isMobile={isMobile}
          participants={participants}
          placeholder={thread ? '스레드 남기기 · @로 멘션' : '댓글 남기기 · @로 멘션'}
          inputLabel={thread ? '스레드 입력' : '댓글 입력'}
          submitLabel="남기기"
          autoFocus={false}
          footer={{ hint: true, avatar: controller.myName, avatarSrc: controller.myAvatar }}
          onSubmit={(body, mentions) => submitThread(body, mentions)}
        />
      </div>
    </>
  );
}

/**
 * 멘션 자동완성 후보 — 이 문서의 참가자(소유자 + 초대받은 사람)에서 **나 자신만 뺀다**
 * (제보: "멘션에 나도 보여서 이상하다" — 멘션은 남을 부르는 도구고, 알림 트리거(0022)도
 * 자기 멘션은 알리지 않으므로 골라 봐야 아무 일도 없다).
 *
 * 스레드 목록과 초안 말풍선(`CommentDraftBubble`)이 같은 훅을 쓴다 — 후보가 두 곳에서
 * 달라질 이유가 없다. 조회는 한 번뿐이다(참가자는 세션 중 거의 바뀌지 않는다).
 */
export function useCommentParticipants(docId: string, enabled = true): ShareParticipant[] {
  const shareStore = useShareStore();
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);
  const myEmail = (useAuthUser()?.email ?? '').trim().toLowerCase();
  useEffect(() => {
    // 댓글을 쓰는 화면이 떠 있을 때만 묻는다 — 초안 말풍선은 항상 마운트돼 있고
    // 대부분의 시간에는 접혀 있다(왕복을 그냥 태울 이유가 없다).
    if (!enabled) return;
    let alive = true;
    void shareStore.listParticipants(docId).then((rows) => {
      if (alive && rows) setParticipants(rows.filter((p) => p.email.trim().toLowerCase() !== myEmail));
    });
    return () => {
      alive = false;
    };
  }, [docId, shareStore, myEmail, enabled]);
  return participants;
}

/** 머리의 ⋯ — 지금은 "스레드 삭제" 하나다(각 글의 '삭제'는 그 글만 지운다).
 * 항목이 하나뿐이라도 메뉴로 두는 이유: 파괴적 동작이 머리에 버튼으로 상시 노출되면
 * 닫기(✕) 옆에서 잘못 눌리기 쉽다. */
function ThreadMenu({ th, isMobile, onDelete }: { th: Theme; isMobile: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  // Esc로도 닫힌다 — 열어 둔 메뉴가 뒤의 버튼(해결·닫기)을 삼키면 갇힌 것처럼 느껴진다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="mf-ed-btn"
        data-thread-menu
        aria-label="스레드 메뉴"
        aria-expanded={open}
        title="더 보기"
        onClick={() => setOpen((v) => !v)}
        style={{ width: isMobile ? 40 : 26, height: isMobile ? 40 : 26, border: 'none', background: 'transparent', color: th.subtext, borderRadius: 7, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit' }}
      >
        ⋯
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, minWidth: 148, background: th.panel, border: `1px solid ${th.border}`, borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)', padding: 5, zIndex: 2 }}
          >
            <button
              type="button"
              className="mf-ed-btn mf-ed-danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: th.text, fontFamily: 'inherit', fontSize: 12.5, padding: isMobile ? '11px 10px' : '7px 10px', borderRadius: 7, cursor: 'pointer' }}
            >
              스레드 삭제
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 스레드 하나 ──────────────────────────────────────────────────────────────

function ThreadView({
  thread,
  controller,
  isMobile,
  participants,
  dimmed = false,
  pinMode = false,
  replyOpen,
  onReplyToggle,
  onReplySubmit,
}: {
  thread: Thread;
  controller: CommentHost;
  isMobile: boolean;
  participants: ShareParticipant[];
  dimmed?: boolean;
  /** 캔버스 핀의 논의인가 — 화면 문구가 '스레드'/'댓글'로 갈린다(용어 규칙). */
  pinMode?: boolean;
  replyOpen: boolean;
  /** null = 답글 받기 종료(해결된 스레드 — 논의가 끝난 곳에 새 답글을 받지 않는다). */
  onReplyToggle: (() => void) | null;
  onReplySubmit: (body: string, mentions: CommentMention[]) => Promise<boolean>;
}) {
  const th = controller.uiTheme;
  const { root, replies } = thread;
  // 작성자 아바타 — **이미 받아 둔 참가자 목록**에서 찾는다(추가 왕복 없음).
  // 이름은 스냅샷(0020)이지만 사진은 조인이라, 사진을 바꾸면 옛 글에도 반영된다.
  const avatars = useMemo(() => participantAvatars(participants), [participants]);
  // 내 글은 내 사진을 그대로 쓴다 — 참가자 목록은 **나를 빼고** 온다(멘션 후보용,
  // `useCommentParticipants`). 남의 글은 그 목록에서 계정 id로 찾는다.
  const avatarOf = (c: DocComment): string | null => (c.mine ? controller.myAvatar : c.authorId ? (avatars.byUserId[c.authorId] ?? null) : null);
  // 답글 칸이 열리면 **그 자리로 목록을 옮긴다**(요청 ①) — 스레드가 길어 스크롤이
  // 생기면 칸이 아래에 반쯤 가려 어디에 쓰는지 보이지 않았다. `block: 'nearest'`라
  // 이미 다 보이면 아무것도 움직이지 않는다(필요한 만큼만 민다).
  const replyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!replyOpen) return;
    replyRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [replyOpen]);

  return (
    <section data-comment-thread={root.id} style={{ padding: '9px 0', borderBottom: `1px solid ${th.border}`, opacity: dimmed ? 0.66 : 1 }}>
      <CommentRow comment={root} controller={controller} isMobile={isMobile} deletable pinMode={pinMode} deleteTitle={replies.length ? '스레드 삭제 (답글 포함)' : '삭제'} actions={onReplyToggle ? { onReply: onReplyToggle, replyOpen } : { replyOpen: false }} avatarSrc={avatarOf(root)} />
      {replies.map((r) => (
        <div key={r.id} style={{ marginLeft: 34, paddingLeft: 0 }}>
          <CommentRow comment={r} controller={controller} isMobile={isMobile} deletable pinMode={pinMode} deleteTitle="삭제" actions={{ replyOpen: false }} avatarSrc={avatarOf(r)} />
        </div>
      ))}
      {replyOpen && (
        <div ref={replyRef} data-reply-composer style={{ marginLeft: 14, paddingLeft: 9, borderLeft: `2px solid ${th.border}`, marginTop: 6 }}>
          <CommentComposer
            controller={controller}
            isMobile={isMobile}
            participants={participants}
            placeholder="답글 남기기 · @로 멘션"
            submitLabel="답글"
            autoFocus
            compact
            onSubmit={onReplySubmit}
          />
        </div>
      )}
    </section>
  );
}

// ── 댓글 한 줄 ───────────────────────────────────────────────────────────────

function CommentRow({
  comment: c,
  controller,
  isMobile,
  deletable,
  deleteTitle,
  pinMode = false,
  actions,
  avatarSrc,
}: {
  comment: DocComment;
  controller: CommentHost;
  isMobile: boolean;
  deletable: boolean;
  deleteTitle: string;
  /** 캔버스 핀의 글인가 — 접근 이름이 '스레드 글 삭제'/'댓글 삭제'로 갈린다. */
  pinMode?: boolean;
  /** 아래 동작 줄 — 답글은 스레드 뿌리에만, 좋아요는 모든 줄에. */
  actions: { onReply?: () => void; replyOpen: boolean };
  /** 작성자의 지금 프로필 이미지(0031) — 없으면 이름 첫 글자. */
  avatarSrc?: string | null;
}) {
  const th = controller.uiTheme;
  const name = c.authorName || '알 수 없음';
  const pill: CSSProperties = {
    height: isMobile ? 30 : 24,
    padding: '0 9px',
    borderRadius: 999,
    border: `1px solid ${th.border}`,
    background: th.panel,
    color: th.subtext,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  };
  return (
    <article data-comment-item={c.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 0' }}>
      {/* 작성자 얼굴 — 핀에 박히는 얼굴과 **같은 색 규칙**(commentPinShape). */}
      <span data-comment-avatar style={{ display: 'inline-flex' }}>
        <Avatar name={name} size={26} src={avatarSrc} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: th.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span title={formatFullDateTime(c.createdAt)} style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: th.subtext, flex: '1 1 auto' }}>
            {formatLastEdited(c.createdAt)}
          </span>
          {deletable && c.mine && (
            <button
              type="button"
              className="mf-ed-btn"
              aria-label={pinMode ? '스레드 글 삭제' : '댓글 삭제'}
              title={deleteTitle}
              onClick={() => void controller.removeComment(c.id)}
              style={{ border: 'none', background: 'transparent', color: th.subtext, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: isMobile ? '8px 6px' : '2px 4px', borderRadius: 6, flexShrink: 0 }}
            >
              삭제
            </button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: th.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderBody(c.body, c.mentions, th.accent)}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
          {actions.onReply && (
            <button type="button" className="mf-ed-btn" data-reply-toggle aria-expanded={actions.replyOpen} onClick={actions.onReply} style={{ ...pill, fontWeight: 700 }}>
              답글
            </button>
          )}
          {/* 좋아요(요청: 해결 대신) — 누른 표는 강조색으로. 수는 등폭으로 읽는다. */}
          <button
            type="button"
            className="mf-ed-btn"
            data-like-button
            aria-pressed={c.likedByMe}
            aria-label={c.likedByMe ? '좋아요 취소' : '좋아요'}
            title={c.likedByMe ? '좋아요 취소' : '좋아요'}
            onClick={() => void controller.likeComment(c.id, !c.likedByMe)}
            style={{ ...pill, borderColor: c.likedByMe ? hexA(th.accent, 0.45) : th.border, background: c.likedByMe ? hexA(th.accent, 0.08) : th.panel, color: c.likedByMe ? th.accent : th.subtext }}
          >
            <ThumbGlyph size={12} filled={c.likedByMe} />
            <span style={{ fontFamily: MONO_FONT, fontSize: 10.5 }}>{c.likes}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

/** 좋아요 글리프 — 디자인 원본의 엄지. */
function ThumbGlyph({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
      <path d="M7 11l4.5-7.5A2 2 0 0 1 15 4.6L14 9h5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17.6 19H7" />
    </svg>
  );
}

/** 본문을 멘션/평문 구간으로 가른다(순수) — 렌더된 댓글과 작성 중 오버레이가
 * **같은 규칙**을 쓴다(멘션 목록에 있는 "@이름"만, 긴 이름 우선 매칭). */
export function splitMentions(body: string, names: string[]): Array<{ t: string; m: boolean }> {
  const uniq = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniq.length || !body) return [{ t: body, m: false }];
  const re = new RegExp(`@(${uniq.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const out: Array<{ t: string; m: boolean }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    if (match.index > last) out.push({ t: body.slice(last, match.index), m: false });
    out.push({ t: match[0], m: true });
    last = match.index + match[0].length;
  }
  if (last < body.length) out.push({ t: body.slice(last), m: false });
  return out;
}

/** 본문 렌더 — 멘션된 이름의 "@이름"만 강조색으로. 멘션 목록에 없는 @글자는 평문. */
function renderBody(body: string, mentions: CommentMention[], accent: string): ReactNode {
  const segs = splitMentions(
    body,
    mentions.map((m) => m.name),
  );
  if (segs.every((s) => !s.m)) return body;
  return segs.map((s, i) =>
    s.m ? (
      <span key={i} data-mention style={{ color: accent, fontWeight: 700 }}>
        {s.t}
      </span>
    ) : (
      s.t
    ),
  );
}

// ── 입력창(멘션 자동완성 포함) — 새 스레드와 답글이 같은 것을 쓴다 ─────────────

export function participantName(p: ShareParticipant): string {
  return (p.displayName || '').trim() || p.email.split('@')[0] || p.email;
}

/** 캐럿 앞의 `@토큰`(입력 중인 멘션). 없으면 null. */
export function mentionTokenAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

export function CommentComposer({
  controller,
  isMobile,
  participants,
  placeholder,
  inputLabel,
  submitLabel,
  autoFocus,
  compact = false,
  footer,
  onCancel,
  onSubmit,
}: {
  controller: CommentHost;
  isMobile: boolean;
  participants: ShareParticipant[];
  placeholder: string;
  /** 입력창의 접근 이름 — 없으면 제출 라벨에서 고른다(칸반의 '댓글 입력'). */
  inputLabel?: string;
  submitLabel: string;
  autoFocus: boolean;
  compact?: boolean;
  /** 시안 ①의 아래 줄 — 내 얼굴 + "Enter로 등록". 없으면 버튼만. */
  footer?: { hint?: boolean; avatar?: string; avatarSrc?: string | null };
  /** 있으면 [취소] 버튼이 함께 선다(시안 ②의 초안 말풍선). */
  onCancel?: () => void;
  onSubmit: (body: string, mentions: CommentMention[]) => Promise<boolean>;
}) {
  const th = controller.uiTheme;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  /** 지금 캐럿에 걸린 @토큰(자동완성 드롭다운의 근거). */
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  /** 드롭다운의 활성(키보드 선택) 행 — 캔버스 멘션 리스트와 같은 조작(↑/↓ 순환,
   * Enter/Tab 선택, hover 동기). 질의가 바뀌면 후보 목록이 갈리므로 첫 행으로 리셋. */
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    setActiveIdx(0);
  }, [token?.start, token?.query]);
  /** 이 입력에서 골라 넣은 멘션들 — 제출 시 본문에 "@이름"이 남아 있는 것만 싣는다
   * (골랐다가 글자를 지웠으면 멘션도 아니다). */
  const picked = useRef<Map<string, CommentMention>>(new Map());
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  /** 작성 중 멘션 강조 오버레이(요청) — textarea는 글자를 스스로 색칠할 수 없어
   * 글자를 투명하게 하고(캐럿은 caretColor로 남긴다) **같은 메트릭의 백드롭**이
   * 전체 텍스트를 그리며 멘션 구간만 강조한다. 강조는 색+연한 배경뿐, 굵게는
   * 쓰지 않는다 — 굵게는 글리프 폭을 바꿔 오버레이와 캐럿이 어긋난다. */
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const syncOverlayScroll = () => {
    if (overlayRef.current && boxRef.current) overlayRef.current.scrollTop = boxRef.current.scrollTop;
  };

  // 마운트 시 한 번만 — 모바일에서는 포커스가 곧 키보드라, 읽으러 연 사람의
  // 화면 절반을 빼앗으므로 데스크톱만.
  const focusOnMount = useRef(autoFocus && !isMobile);
  useEffect(() => {
    if (focusOnMount.current) boxRef.current?.focus();
  }, []);

  /** 멘션 선택 후 복원할 캐럿 위치. rAF가 아니라 draft 커밋 직후(effect)에 적용해야
   * 한다 — 다음 프레임을 기다리는 사이 타이핑이 끼어들면 그 글자가 캐럿이 아니라
   * 텍스트 **끝**에 붙는다(실브라우저에서 재현된 레이스). */
  const pendingCaret = useRef<number | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (pendingCaret.current != null && el) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    // 캐럿 이동·자동 스크롤 뒤 백드롭을 따라 붙인다(onScroll이 대부분 잡지만,
    // 렌더 직후 한 번 더 맞춰 어긋난 프레임이 남지 않게).
    syncOverlayScroll();
  }, [draft]);

  const refreshToken = (el: HTMLTextAreaElement) => {
    setToken(mentionTokenAt(el.value, el.selectionStart ?? el.value.length));
  };

  const candidates = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    return participants
      .filter((p) => {
        const name = participantName(p).toLowerCase();
        return !q || name.includes(q) || p.email.toLowerCase().includes(q);
      })
      .slice(0, 6);
  }, [token, participants]);

  const pick = (p: ShareParticipant) => {
    const el = boxRef.current;
    if (!el || !token) return;
    const name = participantName(p);
    const caret = el.selectionStart ?? el.value.length;
    const next = `${el.value.slice(0, token.start)}@${name} ${el.value.slice(caret)}`;
    picked.current.set(name, { email: p.email, name });
    pendingCaret.current = token.start + name.length + 2; // "@이름 " 바로 뒤
    setDraft(next);
    setToken(null);
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    const mentions = [...picked.current.values()].filter((m) => body.includes(`@${m.name}`));
    setBusy(true);
    const ok = await onSubmit(body, mentions);
    setBusy(false);
    if (ok) {
      setDraft('');
      picked.current.clear();
      setToken(null);
    }
  };

  // 폰 키패드에는 Shift가 없다 — 그때만 Enter가 줄바꿈으로 남는다.
  const touch = useIsTouchDevice();
  const kbOpen = useSoftKeyboardOpen();
  const softKeyboard = touch || kbOpen;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 드롭다운이 떠 있을 때: ↑/↓ = 활성 행 이동(순환), Enter/Tab = 활성 후보 선택.
    // IME 조합 중 키는 건드리지 않는다 — 조합 확정 Enter가 후보 선택으로 새면 안 된다.
    if (token && candidates.length && !e.nativeEvent.isComposing) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault(); // 기본 동작(캐럿 줄 이동)이 토큰을 흔들지 않게
        const n = candidates.length;
        setActiveIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        pick(candidates[Math.min(activeIdx, candidates.length - 1)]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (token) {
        e.preventDefault();
        setToken(null);
        return;
      }
      if (!controller.closeComments) return; // 모달 안이면 그 Escape는 모달의 것이다
      e.preventDefault();
      controller.closeComments();
      return;
    }
    // **Enter = 등록 / Shift+Enter = 줄바꿈**(요청). 단, 소프트 키보드에는 Shift가
    // 없으므로 폰에서는 예전 그대로 Enter가 줄바꿈이고 등록은 버튼이 맡는다
    // (#333에서 캔버스 편집에 세운 규칙과 같은 판단 — 판정도 같은 훅을 쓴다:
    // "이 기기가 터치인가"가 아니라 "지금 Shift 없는 키보드로 치고 있는가").
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !softKeyboard && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      {token && candidates.length > 0 && (
        <div
          data-mention-list
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 4,
            background: th.panel,
            border: `1px solid ${th.border}`,
            borderRadius: 9,
            boxShadow: '0 6px 22px rgba(0,0,0,.12)',
            overflow: 'hidden',
            zIndex: 5,
          }}
        >
          {candidates.map((p, i) => (
            <button
              key={p.email}
              type="button"
              className="mf-ed-btn"
              data-mention-candidate={p.email}
              data-active={i === activeIdx ? 'true' : undefined}
              // blur가 먼저 돌아 클릭이 무시되지 않게 mousedown에서 처리(서식 툴바와
              // 같은 함정 — 버튼 클릭 전에 입력이 포커스를 잃으면 캐럿·토큰이 사라진다).
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              // hover도 활성 행을 옮긴다 — 마우스가 가리키는 행과 Enter가 고를 행이
              // 달라 보이면 안 된다(캔버스 멘션 리스트와 같은 규칙).
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                width: '100%',
                border: 'none',
                background: i === activeIdx ? th.panel2 : 'transparent',
                fontFamily: 'inherit',
                fontSize: 12,
                color: th.text,
                padding: isMobile ? '11px 10px' : '7px 10px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 700 }}>{participantName(p)}</span>
              <span style={{ color: th.subtext, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
            </button>
          ))}
        </div>
      )}
      {(() => {
        // 오버레이·textarea가 **같은 글자 상자**를 쓴다 — 하나라도 다르면 보이는
        // 글자와 캐럿이 어긋난다.
        const boxFont: CSSProperties = { fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.5, padding: '10px 11px', boxSizing: 'border-box' };
        // 강조 대상 = 골라 넣었고 본문에 아직 살아 있는 멘션(제출 규칙과 동일).
        const liveNames = [...picked.current.values()].filter((m) => draft.includes(`@${m.name}`)).map((m) => m.name);
        const segs = splitMentions(draft, liveNames);
        return (
          <div
            data-composer-box
            style={{
              position: 'relative',
              // 시안 ①: 포커스가 가면 강조색 테두리 + 옅은 링으로 "여기 쓰는 중"을 말한다.
              border: `1px solid ${focused ? th.accent : th.border}`,
              boxShadow: focused ? `0 0 0 3px ${hexA(th.accent, 0.14)}` : 'none',
              borderRadius: 12,
              background: focused ? th.panel : th.panel2,
              overflow: 'hidden',
              transition: 'border-color .12s ease, box-shadow .12s ease',
            }}
          >
            <div ref={overlayRef} aria-hidden data-mention-overlay style={{ ...boxFont, position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: th.text }}>
              {segs.map((s, i) =>
                s.m ? (
                  <span key={i} data-mention-draft style={{ color: th.accent, background: hexA(th.accent, 0.14), borderRadius: 4 }}>
                    {s.t}
                  </span>
                ) : (
                  <span key={i}>{s.t}</span>
                ),
              )}
              {/* 후행 빈 줄도 스크롤 높이에 세도록 개행 하나를 더 둔다(백드롭 관례) */}
              {'\n'}
            </div>
            <textarea
              ref={boxRef}
              className="mf-cmt-input"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                refreshToken(e.target);
              }}
              onKeyUp={(e) => refreshToken(e.currentTarget)}
              onClick={(e) => refreshToken(e.currentTarget)}
              onKeyDown={onKeyDown}
              onScroll={syncOverlayScroll}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={compact ? 1 : 2}
              maxLength={2000}
              placeholder={placeholder}
              aria-label={inputLabel ?? (submitLabel === '답글' ? '답글 입력' : '댓글 입력')}
              style={
                {
                  ...boxFont,
                  position: 'relative',
                  display: 'block',
                  width: '100%',
                  resize: 'none',
                  border: 'none',
                  background: 'transparent',
                  // 글자는 백드롭이 그린다 — 여기 글자가 보이면 이중으로 겹친다.
                  color: 'transparent',
                  caretColor: th.text,
                  outline: 'none',
                  '--mf-cmt-ph': th.subtext,
                } as CSSProperties
              }
            />
          </div>
        );
      })()}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: compact ? 6 : 8 }}>
        {footer?.avatar && <Avatar name={footer.avatar} size={22} src={footer.avatarSrc} />}
        {footer?.hint && (
          <span style={{ fontFamily: MONO_FONT, fontSize: 10.5, color: th.subtext }}>{softKeyboard ? '등록 버튼으로 남겨요' : 'Enter로 등록'}</span>
        )}
        <span style={{ flex: '1 1 auto' }} />
        {onCancel && (
          <button
            type="button"
            className="mf-ed-btn"
            onClick={onCancel}
            style={{ border: 'none', background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: isMobile ? '11px 12px' : '7px 10px', borderRadius: 8, cursor: 'pointer' }}
          >
            취소
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || busy}
          title={softKeyboard ? '등록' : 'Enter'}
          style={{
            border: 'none',
            borderRadius: 8,
            padding: isMobile ? '11px 18px' : compact ? '5px 11px' : '7px 14px',
            minHeight: isMobile ? 44 : undefined,
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: !draft.trim() || busy ? 'default' : 'pointer',
            background: !draft.trim() || busy ? hexA(th.accent, 0.35) : th.accent,
            color: !draft.trim() || busy ? hexA(th.accentInk, 0.85) : th.accentInk,
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/** 체크 원 — 해결 표시. */

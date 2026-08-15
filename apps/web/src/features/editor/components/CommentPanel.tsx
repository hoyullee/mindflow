// 주제(노드)에 붙는 댓글 패널 — 스레드(답글)·멘션·해결 표시(0021).
//
// 자리: 데스크톱은 **오른쪽**(속성 패널이 왼쪽이라 둘이 함께 떠도 부딪히지 않는다.
// 위로는 접속자 아바타, 아래로는 미니맵/줌 묶음을 피한다), 모바일은 바텀 시트.
//
// 대상은 "지금 고른 주제" 하나다 — 주제를 바꾸면 패널이 따라간다(useEditorState).
// 문서 전체 댓글은 루트 주제의 댓글로 대신한다(0020의 설계 메모 참고).
//
// 스레드 모델: 최상위 댓글이 스레드 뿌리, 답글은 단층(대댓글 없음 — 0021 트리거).
// 해결 표시는 뿌리에만 있고, 해결된 스레드는 접힌 구획으로 내려간다 — 남은 논의만
// 눈에 들어오게(배지도 미해결 스레드만 센다).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { ROOT_ID } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import type { CommentMention, DocComment, ShareParticipant } from '../../../adapters/ports';
import { panelTitleLine } from './panel/panelPrimitives';
import { hexA } from '../theme';
import { CARD_SHADOW, glassCard } from '../chrome';
import { CommentIcon } from './ToolbarMenus';
import { formatFullDateTime, formatLastEdited } from '../../home/timeFormat';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { useShareStore } from '../../../adapters/BackendContext';
import { useAuthUser } from '../../../adapters/useAuthUser';

interface Thread {
  root: DocComment;
  replies: DocComment[];
}

/** 댓글 대상의 종류가 드러나는 한 줄 제목(순수) — 주제는 기존처럼 첫 줄만, 다른
 * 객체는 종류를 접두한다("메모 · …", "연결선", "영역 · …"). 없으면 null. */
export function commentTargetLabel(doc: EditorController['doc'], id: string): string | null {
  // 칸반 — 대상은 카드다. 문서 전체 댓글은 마인드맵과 같은 자리(ROOT_ID)를 쓰는데,
  // 칸반에는 루트 주제가 없으므로 "보드 전체"라고 말한다.
  if (doc.kind === 'kanban') {
    const c = (doc.cards ?? []).find((x) => x.id === id);
    if (c) return `카드 · ${panelTitleLine(c.text) || '카드'}`;
    if (id === ROOT_ID) return '보드 전체';
    return null;
  }
  const n = doc.nodes[id];
  if (n) return panelTitleLine(n.text);
  const f = doc.floats.find((x) => x.id === id);
  if (f) return f.img ? '이미지' : `메모 · ${panelTitleLine(f.text) || '메모'}`;
  const l = doc.lines.find((x) => x.id === id);
  if (l) return l.label && l.label.trim() ? `연결선 · ${l.label.trim()}` : '연결선';
  const z = doc.zones.find((x) => x.id === id);
  if (z) return `영역 · ${z.label || '영역'}`;
  return null;
}

export function CommentPanel({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const nodeId = controller.commentsNodeId;
  const open = controller.commentsOpen;

  if (!open) return null;

  // 대상이 지워져도 댓글은 남는다(0020) — 대상이 사라졌음을 그대로 말해 준다.
  // 댓글이 모든 객체로 확장되면서(요청) 대상 종류를 제목이 말해 준다.
  const title = commentTargetLabel(controller.doc, nodeId) ?? '사라진 대상';

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
        right: 16,
        top: 80,
        // 디자인 원본의 댓글 패널(326) — 유리질 카드 + 더 둥근 모서리.
        width: 326,
        // 아래로는 미니맵/줌 묶음(우하단)을 피한다 — 미니맵이 접혀 있으면 더 길게.
        maxHeight: `calc(100% - ${80 + (controller.showMinimap ? 190 : 68)}px)`,
        ...glassCard(th, 0.97),
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        zIndex: 16,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      };

  return (
    <aside style={wrap} data-comment-panel aria-label="댓글">
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderBottom: `1px solid ${th.border}`, background: `linear-gradient(180deg,${th.panel},${th.panel2})` }}>
        {/* 디자인 원본: 아이콘을 강조색 틴트 칩에 담아 머리를 또렷하게. */}
        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, background: hexA(th.accent, 0.1), color: th.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <CommentIcon size={15} />
        </span>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.01em', color: th.text }}>댓글</div>
          <div title={title} style={{ fontSize: 11.5, color: th.subtext, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
        </div>
        <button
          type="button"
          className="mf-ed-btn"
          onClick={controller.closeComments}
          aria-label="댓글 닫기"
          title="닫기"
          style={{ width: isMobile ? 44 : 26, height: isMobile ? 44 : 26, border: 'none', background: 'transparent', color: th.subtext, borderRadius: 7, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit' }}
        >
          ✕
        </button>
      </header>
      <CommentThreads controller={controller} nodeId={nodeId} scroll />
    </aside>
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
export function CommentThreads({ controller, nodeId, scroll = false }: { controller: EditorController; nodeId: string; scroll?: boolean }) {
  const th = controller.uiTheme;
  const isMobile = useIsMobile();
  const shareStore = useShareStore();
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 멘션 자동완성 대상 — 이 문서의 참가자(소유자 + 초대받은 사람). */
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);

  // 대상이 바뀌면 열려 있던 답글 입력은 그 대상의 것이므로 접는다.
  useEffect(() => {
    setReplyTo(null);
    setError(null);
  }, [nodeId]);

  // 멘션 후보는 한 번만 — 참가자 목록은 세션 중 거의 바뀌지 않는다.
  // **나 자신은 뺀다**(제보: "멘션에 나도 보여서 이상하다") — 멘션은 남을 부르는
  // 도구고, 알림 트리거(0022)도 자기 멘션은 알리지 않으므로 골라 봐야 아무 일도 없다.
  const myEmail = (useAuthUser()?.email ?? '').trim().toLowerCase();
  useEffect(() => {
    let alive = true;
    void shareStore.listParticipants(controller.docId).then((rows) => {
      if (alive && rows) setParticipants(rows.filter((p) => p.email.trim().toLowerCase() !== myEmail));
    });
    return () => {
      alive = false;
    };
  }, [controller.docId, shareStore, myEmail]);

  const forNode = controller.comments.filter((c) => c.nodeId === nodeId);
  const threads: Thread[] = forNode
    .filter((c) => !c.parentId)
    .map((root) => ({ root, replies: forNode.filter((r) => r.parentId === root.id) }));
  const unresolved = threads.filter((t) => !t.root.resolved);
  const resolved = threads.filter((t) => t.root.resolved);

  const submitThread = async (body: string, mentions: CommentMention[]) => {
    const res = await controller.addComment(nodeId, body, mentions.length ? { mentions } : undefined);
    setError(res.error ?? null);
    return !res.error;
  };
  const submitReply = async (parentId: string, body: string, mentions: CommentMention[]) => {
    const res = await controller.addComment(nodeId, body, { parentId, ...(mentions.length ? { mentions } : {}) });
    setError(res.error ?? null);
    if (!res.error) setReplyTo(null);
    return !res.error;
  };

  return (
    <>
      <div style={scroll ? { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 12px 10px' } : { padding: '2px 0 6px' }} data-comment-list>
        {controller.commentsLoading && !threads.length ? (
          <div style={{ fontSize: 12, color: th.subtext, padding: '12px 0' }}>불러오는 중…</div>
        ) : threads.length ? (
          <>
            {unresolved.map((t) => (
              <ThreadView
                key={t.root.id}
                thread={t}
                controller={controller}
                isMobile={isMobile}
                participants={participants}
                replyOpen={replyTo === t.root.id}
                onReplyToggle={() => setReplyTo((prev) => (prev === t.root.id ? null : t.root.id))}
                onReplySubmit={(body, mentions) => submitReply(t.root.id, body, mentions)}
              />
            ))}
            {!unresolved.length && <div style={{ fontSize: 12, color: th.subtext, padding: '12px 0' }}>남은 논의가 없어요 — 모두 해결됐어요.</div>}
            {resolved.length > 0 && (
              <>
                <button
                  type="button"
                  data-resolved-toggle
                  onClick={() => setShowResolved((v) => !v)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    color: th.subtext,
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: isMobile ? '12px 0' : '9px 0 5px',
                    cursor: 'pointer',
                  }}
                >
                  {showResolved ? '▾' : '▸'} 해결된 스레드 {resolved.length}개
                </button>
                {showResolved &&
                  resolved.map((t) => (
                    <ThreadView
                      key={t.root.id}
                      thread={t}
                      controller={controller}
                      isMobile={isMobile}
                      participants={participants}
                      dimmed
                      replyOpen={false}
                      onReplyToggle={null}
                      onReplySubmit={() => Promise.resolve(false)}
                    />
                  ))}
              </>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: th.subtext, lineHeight: 1.6, padding: '12px 0' }}>아직 댓글이 없어요. 의견을 남겨 보세요.</div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${th.border}`, padding: scroll ? (isMobile ? '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))' : '10px 12px') : '10px 0 0' }}>
        {error && <div style={{ fontSize: 11.5, color: '#d92626', marginBottom: 6 }}>{error}</div>}
        <CommentComposer
          controller={controller}
          isMobile={isMobile}
          participants={participants}
          placeholder="댓글 남기기 (@로 멘션)"
          submitLabel="남기기"
          autoFocus={false}
          onSubmit={submitThread}
        />
      </div>
    </>
  );
}

// ── 스레드 하나 ──────────────────────────────────────────────────────────────

function ThreadView({
  thread,
  controller,
  isMobile,
  participants,
  dimmed = false,
  replyOpen,
  onReplyToggle,
  onReplySubmit,
}: {
  thread: Thread;
  controller: EditorController;
  isMobile: boolean;
  participants: ShareParticipant[];
  dimmed?: boolean;
  replyOpen: boolean;
  /** null = 답글 받기 종료(해결된 스레드 — 논의가 끝난 곳에 새 답글을 받지 않는다). */
  onReplyToggle: (() => void) | null;
  onReplySubmit: (body: string, mentions: CommentMention[]) => Promise<boolean>;
}) {
  const th = controller.uiTheme;
  const { root, replies } = thread;
  const linkBtn: CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: th.subtext,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: isMobile ? '8px 6px' : '2px 4px',
    borderRadius: 6,
  };
  return (
    <section data-comment-thread={root.id} style={{ padding: '9px 0', borderBottom: `1px solid ${th.border}`, opacity: dimmed ? 0.66 : 1 }}>
      {root.resolved && (
        <div data-resolved-tag style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: th.subtext, marginBottom: 4 }}>
          <ResolveGlyph size={12} color={th.accent} filled />
          해결됨{root.resolvedByName ? ` · ${root.resolvedByName}` : ''}
          <button type="button" className="mf-ed-btn" style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => void controller.resolveComment(root.id, false)}>
            다시 열기
          </button>
        </div>
      )}
      <CommentRow comment={root} controller={controller} isMobile={isMobile} deletable deleteTitle={replies.length ? '스레드 삭제 (답글 포함)' : '삭제'} />
      {replies.map((r) => (
        <div key={r.id} style={{ marginLeft: 14, paddingLeft: 9, borderLeft: `2px solid ${th.border}` }}>
          <CommentRow comment={r} controller={controller} isMobile={isMobile} deletable deleteTitle="삭제" />
        </div>
      ))}
      {!root.resolved && (
        <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
          {onReplyToggle && (
            <button type="button" className="mf-ed-btn" data-reply-toggle style={linkBtn} onClick={onReplyToggle} aria-expanded={replyOpen}>
              답글
            </button>
          )}
          <button
            type="button"
            className="mf-ed-btn"
            data-resolve-button
            style={linkBtn}
            title="해결됨으로 표시"
            onClick={() => void controller.resolveComment(root.id, true)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ResolveGlyph size={12} color="currentColor" /> 해결
            </span>
          </button>
        </div>
      )}
      {replyOpen && (
        <div style={{ marginLeft: 14, paddingLeft: 9, borderLeft: `2px solid ${th.border}`, marginTop: 6 }}>
          <CommentComposer
            controller={controller}
            isMobile={isMobile}
            participants={participants}
            placeholder="답글 남기기 (@로 멘션)"
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

function CommentRow({ comment: c, controller, isMobile, deletable, deleteTitle }: { comment: DocComment; controller: EditorController; isMobile: boolean; deletable: boolean; deleteTitle: string }) {
  const th = controller.uiTheme;
  return (
    <article data-comment-item={c.id} style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: th.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.authorName || '알 수 없음'}</span>
        <span title={formatFullDateTime(c.createdAt)} style={{ fontSize: 11, color: th.subtext, flex: '1 1 auto' }}>
          {formatLastEdited(c.createdAt)}
        </span>
        {deletable && c.mine && (
          <button
            type="button"
            className="mf-ed-btn"
            aria-label="댓글 삭제"
            title={deleteTitle}
            onClick={() => void controller.removeComment(c.id)}
            style={{ border: 'none', background: 'transparent', color: th.subtext, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: isMobile ? '8px 6px' : '2px 4px', borderRadius: 6 }}
          >
            삭제
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: th.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>{renderBody(c.body, c.mentions, th.accent)}</div>
    </article>
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

function CommentComposer({
  controller,
  isMobile,
  participants,
  placeholder,
  submitLabel,
  autoFocus,
  compact = false,
  onSubmit,
}: {
  controller: EditorController;
  isMobile: boolean;
  participants: ShareParticipant[];
  placeholder: string;
  submitLabel: string;
  autoFocus: boolean;
  compact?: boolean;
  onSubmit: (body: string, mentions: CommentMention[]) => Promise<boolean>;
}) {
  const th = controller.uiTheme;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
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
      e.preventDefault();
      controller.closeComments();
      return;
    }
    // Enter는 **줄바꿈**이다 — 소프트 키보드에는 Shift가 없어서 Enter를 등록으로
    // 쓰면 폰에서 여러 줄을 쓸 방법이 사라진다(#333과 같은 이유). 등록은 버튼과
    // Ctrl/⌘+Enter.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
        const boxFont: CSSProperties = { fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.5, padding: '8px 9px', boxSizing: 'border-box' };
        // 강조 대상 = 골라 넣었고 본문에 아직 살아 있는 멘션(제출 규칙과 동일).
        const liveNames = [...picked.current.values()].filter((m) => draft.includes(`@${m.name}`)).map((m) => m.name);
        const segs = splitMentions(draft, liveNames);
        return (
          <div style={{ position: 'relative', border: `1px solid ${th.border}`, borderRadius: 9, background: th.panel2, overflow: 'hidden' }}>
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
              rows={compact ? 1 : 2}
              maxLength={2000}
              placeholder={placeholder}
              aria-label={submitLabel === '답글' ? '답글 입력' : '댓글 입력'}
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: compact ? 5 : 7 }}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || busy}
          title="Ctrl/⌘ + Enter"
          style={{
            border: 'none',
            borderRadius: 8,
            padding: isMobile ? '11px 18px' : compact ? '5px 11px' : '7px 14px',
            minHeight: isMobile ? 44 : undefined,
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: !draft.trim() || busy ? 'default' : 'pointer',
            background: !draft.trim() || busy ? th.border : th.accent,
            color: !draft.trim() || busy ? th.subtext : th.accentInk,
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/** 체크 원 — 해결 표시. */
function ResolveGlyph({ size = 12, color = 'currentColor', filled = false }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx={12} cy={12} r={10} />
      <path d="M8 12.5l2.7 2.7L16 9.5" stroke={filled ? '#fff' : color} fill="none" />
    </svg>
  );
}

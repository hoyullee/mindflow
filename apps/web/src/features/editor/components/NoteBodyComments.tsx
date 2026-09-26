// 우측 댓글 열의 **본문 댓글** 구획(스펙 6-6) — 「본문 댓글 → 페이지 댓글」 순서의 위쪽.
//
// 스레드는 본문의 형광과 한 쌍이다: 카드를 누르면 그 형광으로 가고 둘이 함께 밝아진다.
// 이어 주는 값은 스레드 id 하나뿐이라 컨텍스트가 아니라 문서 이벤트로 부른다
// (`openNoteComment` — 그쪽 주석에 이유가 있다).
//
// 해결한 스레드는 본문에서 형광이 사라지고 이 구획의 **접힌 자리**로 내려간다. 다시 열면
// 형광이 돌아온다 — 표식을 지우지 않고 서버의 `resolved`만 바꾸기 때문이다(6-5가 실서비스
// 권장으로 적은 그 길이다. 프로토타입은 표식을 지워 복구하지 못했다).

import { useMemo, useState, type CSSProperties } from 'react';
import type { DocComment } from '../../../adapters/ports';
import type { EditorController } from '../useEditorState';
import { Avatar } from './commentPinShape';
import { formatLastEdited } from '../../home/timeFormat';
import { hexA } from '../theme';
import { noteCommentSites, openNoteComment, threadIdOfNode, threadNodeId } from '../noteComment';

interface PanelThread {
  id: string;
  quote: string;
  /** 본문에 형광이 남아 있는가 — 글이 통째로 지워지면 스레드만 남는다(6-7). */
  live: boolean;
  root: DocComment;
  items: DocComment[];
}

const HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px 6px',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
};

export function NoteBodyComments({ controller }: { controller: EditorController }) {
  const th = controller.uiTheme;
  const [showDone, setShowDone] = useState(false);

  const threads = useMemo<PanelThread[]>(() => {
    const quotes = new Map(noteCommentSites(controller.doc.pages).map((s) => [s.id, s.quote]));
    const byThread = new Map<string, DocComment[]>();
    controller.comments.forEach((c) => {
      const id = threadIdOfNode(c.nodeId);
      if (!id) return;
      const list = byThread.get(id) ?? [];
      list.push(c);
      byThread.set(id, list);
    });
    const out: PanelThread[] = [];
    byThread.forEach((list, id) => {
      const root = list.find((c) => !c.parentId);
      if (!root) return;
      out.push({ id, quote: quotes.get(id) ?? '', live: quotes.has(id), root, items: [root, ...list.filter((c) => c.parentId === root.id)] });
    });
    return out;
  }, [controller.comments, controller.doc.pages]);

  const openThreads = threads.filter((t) => !t.root.resolved);
  const doneThreads = threads.filter((t) => t.root.resolved);

  return (
    <section data-note-body-comments style={{ borderBottom: `1px solid ${th.border}` }}>
      <div style={{ ...HEAD, color: th.subtext }}>
        <span>본문 댓글</span>
        <span data-body-cm-count style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: hexA(th.subtext, 0.72) }}>
          {openThreads.length}
        </span>
      </div>

      {openThreads.length === 0 && doneThreads.length === 0 ? (
        <p
          data-body-cm-empty
          style={{ margin: '0 14px 12px', padding: '10px 12px', borderRadius: 10, border: `1px dashed ${th.border}`, background: th.panel2, fontSize: 11.5, lineHeight: 1.6, color: hexA(th.subtext, 0.72), wordBreak: 'keep-all' }}
        >
          본문에서 글을 고르고 우클릭 → &lsquo;댓글 달기&rsquo;(⌘⌥M)를 누르면 그 부분에 댓글을 달 수 있어요
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '0 14px 12px' }}>
          {openThreads.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              data-cm-card={t.id}
              onClick={() => openNoteComment(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openNoteComment(t.id);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${th.border}`,
                background: th.panel,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span
                  data-cm-card-quote
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    paddingLeft: 8,
                    borderLeft: '2px solid var(--mf-note-cm-line-on, #e8a25f)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: th.subtext,
                    wordBreak: 'keep-all',
                  }}
                >
                  {t.live ? t.quote : '원문이 지워졌어요'}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  data-cm-card-resolve
                  aria-label="해결됨으로 옮기기"
                  onClick={(e) => {
                    e.stopPropagation();
                    void controller.resolveComment(t.root.id, true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.stopPropagation();
                    void controller.resolveComment(t.root.id, true);
                  }}
                  style={{ flex: '0 0 auto', width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, color: '#a8b89e', fontSize: 13, cursor: 'pointer' }}
                >
                  ✓
                </span>
              </span>
              {t.items.map((c) => (
                <span key={c.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 8 }}>
                  <Avatar name={c.authorName} size={20} />
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: th.text }}>{c.authorName || '알 수 없음'}</span>
                    <span style={{ marginLeft: 5, fontSize: 10, color: hexA(th.subtext, 0.72) }}>{formatLastEdited(c.createdAt)}</span>
                    <span style={{ display: 'block', fontSize: 12, lineHeight: 1.55, color: th.subtext, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{c.body}</span>
                  </span>
                </span>
              ))}
              {/* 답글 — **카드 안에서 바로**(6-6). 입력칸을 누를 때는 본문으로 튀지
                  않게 전파를 끊는다(그러지 않으면 글을 쓰려다 스크롤이 난다). */}
              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ display: 'block', marginTop: 8 }}>
                <CardReply controller={controller} rootId={t.root.id} threadId={t.id} />
              </span>
            </div>
          ))}
        </div>
      )}

      {doneThreads.length > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          <button
            type="button"
            data-cm-done-toggle
            onClick={() => setShowDone((v) => !v)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 9, border: 0, background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, textAlign: 'left', cursor: 'pointer' }}
          >
            ✓ 해결된 댓글 {doneThreads.length}개
          </button>
          {showDone &&
            doneThreads.map((t) => (
              <div key={t.id} data-cm-done={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '7px 9px', borderRadius: 10, background: th.panel2 }}>
                <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: th.subtext, textDecoration: 'line-through' }}>
                  {t.live ? t.quote : '원문이 지워졌어요'}
                </span>
                <span style={{ flex: '0 0 auto', fontSize: 10.5, color: hexA(th.subtext, 0.72) }}>댓글 {t.items.length}</span>
                <button
                  type="button"
                  data-cm-reopen={t.id}
                  onClick={() => void controller.resolveComment(t.root.id, false)}
                  style={{ flex: '0 0 auto', height: 22, padding: '0 9px', borderRadius: 999, border: `1px solid ${th.border}`, background: 'transparent', color: th.subtext, fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  다시 열기
                </button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/**
 * 카드 안의 한 줄 답글(6-6) — 알약 입력칸이고, 글을 쓰면 오른쪽에 「답글」이 나타난다.
 *
 * `Enter`로 보내고 **조합 중 Enter는 무시한다** — 한글을 확정하는 그 Enter가 제출로
 * 새면 반쪽 글자가 올라간다(앱의 다른 입력칸들과 같은 규칙).
 */
function CardReply({ controller, rootId, threadId }: { controller: EditorController; rootId: string; threadId: string }) {
  const th = controller.uiTheme;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const res = await controller.addComment(threadNodeId(threadId), body, { parentId: rootId });
    setBusy(false);
    if (!res.error) setDraft('');
  };
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        data-cm-card-reply={threadId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void send();
        }}
        placeholder="답글 달기"
        aria-label="답글 달기"
        style={{ flex: '1 1 auto', minWidth: 0, height: 30, padding: '0 11px', borderRadius: 999, border: `1px solid ${th.border}`, background: th.panel2, color: th.text, fontFamily: 'inherit', fontSize: 12 }}
      />
      {draft.trim() && (
        <button
          type="button"
          data-cm-card-send={threadId}
          onClick={() => void send()}
          disabled={busy}
          style={{ flex: '0 0 auto', height: 30, padding: '0 12px', borderRadius: 999, border: 0, background: th.accent, color: th.accentInk, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}
        >
          답글
        </button>
      )}
    </span>
  );
}

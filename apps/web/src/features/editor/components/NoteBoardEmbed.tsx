// 공책 본문의 **보드 임베드** — 링크 한 줄이 아니라 "그 보드의 지금 상태"를 보여 준다.
//
// 스펙(`공책 본문 · 보드 임베드`)의 구현체다. 종류마다 가장 쓸모 있는 부분을 본문 폭
// 안에 그리고, 본문에서 허용하는 조작은 **칸반의 열 이동 하나뿐**이다:
//
//   칸반    열별 카드 수 · 진행률 · 한 열의 카드 목록   → 카드를 열 탭에 끌어 놓기
//   마인드맵 가지 개요 / 축소 맵                      → 보기 전용(펼치기·보기 전환)
//   화이트보드 캔버스 일부를 보는 창                    → 보기 전용(팬·줌·프레임)
//
// ## 왜 원본을 다시 읽나
// 보드 내용을 블록에 복사하지 않는다. 복사하면 글은 그대로인데 보드만 바뀌어 **거짓말**이
// 되고, 두 벌이 된 순간 어느 쪽이 정본인지 아무도 모른다. 블록이 드는 것은 **보기
// 상태**(고른 열·펼친 가지·프레임·크기)뿐이다(`NoteBlock.embed`).
//
// ## 왜 보일 때만 읽나
// 한 페이지에 임베드가 여럿이면 열자마자 문서 여러 벌을 받는다. `IntersectionObserver`로
// 화면에 들어온 것만 읽고, 나가면 손을 뗀다(스펙 §10).
//
// ## 색은 우리 팔레트다(스펙과 다른 한 가지)
// 스펙이 종류색을 `마인드맵 #5B8DEF · 화이트보드 #E0602F · 칸반 #4E8C67`로 적었지만,
// 이 앱에는 이미 종류색이 있다(`--mf-doc-map/board/kanban` — 홈 카드 배지·갤러리 레일·
// 카드 테두리가 그 색으로 종류를 말한다). 임베드만 다른 색을 쓰면 **같은 종류가 화면마다
// 다른 색**이 되므로 우리 토큰을 쓰고, 면은 스펙과 같은 관계(16% 틴트)로 만든다.
// 나머지 값(크기·간격·문구·동작)은 스펙 그대로다.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Doc, KanbanCard, NoteBlock } from '@mindflow/mindmap-core';
import { useBackend } from '../../../adapters/BackendContext';
import { writeClipboard } from '../noteClipboard';
import type { EditorController, LinkTarget } from '../useEditorState';
import {
  embedFrames,
  embedKindName,
  embedKindOf,
  embedRuleLabel,
  embedSize,
  fitFrame,
  kanbanCards,
  kanbanStats,
  kanbanView,
  mindmapView,
  moveKanbanCard,
  outlineOf,
  whiteboardView,
  WB_HEIGHT,
  zoomAt,
  type EmbedFrame,
  type EmbedKind,
} from '../noteEmbed';

/* ───────────────────────────── 문서 읽기 ───────────────────────────── */

type EmbedState =
  | { kind: 'loading' }
  /** 문서가 없다 — 지워졌거나 애초에 없는 id. */
  | { kind: 'missing' }
  /** 볼 권한이 없다(남의 문서). `load()`가 `null`과 구별해 주지 못하는 경우는 `missing`으로 떨어진다. */
  | { kind: 'denied' }
  | { kind: 'ok'; doc: Doc; version: number; title: string; canEdit: boolean };

/**
 * 그 보드를 읽어 둔다 — **화면에 보일 때만**(스펙 §10).
 *
 * 다시 읽는 계기는 셋이다: 처음 보일 때 · 창이 앞으로 올 때 · 우리가 카드를 옮긴 뒤.
 * 진짜 실시간 구독(Realtime)을 붙이지 않은 이유는 비용이다 — 임베드 하나가 채널 하나를
 * 잡으면 한 페이지가 채널 여럿을 연다(무료 플랜의 Realtime 메시지가 가장 먼저 차는 줄이다).
 */
function useEmbedDoc(docId: string | undefined, host: HTMLElement | null): {
  state: EmbedState;
  /** 낙관적으로 갈아 끼운다 — 저장이 실패하면 부르는 쪽이 되돌린다. */
  put: (doc: Doc, version?: number) => void;
  reload: () => void;
} {
  const { docStore } = useBackend();
  const [state, setState] = useState<EmbedState>({ kind: 'loading' });
  const [seen, setSeen] = useState(false);
  const [nonce, setNonce] = useState(0);

  // 화면에 한 번 들어오면 계속 읽는다 — 스크롤로 스쳐 나갈 때마다 껐다 켜면 껌뻑인다.
  //
  // 노드를 **ref가 아니라 상태로** 받는 이유: 이 판은 링크 후보 목록이 도착한 뒤에야
  // 서므로 첫 렌더에는 노드가 없다. `ref.current`를 보면 그때 null이고, ref는 바뀌어도
  // 효과를 다시 돌리지 않아 **영영 불러오지 않는다**(테스트에서 잡았다).
  useEffect(() => {
    if (!host || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    io.observe(host);
    return () => io.disconnect();
  }, [host, seen]);

  useEffect(() => {
    if (!docId || !seen) return;
    let alive = true;
    void (async () => {
      try {
        const got = await docStore.load(docId);
        if (!alive) return;
        setState(got ? { kind: 'ok', doc: got.doc, version: got.version, title: got.title, canEdit: got.ownedByMe !== false } : { kind: 'missing' });
      } catch {
        // 권한이 없어 거절된 것과 네트워크가 끊긴 것을 여기서는 가를 수 없다 —
        // 사용자가 할 수 있는 일(권한 요청)이 있는 쪽으로 말한다.
        if (alive) setState({ kind: 'denied' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId, docStore, seen, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const put = useCallback((doc: Doc, version?: number) => {
    setState((prev) => (prev.kind === 'ok' ? { ...prev, doc, version: version ?? prev.version } : prev));
  }, []);

  // 창이 앞으로 오면 다시 읽는다 — 다른 탭에서 보드를 고치고 돌아오는 흔한 길이다.
  useEffect(() => {
    if (!seen) return;
    const again = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [seen, reload]);

  return { state, put, reload };
}

/** 내 이메일 — 「내 카드만」이 담당자와 맞춰 볼 값. */
function useMyEmail(): string {
  const { auth } = useBackend();
  const [me, setMe] = useState('');
  useEffect(() => {
    let alive = true;
    void auth
      .getSession()
      .then((s) => {
        if (alive) setMe(s?.user?.email ?? '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [auth]);
  return me;
}

/* ───────────────────────────── 값 ───────────────────────────── */

const KIND_TOKEN: Record<EmbedKind, string> = {
  map: 'var(--mf-doc-map)',
  board: 'var(--mf-doc-board)',
  kanban: 'var(--mf-doc-kanban)',
  note: 'var(--mf-doc-note)',
};

/** 종류 아이콘 — 홈 카드의 종류 배지와 같은 글리프(같은 뜻은 같은 표식). */
function KindGlyph({ kind }: { kind: EmbedKind }) {
  if (kind === 'kanban') {
    return (
      <>
        <rect x="3.5" y="4.5" width="5.5" height="15" rx="1.5" />
        <rect x="11" y="4.5" width="5.5" height="10" rx="1.5" />
        <rect x="18.5" y="4.5" width="2" height="7" rx="1" />
      </>
    );
  }
  if (kind === 'board') {
    return (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
        <rect x="6.5" y="8" width="6" height="4.5" rx="1" />
        <rect x="14" y="11" width="4" height="5" rx="1" />
      </>
    );
  }
  if (kind === 'note') {
    return (
      <>
        <path d="M8 4h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7" />
        <path d="M9 9h7M9 13h7M9 17h4" />
      </>
    );
  }
  return (
    <>
      <path d="M7.3 11.2C10 9.8 12.4 8.2 15.4 7" />
      <path d="M7.3 12.8C10 14.2 12.4 15.8 15.4 17" />
      <circle cx="5" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="6.4" r="2.2" />
      <circle cx="17.6" cy="17.6" r="2.2" />
    </>
  );
}

const PILL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 999,
  border: '1px solid var(--mf-th)',
  background: 'var(--mf-card)',
  color: 'var(--mf-text)',
  fontFamily: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * 상대 시각 한 마디 — 머리줄 메타의 `업데이트 …`. 모르면 **빈 문자열**이고, 그때 그
 * 줄은 아예 뜨지 않는다.
 *
 * 에포크(1970-01-01)를 걸러내는 이유: 로컬·데모 어댑터가 "수정 시각을 모른다"를
 * `new Date(0)`으로 적는다. 그대로 그리면 머리줄에 **`업데이트 1. 1.`**이 떠서
 * 모르는 것을 아는 척하게 된다(실브라우저 프로브에서 봤다).
 */
function ago(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t < Date.parse('2000-01-01T00:00:00.000Z')) return '';
  const now = Date.now();
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  // 해가 다르면 연도까지 — `1. 1.`만 있으면 올해인지 재작년인지 알 수 없다.
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Date(t).toLocaleDateString('ko-KR', { ...(sameYear ? {} : { year: 'numeric' }), month: 'numeric', day: 'numeric' });
}

/* ───────────────────────────── 본체 ───────────────────────────── */

export function NoteBoardEmbed({
  controller,
  block,
  target,
  pickLinkDoc,
  flow,
  picked,
  pickObject,
}: {
  controller: EditorController;
  block: NoteBlock;
  target: LinkTarget | null;
  pickLinkDoc: (at: { after?: string; replace?: string }) => void;
  /** 블록 흐름(정렬·들여쓰기) — 다른 블록과 같은 규칙으로 바깥에서 받는다. */
  flow: CSSProperties;
  /** 오브젝트로 골라져 있나 — 골라 두면 ⌫·Enter·⌘C가 이 블록에 걸린다. */
  picked: boolean;
  pickObject: (id: string, extend?: boolean) => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const { state, put, reload } = useEmbedDoc(block.docId, host);
  const me = useMyEmail();
  const readOnly = controller.readOnly;
  const size = embedSize(block);
  /** 그 자리에서 한 마디 — 이 에디터에는 토스트가 없어 **안내 줄이 잠깐 대신한다**. */
  const [say, setSay] = useState('');
  const sayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speak = useCallback((msg: string) => {
    setSay(msg);
    clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setSay(''), 2600);
  }, []);
  useEffect(() => () => clearTimeout(sayTimer.current), []);

  const kind = state.kind === 'ok' ? embedKindOf(state.doc) : 'map';
  const title = state.kind === 'ok' ? state.title || target?.title || '제목 없음' : target?.title || '제목 없음';
  const canEdit = state.kind === 'ok' && state.canEdit && !readOnly;
  // 못 읽은 문서의 종류는 **모른다** — `마인드맵`(기본값)을 적으면 지워진 보드가
  // 마인드맵이었다고 말하는 셈이다(프로브 화면에서 그렇게 보였다).
  const kindLabel = state.kind === 'ok' ? embedKindName(kind) : '문서';
  const setView = (patch: Parameters<EditorController['setNoteEmbedView']>[1]) => controller.setNoteEmbedView(block.id, patch);

  // 아직 고르지 않은 링크 — 예전 그대로 점선 「문서 고르기」다.
  if (!block.docId || !target) {
    return (
      <div className="mf-note-link" data-note-block={block.id} data-note-kind="link" style={{ ...flow, position: 'relative' }}>
        <button
          type="button"
          data-note-link-pick
          disabled={readOnly}
          onClick={() => pickLinkDoc({ replace: block.id })}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 52,
            borderRadius: 10,
            border: '1.5px dashed var(--mf-border)',
            background: 'transparent',
            color: 'var(--mf-muted)',
            fontFamily: 'inherit',
            fontSize: 12.5,
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          문서 고르기
        </button>
      </div>
    );
  }

  // 공책은 미리보기가 없다 — 본문에 편들 "지금 상태"가 글 자체라 한 줄 카드가 맞다.
  // 불러오는 중·삭제됨·권한 없음은 **판을 그대로 펴고** 본문 자리에 그 사정을 적는다
  // (스펙 §8) — 한 줄로 접어 버리면 "왜 안 보이나"를 말할 자리가 없다.
  const small = size === 'sm' || (kind === 'note' && state.kind === 'ok');

  return (
    <div
      ref={setHost}
      className="mf-note-link"
      data-note-block={block.id}
      data-note-kind="link"
      data-embed-size={small ? 'sm' : 'lg'}
      data-embed-kind={kind}
      data-embed-picked={picked ? '1' : undefined}
      onPointerDown={(e) => {
        // 임베드 안의 조작(열 탭·카드·단추·캔버스)은 제 일을 한다 — 판 자체를 누른
        // 경우에만 오브젝트로 고른다. 어느 쪽이든 본문의 드래그 선택은 아니다.
        e.stopPropagation();
        /**
         * **기본 동작을 막아 캐럿을 지킨다**(스펙 §8).
         *
         * 막지 않으면 열 탭을 누르는 순간 그 단추가 초점을 가져가 **쓰던 줄의 캐럿이
         * 사라진다**(실브라우저 프로브에서 잡았다: 누르기 전 `b2`였던 활성 요소가
         * 누른 뒤 `null`이 됐다). 단추·링크는 `click`으로 동작하므로 이것으로 잃는
         * 것은 없고, 임베드 안에서 글이 드래그 선택되던 것도 함께 사라진다(의도).
         */
        e.preventDefault();
        if ((e.target as HTMLElement).closest('button,a,input,[data-embed-canvas],[data-embed-card-id]')) return;
        pickObject(block.id, e.shiftKey);
      }}
      style={{
        ...flow,
        position: 'relative',
        borderRadius: 15,
        outline: picked ? '2px solid var(--mf-accent)' : 'none',
        outlineOffset: 2,
      }}
    >
      {small ? (
        <SmallCard
          target={target}
          kind={kind}
          title={title}
          readOnly={readOnly}
          kindLabel={kindLabel}
          /** 공책·불러오는 중에는 펼칠 것이 없다. */
          onExpand={kind === 'note' || state.kind !== 'ok' ? undefined : () => setView({ size: 'lg' })}
        />
      ) : (
        <div
          data-embed-card
          style={{
            background: 'var(--mf-card)',
            border: '1px solid var(--mf-border)',
            borderRadius: 14,
            boxShadow: '0 12px 26px -24px rgba(46,42,38,.45)',
            overflow: 'hidden',
          }}
        >
          <EmbedHead
            kind={kind}
            title={title}
            spaceName={target.spaceName}
            updatedAt={target.updatedAt}
            rule={state.kind === 'ok' ? embedRuleLabel(kind, canEdit) : ''}
            kindLabel={kindLabel}
            href={target.href}
            onCollapse={() => setView({ size: 'sm' })}
          />
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {state.kind === 'ok' && kind === 'kanban' && (
              <KanbanBody
                block={block}
                doc={state.doc}
                me={me}
                canEdit={canEdit}
                href={target.href}
                say={say}
                onSay={speak}
                setView={setView}
                onMove={async (card, toCol) => {
                  if (state.kind !== 'ok') return;
                  const before = state.doc;
                  const next = moveKanbanCard(before, card.id, toCol);
                  if (next === before) return;
                  const colName = (before.columns ?? [])[toCol]?.title ?? '';
                  put(next);
                  const res = await controller.saveOtherDoc(block.docId ?? '', next, state.version);
                  if (res.ok) {
                    put(next, res.version);
                    speak(`'${card.text}' 카드를 ${colName}(으)로 옮겼어요 — 보드에도 바로 반영돼요`);
                  } else {
                    put(before);
                    reload();
                    speak('옮기지 못했어요 · 다시 시도');
                  }
                }}
              />
            )}
            {state.kind === 'ok' && kind === 'map' && <MindmapBody block={block} doc={state.doc} setView={setView} />}
            {state.kind === 'ok' && kind === 'board' && <WhiteboardBody block={block} doc={state.doc} setView={setView} />}
            {state.kind === 'ok' && kind === 'note' && (
              <GuideRow icon="eye" text="공책은 본문이 곧 내용이라 미리보기가 없어요 — 「열기」로 그 공책을 펴세요" />
            )}
            {state.kind === 'loading' && <SkeletonBody />}
            {state.kind === 'missing' && (
              <StateBox
                text="이 보드는 삭제됐어요"
                action={readOnly ? undefined : { label: '링크 빼기', onClick: () => controller.removeNoteBlock(block.id) }}
              />
            )}
            {state.kind === 'denied' && (
              <StateBox
                text="이 보드를 볼 권한이 없어요"
                action={{
                  label: '접근 권한 요청',
                  onClick: () => {
                    // 우리에게는 "권한 요청" 창구가 아직 없다 — 지어내는 대신 **주소를
                    // 손에 쥐여 준다**(그 보드 주인에게 보낼 수 있는 유일한 실물이다).
                    const url = new URL(target.href, window.location.origin).href;
                    writeClipboard({ plain: url, html: `<a href="${url}">${url}</a>` });
                    speak('보드 주소를 복사했어요 — 보드 주인에게 보내 권한을 받으세요');
                  },
                }}
              />
            )}
            {say && state.kind !== 'ok' && <GuideRow icon="eye" text={say} />}
          </div>
        </div>
      )}

      {/* 제거 — 블록 위에 마우스를 얹으면 바깥 모서리에 뜬다(스펙 §3.4). */}
      {!readOnly && (
        <button
          type="button"
          data-embed-remove
          className="mf-note-linkact"
          title="링크 제거"
          aria-label="링크 제거"
          onClick={() => controller.removeNoteBlock(block.id)}
          style={{
            position: 'absolute',
            top: -7,
            right: -7,
            width: 22,
            height: 22,
            borderRadius: 999,
            border: '1px solid var(--mf-border)',
            background: 'var(--mf-card)',
            color: 'var(--mf-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            zIndex: 2,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── 머리줄 ───────────────────────────── */

function EmbedHead({
  kind,
  title,
  spaceName,
  updatedAt,
  rule,
  href,
  onCollapse,
  kindLabel,
}: {
  kind: EmbedKind;
  title: string;
  spaceName: string;
  updatedAt: string | undefined;
  rule: string;
  href: string;
  onCollapse: () => void;
  /** 종류 이름 — 아직 못 읽었거나 없는 문서면 `문서`다(모르는 종류를 지어내지 않는다). */
  kindLabel: string;
}) {
  const tone = KIND_TOKEN[kind];
  const when = ago(updatedAt);
  return (
    <div data-embed-head style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 12px', minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          flex: '0 0 auto',
          borderRadius: 9,
          background: `color-mix(in srgb, ${tone} 16%, var(--mf-card))`,
          color: tone,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <KindGlyph kind={kind} />
        </svg>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span data-embed-title style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span data-embed-meta style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mf-muted)', minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {kindLabel}
            {spaceName ? ` · ${spaceName}` : ''}
          </span>
          {when && (
            <>
              <span aria-hidden style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--mf-faint2)', flex: '0 0 auto' }} />
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--mf-note-ok)', flex: '0 0 auto' }} />
              <span style={{ whiteSpace: 'nowrap' }}>업데이트 {when}</span>
            </>
          )}
        </span>
      </span>
      {rule && (
        <span
          data-embed-rule
          style={{ flex: '0 0 auto', height: 22, padding: '0 8px', borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}
        >
          {rule}
        </span>
      )}
      <button
        type="button"
        data-embed-collapse
        className="mf-note-tb"
        title="작게 보기"
        aria-label="작게 보기"
        onClick={onCollapse}
        style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--mf-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 4v5H4M15 20v-5h5" />
          <path d="M9 9 3.5 3.5M15 15l5.5 5.5" />
        </svg>
      </button>
      <a
        data-embed-open
        href={href}
        style={{ ...PILL, flex: '0 0 auto', height: 28, padding: '0 11px', fontSize: 11.5, fontWeight: 800, textDecoration: 'none', gap: 5 }}
      >
        열기
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 5h11v11M19 5 6 18" />
        </svg>
      </a>
    </div>
  );
}

/* ───────────────────────────── 작게 보기 ───────────────────────────── */

function SmallCard({
  target,
  kind,
  title,
  readOnly,
  onExpand,
  kindLabel,
}: {
  target: LinkTarget;
  kind: EmbedKind;
  title: string;
  readOnly: boolean;
  onExpand?: () => void;
  kindLabel: string;
}) {
  const tone = KIND_TOKEN[kind];
  return (
    <div style={{ position: 'relative' }}>
      <a
        href={target.href}
        data-note-link={target.docId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 13px',
          paddingRight: onExpand ? 60 : 13,
          borderRadius: 13,
          border: '1px solid var(--mf-border)',
          background: 'var(--mf-card)',
          color: 'inherit',
          textDecoration: 'none',
          minWidth: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, background: `color-mix(in srgb, ${tone} 16%, var(--mf-card))`, color: tone, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <KindGlyph kind={kind} />
          </svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span data-embed-title style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--mf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {kindLabel}
            {target.spaceName ? ` · ${target.spaceName}` : ''}
          </span>
        </span>
      </a>
      {/* 펼치기는 **카드 열기와 다른 일**이라 링크 밖에 따로 얹는다(스펙 §4). */}
      {onExpand && !readOnly && (
        <button
          type="button"
          data-embed-expand
          className="mf-note-linkact"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onExpand();
          }}
          style={{ ...PILL, position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', height: 26, padding: '0 10px', fontSize: 11, background: 'var(--mf-note-hover)', borderColor: 'var(--mf-border)', color: 'var(--mf-subtext)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 10V4h6M20 14v6h-6" />
            <path d="M4 4l6 6M20 20l-6-6" />
          </svg>
          펼치기
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── 상태 ───────────────────────────── */

/**
 * 불러오는 중의 **뼈대**(스펙 §8) — 빈 칸을 두면 판이 높이를 바꾸며 튄다.
 *
 * 종류를 아직 모르므로(문서를 읽어야 안다) 칸반·개요 어느 쪽에도 치우치지 않는
 * 회색 줄 몇 개다 — 종류별 뼈대를 그리려다 틀린 종류를 잠깐 보여 주는 쪽이 더 나쁘다.
 */
function SkeletonBody() {
  return (
    <div data-embed-skeleton aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0 6px' }}>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--mf-panel2)' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        {[64, 52, 58, 46].map((w) => (
          <div key={w} style={{ width: w, height: 26, borderRadius: 999, background: 'var(--mf-panel2)' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 58, borderRadius: 11, background: 'var(--mf-panel2)' }} />
        ))}
      </div>
    </div>
  );
}

/** 삭제됨·권한 없음 — 본문 자리에 사정 한 줄과 **할 수 있는 일 하나**. */
function StateBox({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div
      data-embed-state
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '22px 14px',
        borderRadius: 11,
        background: 'var(--mf-panel2)',
        color: 'var(--mf-muted)',
        fontSize: 12,
      }}
    >
      <span>{text}</span>
      {action && (
        <button type="button" data-embed-state-act onClick={action.onClick} style={{ ...PILL, height: 26, padding: '0 11px', fontSize: 11 }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── 안내 줄 ───────────────────────────── */

function GuideRow({ icon, text, right }: { icon: 'move' | 'eye'; text: string; right?: React.ReactNode }) {
  return (
    <div data-embed-guide style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mf-faint)', minWidth: 0 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        {icon === 'move' ? (
          <>
            <path d="M5 9 2.5 12 5 15M19 9l2.5 3-2.5 3M9 5l3-2.5L15 5M9 19l3 2.5 3-2.5" />
            <path d="M2.5 12h19M12 2.5v19" />
          </>
        ) : (
          <>
            <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="2.6" />
          </>
        )}
      </svg>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      {right}
    </div>
  );
}

/* ───────────────────────────── 칸반 ───────────────────────────── */

function KanbanBody({
  block,
  doc,
  me,
  canEdit,
  href,
  say,
  onSay,
  setView,
  onMove,
}: {
  block: NoteBlock;
  doc: Doc;
  me: string;
  canEdit: boolean;
  href: string;
  say: string;
  onSay: (msg: string) => void;
  setView: (patch: { kanban?: { col?: number; mine?: boolean } }) => void;
  onMove: (card: KanbanCard, toCol: number) => void;
}) {
  const columns = doc.columns ?? [];
  const view = kanbanView(block, columns);
  const stat = kanbanStats(doc, { mine: view.mine, me });
  const { cards, more } = kanbanCards(doc, { col: view.col, mine: view.mine, me });
  /** 지금 끌고 있는 카드와 올라가 있는 열 — 드래그 중 상태라 문서에 남기지 않는다. */
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);

  const colColor = (i: number): string => stat.cols[i]?.color || 'var(--mf-accent-mute)';

  const onCardDown = (card: KanbanCard) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canEdit || e.button > 0) return;
    // 에디터의 블록 드래그와 섞이지 않게 여기서 멈춘다(스펙 §10).
    e.stopPropagation();
    e.preventDefault();
    setDrag({ id: card.id, over: null });
    const move = (ev: PointerEvent) => {
      const el = document.elementFromPoint?.(ev.clientX, ev.clientY) as HTMLElement | null;
      const tab = el?.closest?.('[data-embed-col]') as HTMLElement | null;
      const at = tab ? Number(tab.getAttribute('data-embed-col')) : NaN;
      setDrag((d) => (d ? { ...d, over: Number.isInteger(at) ? at : null } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const el = document.elementFromPoint?.(ev.clientX, ev.clientY) as HTMLElement | null;
      const tab = el?.closest?.('[data-embed-col]') as HTMLElement | null;
      const at = tab ? Number(tab.getAttribute('data-embed-col')) : NaN;
      setDrag(null);
      if (Number.isInteger(at) && at !== view.col) onMove(card, at);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {/* 진행률 — 열 색 구간을 이어 붙인 막대 + `완료 n/m`(스펙 §5.1). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span data-embed-progress style={{ flex: 1, display: 'flex', height: 6, borderRadius: 999, background: 'var(--mf-panel2)', overflow: 'hidden' }}>
          {stat.cols.map((c, i) => (
            <span
              key={c.id}
              data-embed-seg={c.id}
              style={{ width: `${stat.total ? (c.total / stat.total) * 100 : 0}%`, background: colColor(i), transition: 'width .3s ease' }}
            />
          ))}
        </span>
        <span data-embed-done style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--mf-subtext)', whiteSpace: 'nowrap' }}>
          완료 {stat.done}/{stat.total}
        </span>
      </div>

      {/* 열 탭 + 「내 카드만」 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {stat.cols.map((c, i) => {
          const on = i === view.col;
          const over = drag?.over === i && i !== view.col;
          return (
            <button
              key={c.id}
              type="button"
              data-embed-col={i}
              aria-pressed={on}
              onClick={() => setView({ kanban: { col: i } })}
              style={{
                ...PILL,
                height: 30,
                padding: '0 11px 0 9px',
                fontSize: 12,
                ...(on ? { background: 'var(--mf-text)', borderColor: 'var(--mf-text)', color: 'var(--mf-card)', fontWeight: 800 } : {}),
                ...(over ? { background: 'var(--mf-tsel-bg)', borderColor: 'var(--mf-tsel-ring)', color: 'var(--mf-text)', transform: 'scale(1.06)' } : {}),
                transition: 'transform .12s ease, background .12s ease',
              }}
            >
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: colColor(i), flex: '0 0 auto' }} />
              {c.title}
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: on ? 'var(--mf-card)' : 'var(--mf-muted)' }}>{c.count}</span>
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-embed-mine
          aria-pressed={view.mine}
          onClick={() => setView({ kanban: { mine: !view.mine } })}
          style={{
            ...PILL,
            height: 26,
            padding: '0 9px 0 5px',
            fontSize: 11,
            background: view.mine ? 'var(--mf-tsel-bg)' : 'transparent',
            borderColor: view.mine ? 'var(--mf-border-hover)' : 'var(--mf-th)',
            color: view.mine ? 'var(--mf-danger)' : 'var(--mf-subtext)',
          }}
        >
          <span aria-hidden style={{ width: 14, height: 14, borderRadius: 999, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent)', fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            나
          </span>
          내 카드만
        </button>
      </div>

      {/* 카드 — 본문 폭에 따라 1~3열로 흐른다(스펙 §5.3). */}
      {cards.length ? (
        <div data-embed-cards style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 7 }}>
          {cards.map((c) => (
            <div
              key={c.id}
              data-embed-card-id={c.id}
              onPointerDown={onCardDown(c)}
              onClick={() => onSay('카드 내용은 보드에서 고쳐요 — 「열기」로 가 보세요')}
              style={{
                padding: '10px 11px',
                borderRadius: 10,
                background: 'var(--mf-card)',
                border: '1px solid var(--mf-border-soft)',
                boxShadow: '0 1px 0 rgba(46,42,38,.03)',
                cursor: canEdit ? 'grab' : 'default',
                opacity: drag?.id === c.id ? 0.4 : 1,
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', lineHeight: 1.45, wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {c.text || '제목 없음'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, minWidth: 0 }}>
                {c.tag && (
                  <span style={{ height: 18, padding: '0 6px', borderRadius: 5, background: 'var(--mf-accent-soft)', color: 'var(--mf-accent-deep)', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                    {c.tag}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {c.due && (
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: isOverdue(c.due) ? 'var(--mf-danger)' : 'var(--mf-muted)', whiteSpace: 'nowrap' }}>{c.due.slice(5)}</span>
                )}
                {c.owner && (
                  <span aria-hidden style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                    {c.owner.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div data-embed-empty style={{ border: '1px dashed var(--mf-border)', borderRadius: 10, padding: '14px 10px', textAlign: 'center', fontSize: 12, color: 'var(--mf-faint)' }}>
          {view.mine ? '이 열에 내 카드가 없어요' : '이 열은 비어 있어요 — 카드를 끌어 위 열 이름에 놓아 보세요'}
        </div>
      )}

      <GuideRow
        icon={canEdit ? 'move' : 'eye'}
        text={say || (canEdit ? '카드를 위 열로 끌어 옮길 수 있어요 · 내용 편집은 보드에서' : '보기 전용 · 카드를 옮기려면 편집 권한이 필요해요')}
        right={
          more > 0 ? (
            <a data-embed-more href={href} style={{ flex: '0 0 auto', color: 'var(--mf-danger)', fontSize: 11, fontWeight: 800, textDecoration: 'none' }}>
              카드 {more}장 더 보기
            </a>
          ) : undefined
        }
      />
    </>
  );
}

/** 오늘보다 앞선 기한인가 — 문자열 비교로 충분하다(`YYYY-MM-DD`는 사전순 = 시간순). */
function isOverdue(due: string): boolean {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return due < today;
}

/* ───────────────────────────── 마인드맵 ───────────────────────────── */

function Segments<T extends string>({ value, options, onPick, height = 24, attr }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void; height?: number; attr: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999, background: 'var(--mf-panel2)' }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            {...{ [attr]: o.v }}
            aria-pressed={on}
            onClick={() => onPick(o.v)}
            style={{
              height,
              padding: '0 11px',
              borderRadius: 999,
              border: 0,
              background: on ? 'var(--mf-card)' : 'transparent',
              boxShadow: on ? '0 1px 3px rgba(46,42,38,.12)' : 'none',
              color: on ? 'var(--mf-text)' : 'var(--mf-subtext)',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function MindmapBody({ block, doc, setView }: { block: NoteBlock; doc: Doc; setView: (patch: { mindmap?: { view?: 'outline' | 'map'; open?: number[] } }) => void }) {
  const view = mindmapView(block);
  const tree = useMemo(() => outlineOf(doc), [doc]);
  const tone = KIND_TOKEN.map;
  const toggle = (i: number) => setView({ mindmap: { open: view.open.includes(i) ? view.open.filter((n) => n !== i) : [...view.open, i] } });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Segments
          attr="data-embed-mmview"
          value={view.view}
          options={[
            { v: 'outline', label: '개요' },
            { v: 'map', label: '맵' },
          ]}
          onPick={(v) => setView({ mindmap: { view: v } })}
        />
        <span style={{ flex: 1 }} />
        {view.view === 'outline' && (
          <>
            <button type="button" data-embed-openall onClick={() => setView({ mindmap: { open: tree.branches.map((_, i) => i) } })} style={TEXT_BTN}>
              모두 펼치기
            </button>
            <button type="button" data-embed-closeall onClick={() => setView({ mindmap: { open: [] } })} style={TEXT_BTN}>
              모두 접기
            </button>
          </>
        )}
      </div>

      {view.view === 'outline' ? (
        <div data-embed-outline style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--mf-panel)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: tone, flex: '0 0 auto' }} />
            <span data-embed-outline-root style={{ fontSize: 13, fontWeight: 800, color: 'var(--mf-text)' }}>{tree.root?.text ?? '빈 맵'}</span>
          </div>
          <div style={{ borderLeft: '1.5px solid var(--mf-border)', paddingLeft: 12 }}>
            {tree.branches.map((b, i) => {
              const open = view.open.includes(i);
              return (
                <div key={b.id}>
                  <button
                    type="button"
                    data-embed-branch={i}
                    aria-expanded={open}
                    onClick={() => toggle(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', height: 28, padding: '0 6px', border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--mf-muted)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: b.color || tone, flex: '0 0 auto' }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.text}</span>
                    {b.count > 0 && <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-faint)' }}>{b.count}</span>}
                  </button>
                  {open && b.children.length > 0 && (
                    <div style={{ borderLeft: '1.5px solid var(--mf-border-soft)', margin: '0 0 0 9px', paddingLeft: 14 }}>
                      {b.children.map((c) => (
                        <div key={c.id} data-embed-child={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24, minWidth: 0 }}>
                          <span aria-hidden style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--mf-faint2)', flex: '0 0 auto' }} />
                          <span style={{ fontSize: 12, color: 'var(--mf-subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</span>
                        </div>
                      ))}
                      {b.deep > 0 && <div style={{ height: 24, display: 'flex', alignItems: 'center', paddingLeft: 11, fontSize: 11, color: 'var(--mf-faint)' }}>+{b.deep}</div>}
                    </div>
                  )}
                </div>
              );
            })}
            {!tree.branches.length && <div style={{ height: 28, display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--mf-faint)' }}>가지가 아직 없어요</div>}
          </div>
        </div>
      ) : (
        <MiniMap tree={tree} tone={tone} />
      )}

      <GuideRow icon="eye" text="보기 전용 · 주제를 고치려면 맵을 열어 주세요" />
    </>
  );
}

const TEXT_BTN: CSSProperties = {
  border: 0,
  background: 'transparent',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '2px 4px',
};

/**
 * 축소 맵 — **고정 좌표계 640×300**을 창 폭에 맞춰 줄인다(스펙 §6.3).
 *
 * 보드의 실제 좌표를 쓰지 않는 이유: 맵은 사람마다 배치가 제각각이라 축소하면 글자가
 * 읽히지 않는 크기로 떨어지기 일쑤다. 임베드가 보여 줄 것은 "이 맵이 어떤 모양인가"이지
 * 좌표 그 자체가 아니므로, 트리를 **다시 배치해** 언제나 읽히는 축소판을 만든다.
 */
function MiniMap({ tree, tone }: { tree: ReturnType<typeof outlineOf>; tone: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, (w || 640) / 640);
  const branches = tree.branches.slice(0, 4);
  return (
    <div
      ref={ref}
      data-embed-minimap
      style={{
        position: 'relative',
        height: 300 * scale,
        borderRadius: 10,
        background: 'var(--mf-panel)',
        backgroundImage: 'radial-gradient(var(--mf-note-bar-dot) 1px, transparent 1px)',
        backgroundSize: '14px 14px',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: '0 0', width: 640, height: 300 }}>
        <svg width="640" height="300" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          {branches.map((b, i) => {
            const by = 34 + i * 66 + 15;
            return (
              <g key={b.id}>
                <path d={`M152 150 C 190 150, 190 ${by}, 228 ${by}`} fill="none" stroke="var(--mf-border)" strokeWidth="1.5" />
                {b.children.slice(0, 3).map((c, j) => (
                  <path key={c.id} d={`M${228 + 128} ${by} C ${370} ${by}, ${370} ${by - 21 + j * 21}, 392 ${by - 21 + j * 21}`} fill="none" stroke="var(--mf-border)" strokeWidth="1.5" />
                ))}
              </g>
            );
          })}
        </svg>
        <div style={{ position: 'absolute', left: 24, top: 132, width: 128, height: 36, borderRadius: 10, background: tone, color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {tree.root?.text ?? '빈 맵'}
        </div>
        {branches.map((b, i) => (
          <div key={b.id}>
            <div style={{ position: 'absolute', left: 228, top: 34 + i * 66, width: 128, height: 30, borderRadius: 9, background: 'var(--mf-card)', border: `1px solid ${b.color || tone}`, color: 'var(--mf-text)', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', padding: '0 9px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {b.text}
            </div>
            {b.children.slice(0, 3).map((c, j) => (
              <div key={c.id} style={{ position: 'absolute', left: 392, top: 34 + i * 66 + 4 + j * 21 - 21, width: 150, height: 22, borderRadius: 6, background: 'var(--mf-panel2)', color: 'var(--mf-subtext)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {c.text}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── 화이트보드 ───────────────────────────── */

function WhiteboardBody({ block, doc, setView }: { block: NoteBlock; doc: Doc; setView: (patch: { whiteboard?: { frame?: number; height?: 's' | 'm' | 'l' } }) => void }) {
  const view = whiteboardView(block);
  const frames = useMemo(() => embedFrames(doc), [doc]);
  const frame = frames[Math.min(view.frame, frames.length - 1)] ?? frames[0] ?? ({ id: '', label: '전체', x: 0, y: 0, w: 800, h: 500 } as EmbedFrame);
  const height = WB_HEIGHT[view.height];
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: height });
  /** 팬·줌은 **세션 한정**이다(스펙 §2) — 문서에 적으면 남의 화면이 내 자리로 끌려간다. */
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  /** 지금 프레임에 맞춰진 상태인가 — 끌어 움직이면 풀린다(스펙 §7.1). */
  const [fitted, setFitted] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 프레임·높이·창 폭이 바뀌면 다시 맞춘다.
  useEffect(() => {
    if (box.w <= 0) return;
    setCam(fitFrame(frame, box));
    setFitted(true);
    // 의존은 객체가 아니라 **그 값**이다 — `embedFrames()`가 렌더마다 새 배열을 만들어,
    // 객체 정체성으로 걸면 팬을 하는 족족 카메라가 되맞춰진다(끌자마자 튕겨 돌아온다).
  }, [frame.id, frame.x, frame.y, frame.w, frame.h, box.w, box.h]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    const move = (ev: PointerEvent) => {
      setCam((c) => ({ ...c, x: start.cx + (ev.clientX - start.x), y: start.cy + (ev.clientY - start.y) }));
      setFitted(false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 일반 휠은 **본문 스크롤에 양보한다**(스펙 §7.2) — 긴 글 안의 창에서 휠이 갇히면
  // 페이지를 내릴 수 없다. ⌘/Ctrl을 누른 휠만 확대다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setCam((c) => zoomAt(c, e.deltaY < 0 ? 1.1 : 0.9, { w: el.clientWidth, h: el.clientHeight }));
      setFitted(false);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const zoomBtn = (factor: number) => () => {
    setCam((c) => zoomAt(c, factor, box));
    setFitted(false);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {frames.map((f, i) => {
          const on = i === view.frame && fitted;
          return (
            <button
              key={f.id || 'all'}
              type="button"
              data-embed-frame={i}
              aria-pressed={on}
              onClick={() => {
                setView({ whiteboard: { frame: i } });
                setCam(fitFrame(f, box));
                setFitted(true);
              }}
              style={{ ...PILL, height: 26, padding: '0 10px', fontSize: 11, fontWeight: 800, ...(on ? { background: 'var(--mf-text)', borderColor: 'var(--mf-text)', color: 'var(--mf-card)' } : { color: 'var(--mf-subtext)' }) }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M4 10h16M10 4v16" />
              </svg>
              {f.label}
            </button>
          );
        })}
      </div>

      <div
        ref={ref}
        data-embed-canvas
        onPointerDown={onDown}
        style={{
          position: 'relative',
          height,
          borderRadius: 10,
          background: 'var(--mf-panel)',
          backgroundImage: 'radial-gradient(var(--mf-note-bar-dot) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          overflow: 'hidden',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {(doc.zones ?? []).map((z) => (
            <div key={z.id} style={{ position: 'absolute', left: z.x, top: z.y, width: z.w, height: z.h, borderRadius: 12, border: `1.5px dashed ${z.color || 'var(--mf-border)'}`, background: 'transparent' }}>
              <span style={{ position: 'absolute', left: 8, top: -9, padding: '0 6px', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-subtext)', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{z.label}</span>
            </div>
          ))}
          {(doc.floats ?? []).map((f) => (
            <div
              key={f.id}
              style={{
                position: 'absolute',
                left: f.x,
                top: f.y,
                width: f.w,
                minHeight: f.h ?? 0,
                padding: '8px 10px',
                borderRadius: 10,
                background: f.bg || '#fff6cf',
                color: f.textColor || '#3a352f',
                fontSize: 12,
                fontWeight: f.bold ? 800 : 500,
                lineHeight: 1.5,
                boxShadow: '0 1px 2px rgba(46,42,38,.12)',
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {f.text}
            </div>
          ))}
        </div>

        {/* 줌 컨트롤 — 여기서 누른 것은 팬으로 번지지 않는다(스펙 §7.3). */}
        <div
          data-embed-zoom
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 999, background: 'var(--mf-card)', border: '1px solid var(--mf-border)', boxShadow: '0 4px 12px -6px rgba(46,42,38,.3)' }}
        >
          <button type="button" data-embed-zoom-out aria-label="축소" onClick={zoomBtn(0.9)} style={ZOOM_BTN}>
            −
          </button>
          <span style={{ minWidth: 38, textAlign: 'center', fontFamily: MONO, fontSize: 10.5, color: 'var(--mf-subtext)' }}>{Math.round(cam.z * 100)}%</span>
          <button type="button" data-embed-zoom-in aria-label="확대" onClick={zoomBtn(1.1)} style={ZOOM_BTN}>
            +
          </button>
          <span aria-hidden style={{ width: 1, height: 14, background: 'var(--mf-border)' }} />
          <button
            type="button"
            data-embed-fit
            onClick={() => {
              setCam(fitFrame(frame, box));
              setFitted(true);
            }}
            style={{ ...ZOOM_BTN, width: 'auto', padding: '0 8px', fontSize: 11 }}
          >
            맞춤
          </button>
        </div>
      </div>

      <GuideRow
        icon="eye"
        text="보기 전용 · 끌어서 움직이고 ⌘+휠로 확대해요"
        right={
          <Segments
            attr="data-embed-wbheight"
            height={20}
            value={view.height}
            options={[
              { v: 's', label: '작게' },
              { v: 'm', label: '중간' },
              { v: 'l', label: '크게' },
            ]}
            onPick={(v) => setView({ whiteboard: { height: v } })}
          />
        }
      />
    </>
  );
}

const ZOOM_BTN: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: 0,
  background: 'transparent',
  color: 'var(--mf-subtext)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

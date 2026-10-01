// 공책의 우측 **「기록」 탭**(기록 패널 스펙) — 누가 언제 무엇을 바꿨는지 날짜별 타임라인.
//
// - 패널 폭 400px(일정·댓글은 296px) · 요약 줄(최근 30일 + 편집한 사람 얼굴) · 날짜 그룹(헤어라인 +
//   아바타 뒤를 지나는 세로 연결선) · 항목(아바타 · 이름/시각 · 한 줄 요약 · 문구 diff · 지금 버전/되돌리기).
// - 항목을 누르면 본문이 그 시점의 페이지로 바뀐다(읽기 전용 미리보기 — 띠는 `NoteHistoryBand`).
// - 되돌리기는 확인 없이 곧바로(취소할 수 있으므로) — 토스트의 「취소」가 8초 동안 되돌린다. 다른 사람이
//   지금 이 공책에 있으면 덮이기 전에 한 번 묻는다.
// - 폰은 바텀 시트(최대 82%) · 되돌리기는 시트에서 항목을 눌러 미리보기로 들어간 뒤 띠에서만(스펙 §7).
//
// 데이터는 `NoteHistoryStore`가 준다(0048 — 서버). 내 저장이 남긴 항목은 기록기가 알려 주므로
// (`noteRecorder.subscribe`) 다시 읽지 않고 맨 위에 넣는다.

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotePage } from '@mindflow/mindmap-core';
import type { NoteHistoryEntry } from '../../../adapters/ports';
import { Modal } from '../../../components/Modal';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { peopleOf } from '../../../collab/presence';
import type { EditorController } from '../useEditorState';
import { clipDiff, diffChars, groupByDay, initialsOf, momentLabel, participantsOf, timeLabel } from '../noteHistory';

/** 스펙 §3·§5의 색 — 공책 팔레트(따뜻한 종이) 위에서 고른 값 그대로. */
const C = {
  panel: '#FBF7F1',
  edge: '#F1E7DB',
  body: '#FFFDFB',
  faint: '#A29B90',
  day: '#B7ACA1',
  hair: '#EFE4D9',
  line: '#EADFD3',
  name: '#3A352F',
  text: '#4A443D',
  ctx: '#6E675F',
  hover: '#F7F0E8',
  picked: '#FBEEDD',
  pickedEdge: '#E8A25F',
  delBg: '#FBEDE6',
  delFg: '#C0563A',
  insBg: '#EBF5EE',
  insFg: '#2F7D57',
  btnEdge: '#EDE2D6',
  btnInk: '#8A8078',
  btnEdgeHover: '#E7C7B4',
  tip: '#B0A69B',
};

export const HISTORY_PANEL_W = 400;

/** 되돌림 아이콘 — 복원 항목의 요약 앞(12px). */
function RestoreGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function Avatar({ name, color, avatar, size, ring, overlap, z }: { name: string; color: string; avatar?: string | null; size: number; ring: number; overlap?: number; z?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        color: '#fff',
        border: `${ring}px solid ${C.body}`,
        boxSizing: 'content-box',
        marginLeft: overlap ?? 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size >= 28 ? 11 : 9.5,
        fontWeight: 800,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        zIndex: z,
      }}
    >
      {initialsOf(name)}
      {avatar && !broken && <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
    </span>
  );
}

/** 문구 diff — 지운 글(빨강·취소선) · 추가한 글(초록) · 앞뒤 문맥(평문). 3줄(폰 2줄)에서 자른다. */
function DiffLine({ before, after, lines }: { before: string; after: string; lines: number }) {
  const { segs, more } = useMemo(() => clipDiff(diffChars(before, after)), [before, after]);
  const chip = (fg: string, bg: string, strike: boolean): CSSProperties => ({ background: bg, color: fg, textDecoration: strike ? 'line-through' : 'none', borderRadius: 3, padding: '0 3px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' });
  const out: ReactNode[] = [];
  segs.forEach((s, i) => {
    if (s.op === 'eq') out.push(<span key={i} style={{ color: C.ctx }}>{s.t}</span>);
    else {
      // 지움·추가 사이 공백 1칸(스펙 §5.3-3).
      if (s.op === 'ins' && segs[i - 1]?.op === 'del') out.push(' ');
      out.push(
        <span key={i} data-hist-diff={s.op} style={s.op === 'del' ? chip(C.delFg, C.delBg, true) : chip(C.insFg, C.insBg, false)}>
          {s.t}
        </span>,
      );
    }
  });
  if (more > 0) out.push(<span key="more" style={{ color: C.ctx }}>{` … 외 ${more}자`}</span>);
  return (
    <div data-hist-diff-line style={{ fontSize: 13, lineHeight: 1.6, color: C.ctx, display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
      {out}
    </div>
  );
}

function Row({
  entry,
  first,
  last,
  picked,
  canRestore,
  showRestore,
  mobile,
  now,
  onPick,
  onRestore,
}: {
  entry: NoteHistoryEntry;
  first: boolean;
  last: boolean;
  picked: boolean;
  canRestore: boolean;
  showRestore: boolean;
  mobile: boolean;
  now: number;
  onPick: () => void;
  onRestore: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const created = last && entry.kind === 'create';
  return (
    <div
      data-hist-entry={entry.id}
      data-hist-kind={entry.kind}
      data-hist-picked={picked ? '' : undefined}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '9px 12px 9px 4px',
        borderRadius: 14,
        background: picked ? C.picked : hover ? C.hover : first ? C.panel : 'transparent',
        boxShadow: picked ? `inset 2px 0 0 ${C.pickedEdge}` : 'none',
        cursor: 'pointer',
        outline: 'none',
        position: 'relative',
      }}
    >
      <span style={{ marginLeft: -3, flexShrink: 0, display: 'inline-flex', position: 'relative', zIndex: 1 }}>
        <Avatar name={entry.actor.name || '알 수 없음'} color={entry.actor.color || '#B7ACA1'} avatar={entry.actor.avatar} size={30} ring={3} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 5 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.015em', color: C.name, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.actor.name || '알 수 없음'}</span>
          <span style={{ flex: 1 }} />
          <span data-hist-time style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, color: C.day, flexShrink: 0 }}>{timeLabel(entry.at, now)}</span>
        </div>
        <div data-hist-summary style={{ fontSize: 13.5, lineHeight: 1.6, color: C.text, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
          {entry.kind === 'restore' && (
            <span style={{ color: C.btnInk, marginRight: 5, display: 'inline-flex', verticalAlign: '-1px' }}>
              <RestoreGlyph />
            </span>
          )}
          {entry.summary}
        </div>
        {entry.diff && (entry.diff.before || entry.diff.after) && <DiffLine before={entry.diff.before} after={entry.diff.after} lines={mobile ? 2 : 3} />}
        {(first || (showRestore && canRestore && !created)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
            {first ? (
              <span data-hist-now style={{ height: 22, padding: '0 9px', borderRadius: 99, background: C.delBg, color: C.delFg, fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>
                지금 버전
              </span>
            ) : (
              <button
                type="button"
                data-hist-restore={entry.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
                onMouseEnter={() => setBtnHover(true)}
                onMouseLeave={() => setBtnHover(false)}
                style={{ height: 26, padding: '0 11px', borderRadius: 99, border: `1px solid ${btnHover ? C.btnEdgeHover : C.btnEdge}`, background: C.body, color: btnHover ? C.name : C.btnInk, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
              >
                이 시점으로 되돌리기
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 되돌린 뒤 8초 — `취소`가 되돌리기 전으로. */
interface Undo {
  pageId: string;
  prev: NotePage | null;
  label: string;
}

export function NoteHistoryPanel({ controller }: { controller: EditorController }) {
  const mobile = useIsMobile();
  const page = controller.notePage;
  const pageId = page?.id ?? null;
  const docId = controller.docId;
  const store = controller.noteHistoryStore;
  const canRestore = !controller.readOnly;
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<NoteHistoryEntry | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // `방금` → `HH:mm`이 저절로 넘어가게 30초마다 시계를 갱신한다.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // 그 페이지의 기록 — 장이 바뀌거나 서버 판을 채택했을 때(`docEpoch`) 다시 읽는다.
  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    store
      .list(docId, pageId, { limit: 100 })
      .then((res) => {
        if (!alive) return;
        setEntries(res.entries);
        setHasMore(res.hasMore);
        setNow(Date.now());
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [store, docId, pageId, controller.docEpoch]);

  // 내 저장이 남긴 항목 — 맨 위에 넣거나(새 항목) 그 자리에서 고친다(묶음 안의 연속 편집).
  // 목록이 아래로 밀리지 않게 스크롤을 보정한다(스펙 §6.3).
  useEffect(
    () =>
      controller.noteRecorder.subscribe((e) => {
        if (e.pageId !== pageId) return;
        const el = scrollRef.current;
        const before = el?.scrollHeight ?? 0;
        setEntries((cur) => {
          const i = cur.findIndex((x) => x.id === e.id);
          if (i >= 0) return [...cur.slice(0, i), { ...cur[i]!, ...e }, ...cur.slice(i + 1)].sort((a, b) => b.at - a.at);
          return [e, ...cur];
        });
        setNow(Date.now());
        if (el && el.scrollTop > 0) requestAnimationFrame(() => (el.scrollTop += el.scrollHeight - before));
      }),
    [controller.noteRecorder, pageId],
  );

  const loadMore = useCallback(() => {
    const last = entries[entries.length - 1];
    if (!pageId || !last) return;
    void store
      .list(docId, pageId, { before: last.at, limit: 100 })
      .then((res) => {
        setEntries((cur) => [...cur, ...res.entries.filter((e) => !cur.some((x) => x.id === e.id))]);
        setHasMore(res.hasMore);
      })
      .catch(() => undefined);
  }, [entries, store, docId, pageId]);

  const people = useMemo(() => participantsOf(entries), [entries]);
  const groups = useMemo(() => groupByDay(entries, now), [entries, now]);
  const picked = controller.notePreview?.entry.id ?? null;

  const doRestore = useCallback(
    (entry: NoteHistoryEntry) => {
      const pid = (entry.snapshot as { id?: string } | null)?.id ?? entry.pageId;
      const prev = controller.restoreNotePage(entry);
      const label = momentLabel(entry.at, Date.now());
      window.clearTimeout(undoTimer.current);
      setUndo({ pageId: pid, prev, label });
      undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
    },
    [controller],
  );
  /** 되돌리기 — 지금 다른 사람이 이 공책에 있으면 덮이기 전에 묻는다(스펙 §6.2). */
  const askRestore = useCallback(
    (entry: NoteHistoryEntry) => {
      if (!canRestore) return;
      if (peopleOf(controller.presence.peers, controller.presence.localUser).length) setConfirm(entry);
      else doRestore(entry);
    },
    [canRestore, controller.presence, doRestore],
  );
  // 미리보기 띠의 「이 버전으로 되돌리기」도 같은 길을 탄다.
  useEffect(() => {
    const onRestore = (e: Event): void => {
      const entry = (e as CustomEvent<NoteHistoryEntry>).detail;
      if (entry) askRestore(entry);
    };
    window.addEventListener('mf-note-history-restore', onRestore);
    return () => window.removeEventListener('mf-note-history-restore', onRestore);
  }, [askRestore]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const editingName = peopleOf(controller.presence.peers, controller.presence.localUser)[0]?.user.name ?? '다른 사람';
  // 폰은 미리보기 동안 시트를 내린다 — 본문(그때 모습)과 띠가 보여야 한다. 닫기로 미리보기를 끝내면 다시 뜬다.
  const sheetHidden = mobile && !!controller.notePreview;

  const close = (): void => controller.setHistoryOpen(false);

  const summaryRow = (
    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px 6px', gap: 10 }}>
      {mobile && <span style={{ fontSize: 20, fontWeight: 800, color: C.name, letterSpacing: '-.02em' }}>기록</span>}
      <span style={{ fontSize: 12.5, color: C.faint }}>최근 30일</span>
      <span style={{ flex: 1 }} />
      <span data-hist-people style={{ display: 'inline-flex', alignItems: 'center' }}>
        {people.slice(0, people.length > 4 ? 3 : 4).map((a, i) => (
          <Avatar key={a.id || a.name} name={a.name} color={a.color} avatar={a.avatar} size={24} ring={2} overlap={i ? (mobile ? -7 : -6) : 0} />
        ))}
        {people.length > 4 && (
          <span style={{ width: 24, height: 24, borderRadius: 999, background: C.line, color: C.ctx, border: `2px solid ${C.body}`, boxSizing: 'content-box', marginLeft: mobile ? -7 : -6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800 }}>
            +{people.length - 3}
          </span>
        )}
      </span>
      {!mobile && (
        <button type="button" aria-label="기록 닫기" title="닫기" onClick={close} style={{ width: 26, height: 26, marginLeft: 4, border: 0, borderRadius: 8, background: 'transparent', color: C.btnInk, cursor: 'pointer', fontSize: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          ✕
        </button>
      )}
    </div>
  );

  const body = (
    <div ref={scrollRef} className="mf-hist-scroll" data-hist-scroll style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 14px 18px', display: 'flex', flexDirection: 'column', background: C.body }}>
      {loading && !entries.length && <div style={{ padding: '24px 8px', fontSize: 12.5, color: C.tip }}>기록을 불러오는 중…</div>}
      {failed && !entries.length && <div style={{ padding: '24px 8px', fontSize: 12.5, color: C.tip }}>기록을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.</div>}
      {!loading && !failed && !entries.length && <div data-hist-empty style={{ padding: '24px 8px', fontSize: 12.5, lineHeight: 1.6, color: C.tip }}>아직 기록이 없어요. 이 페이지를 고치면 여기에 남아요.</div>}
      {groups.map((g, gi) => (
        <section key={g.key} data-hist-group={g.label} className="mf-hist-fade">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 4px 8px' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.day, whiteSpace: 'nowrap' }}>{g.label}</span>
            <span style={{ flex: 1, height: 1, background: C.hair }} />
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* 세로 연결선 — 아바타 뒤로 지나가고, 아바타의 흰 테두리가 선을 끊어 보이게 한다. */}
            {g.entries.length > 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 19, top: 14, bottom: 14, width: 1.5, background: C.line }} />}
            {g.entries.map((e, i) => {
              const flat = groups.slice(0, gi).reduce((n, x) => n + x.entries.length, 0) + i;
              const older = entries[flat + 1] ?? null;
              return (
                <Row
                  key={e.id}
                  entry={e}
                  first={flat === 0}
                  last={flat === entries.length - 1 && !hasMore}
                  picked={picked === e.id}
                  canRestore={canRestore}
                  showRestore={!mobile}
                  mobile={mobile}
                  now={now}
                  onPick={() => (picked === e.id ? controller.closeNotePreview() : controller.openNotePreview(e, older, flat === 0))}
                  onRestore={() => askRestore(e)}
                />
              );
            })}
          </div>
        </section>
      ))}
      {hasMore && (
        <button type="button" data-hist-more onClick={loadMore} style={{ marginTop: 12, alignSelf: 'center', height: 30, padding: '0 14px', borderRadius: 99, border: `1px solid ${C.btnEdge}`, background: C.body, color: C.btnInk, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          30일 이전 기록 보기
        </button>
      )}
      <p data-hist-tip style={{ margin: 0, padding: '16px 8px 0', fontSize: 12, lineHeight: 1.5, color: C.tip }}>
        {canRestore ? '항목을 누르면 그때 모습을 미리 보고, 그 자리에서 되돌릴 수 있어요. 되돌리기 전 내용도 기록에 남아요.' : '항목을 누르면 그때 모습을 볼 수 있어요.'}
      </p>
    </div>
  );

  return (
    <>
      {!sheetHidden &&
        (mobile ? (
          <>
            <div aria-hidden="true" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(46,42,38,.28)' }} />
            <aside data-note-history aria-label="기록" className="mf-hist-fade" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61, maxHeight: '82%', display: 'flex', flexDirection: 'column', background: C.body, borderRadius: '20px 20px 0 0', boxShadow: '0 -18px 40px -20px rgba(46,42,38,.45)', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <span aria-hidden="true" style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 99, background: C.line, marginTop: 8 }} />
              {summaryRow}
              {body}
            </aside>
          </>
        ) : (
          <aside
            data-note-history
            aria-label="기록"
            className="mf-hist-fade"
            style={{ flex: `0 0 ${HISTORY_PANEL_W}px`, maxWidth: '86%', minWidth: 0, display: 'flex', flexDirection: 'column', background: C.panel, borderLeft: `1px solid ${C.edge}`, boxShadow: '-18px 0 34px -22px rgba(46,42,38,.4)', overflow: 'hidden', position: 'relative', zIndex: 2 }}
          >
            {summaryRow}
            {body}
          </aside>
        ))}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        label="되돌리기 확인"
        card={{ width: 340, maxWidth: 'calc(100vw - 32px)', padding: 20, borderRadius: 16, background: C.body, boxSizing: 'border-box' }}
        cardAttrs={{ 'data-hist-confirm': '' }}
      >
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.6, color: C.name, wordBreak: 'keep-all' }}>
          지금 {editingName} 님이 편집 중이에요. 되돌리면 그 내용이 덮여요.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => setConfirm(null)} style={{ height: 34, padding: '0 14px', borderRadius: 10, border: `1px solid ${C.btnEdge}`, background: C.body, color: C.btnInk, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
            취소
          </button>
          <button
            type="button"
            data-hist-confirm-ok
            onClick={() => {
              const e = confirm;
              setConfirm(null);
              if (e) doRestore(e);
            }}
            style={{ height: 34, padding: '0 14px', borderRadius: 10, border: 0, background: 'var(--mf-accent, #E0663F)', color: '#fff', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            되돌리기
          </button>
        </div>
      </Modal>
      {undo && (
        <div
          role="status"
          data-hist-toast
          style={{ position: 'fixed', left: '50%', bottom: mobile ? 92 : 28, transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100vw - 32px)', padding: '10px 10px 10px 16px', borderRadius: 14, background: '#2E2A26', color: '#FBF7F1', fontSize: 13, lineHeight: 1.45, boxShadow: '0 14px 34px rgba(0,0,0,.24)' }}
        >
          <span style={{ wordBreak: 'keep-all' }}>{undo.label} 시점으로 되돌렸어요 · 되돌리기 전 내용도 기록에 남아요</span>
          <button
            type="button"
            data-hist-undo
            onClick={() => {
              controller.undoNoteRestore(undo.pageId, undo.prev);
              window.clearTimeout(undoTimer.current);
              setUndo(null);
            }}
            style={{ flexShrink: 0, height: 30, padding: '0 12px', borderRadius: 10, border: 0, background: 'rgba(255,255,255,.12)', color: '#FFD9C4', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            취소
          </button>
        </div>
      )}
    </>
  );
}

/**
 * 미리보기 띠(스펙 §6.1) — 본문 위 40px · `9월 15일 16:20 버전을 보는 중` · 되돌리기 · 닫기.
 * 되돌리기는 패널과 **같은 길**(다른 사람이 있으면 묻기)을 타도록 이벤트로 넘긴다.
 */
export function NoteHistoryBand({ controller }: { controller: EditorController }) {
  const preview = controller.notePreview;
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        controller.closeNotePreview();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [preview, controller]);
  if (!preview) return null;
  return (
    <div data-hist-band style={{ flex: '0 0 auto', height: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 18px', background: '#FBF3E4', borderBottom: '1px solid #EBD9B8', boxSizing: 'border-box' }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: '#8A6A2E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{momentLabel(preview.entry.at, Date.now())} 버전을 보는 중</span>
      <span style={{ flex: 1 }} />
      {!controller.readOnly && !preview.latest && (
        <button
          type="button"
          data-hist-band-restore
          onClick={() => window.dispatchEvent(new CustomEvent('mf-note-history-restore', { detail: preview.entry }))}
          style={{ height: 28, padding: '0 12px', borderRadius: 99, border: 0, background: 'var(--mf-accent, #E0663F)', color: '#fff', fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          이 버전으로 되돌리기
        </button>
      )}
      <button type="button" data-hist-band-close onClick={controller.closeNotePreview} style={{ height: 28, padding: '0 10px', borderRadius: 99, border: '1px solid #EBD9B8', background: 'transparent', color: '#8A6A2E', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        닫기
      </button>
    </div>
  );
}

/**
 * 미리보기 중 **그 항목에서 바뀐 블록**에 테두리(스펙 §6.1 — `#E8A25F` 1.5px)를 두르고, 강조 블록을
 * 보이는 자리로 굴린다. 본문은 블록을 여러 갈래로 그리므로(`data-note-block`) 하나하나에 속성을
 * 넘기는 대신 선택자 한 벌을 심는다.
 */
/** 속성 선택자 안의 값 — 블록 id는 영숫자지만 따옴표·역슬래시만은 막아 둔다. */
const attr = (v: string): string => v.replace(/["\\]/g, '\\$&');

export function NoteHistoryMarks({ controller }: { controller: EditorController }) {
  const preview = controller.notePreview;
  const ids = preview ? [...preview.marks] : [];
  const key = ids.join(' ');
  useEffect(() => {
    if (!preview) return;
    const first = preview.entry.anchor ?? ids[0];
    if (!first) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-note-block="${attr(first)}"]`);
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 60);
    return () => window.clearTimeout(t);
    // 고른 항목이 바뀔 때만 굴린다(같은 항목에서 다시 그려질 때마다 튀지 않게).
  }, [preview?.entry.id]);
  if (!preview || !ids.length) return null;
  const sel = ids.map((id) => `[data-note-block="${attr(id)}"]`).join(',');
  return <style data-hist-marks={key}>{`${sel}{outline:1.5px solid #E8A25F;outline-offset:4px;border-radius:8px}`}</style>;
}

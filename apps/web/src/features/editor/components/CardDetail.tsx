// 카드 상세 — 제목과 곁정보(상태·담당·기한·분류·색·긴급)를 한자리에서.
//
// 디자인 원본(`Geurio 칸반보드.dc.html`)의 카드 모달을 옮긴 것이다. 원본이 고정
// 표로 들고 있던 담당 명단은 이 문서의 **공유 참가자**(0011)로 바꿨고, 댓글은
// 원본의 간단한 로그 대신 **이미 있는 댓글 기능**(0020~0021: 스레드·멘션·해결·
// 실시간)으로 넘긴다 — 같은 것을 두 벌로 두면 어느 쪽이 진짜인지 흐려진다.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { richToMarkdown } from '@mindflow/mindmap-core';
import type { KanbanCard } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import { useShareStore } from '../../../adapters/BackendContext';
import type { ShareParticipant } from '../../../adapters/ports';
import { CARD_LABELS, cardLabelName } from '../kanbanLabels';
import { DEFAULT_TAGS, columnColor } from '../kanbanMeta';
import { Avatar } from './KanbanBoard';

export function CardDetail({ card, controller, theme: th, isMobile }: { card: KanbanCard; controller: EditorController; theme: Theme; isMobile: boolean }) {
  const readOnly = controller.readOnly;
  const shareStore = useShareStore();
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);
  const [title, setTitle] = useState(() => richToMarkdown(card));
  const titleRef = useRef(title);
  titleRef.current = title;
  const cardIdRef = useRef(card.id);
  cardIdRef.current = card.id;
  const columns = controller.columns;
  const col = columns.find((c) => c.id === card.col);
  const colIndex = columns.findIndex((c) => c.id === card.col);
  const comments = controller.canComment ? (controller.commentCounts[card.id] ?? 0) : 0;

  /** 제목은 닫을 때 한 번 저장한다 — 글자마다 커밋하면 undo 단계가 타이핑 수만큼 쌓인다. */
  const commitTitle = useCallback(() => {
    if (readOnly) return;
    const next = titleRef.current;
    if (next.trim() === richToMarkdown(card).trim()) return;
    controller.commitCardText(cardIdRef.current, next);
  }, [card, controller, readOnly]);

  const close = useCallback(() => {
    commitTitle();
    controller.openCardDetail(null);
  }, [commitTitle, controller]);

  // 담당 후보 — 이 문서의 참가자(소유자 + 초대받은 사람). 댓글 멘션과 같은 출처다.
  useEffect(() => {
    let alive = true;
    void shareStore.listParticipants(controller.docId).then((rows: ShareParticipant[] | null) => {
      if (alive && rows) setParticipants(rows);
    });
    return () => {
      alive = false;
    };
  }, [shareStore, controller.docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const label: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: th.subtext };
  const chip = (on: boolean): CSSProperties => ({
    height: isMobile ? 34 : 30,
    padding: '0 12px',
    borderRadius: 999,
    border: `1px solid ${on ? th.accent : th.border}`,
    background: on ? hexA(th.accent, 0.12) : th.panel,
    color: on ? th.accent : th.subtext,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });

  return (
    <div
      data-card-detail-veil
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 340, background: hexA('#2e2a26', 0.34), display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 28 }}
    >
      <div
        data-card-detail={card.id}
        role="dialog"
        aria-label="카드 상세"
        style={{
          width: isMobile ? '100%' : 'min(640px, 100%)',
          maxHeight: isMobile ? '88vh' : '86vh',
          overflow: 'auto',
          borderRadius: isMobile ? '18px 18px 0 0' : 20,
          background: th.panel,
          border: `1px solid ${th.border}`,
          boxShadow: '0 40px 90px -40px rgba(0,0,0,.6)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 18px', borderBottom: `1px solid ${th.border}`, position: 'sticky', top: 0, background: th.panel, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: col ? columnColor(col, colIndex, th.palette) : th.border, flex: '0 0 auto' }} />
            <span data-detail-column style={{ fontSize: 12.5, fontWeight: 600, color: th.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col?.title ?? '사라진 열'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!readOnly && (
              <button
                type="button"
                data-detail-delete
                onClick={() => {
                  controller.deleteCard(card.id);
                  controller.openCardDetail(null);
                }}
                style={{ height: isMobile ? 36 : 30, padding: '0 11px', borderRadius: 8, border: `1px solid ${th.border}`, background: th.panel, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', color: th.subtext, cursor: 'pointer' }}
              >
                삭제
              </button>
            )}
            <button
              type="button"
              data-detail-close
              aria-label="닫기"
              title="닫기"
              onClick={close}
              style={{ width: isMobile ? 36 : 30, height: isMobile ? 36 : 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `1px solid ${th.border}`, background: th.panel, color: th.subtext, cursor: 'pointer', padding: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ padding: '18px 18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 제목 — 마크다운 원문으로 열고(카드 렌더와 같은 왕복) Enter로 저장·닫기. */}
          <textarea
            className="mf-edit"
            data-detail-title
            value={title}
            readOnly={readOnly}
            rows={2}
            autoFocus={!readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                close();
              }
            }}
            style={{ width: '100%', border: `1px solid ${th.border}`, borderRadius: 10, padding: '8px 10px', outline: 'none', resize: 'none', background: th.panel, fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.4, color: th.text, fontFamily: 'inherit', boxSizing: 'border-box' }}
          />

          <Section label="상태" style={label}>
            {columns.map((c, i) => {
              const on = c.id === card.col;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-detail-status={c.id}
                  disabled={readOnly}
                  onClick={() => !on && controller.moveCardTo(card.id, c.id, 0)}
                  style={chip(on)}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: columnColor(c, i, th.palette), display: 'block' }} />
                  {c.title}
                </button>
              );
            })}
          </Section>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <Section label="담당" style={label}>
              <button
                type="button"
                data-detail-owner="none"
                disabled={readOnly}
                aria-label="담당 없음"
                title="담당 없음"
                onClick={() => controller.setCardMeta(card.id, { owner: null })}
                style={{ width: 30, height: 30, borderRadius: 999, border: card.owner ? `1px solid ${th.border}` : `2px solid ${th.accent}`, background: th.panel, color: th.subtext, cursor: 'pointer', fontSize: 12, padding: 0 }}
              >
                －
              </button>
              {participants.map((p) => {
                const name = p.displayName?.trim() || (p.email.split('@')[0] as string);
                const on = (card.owner ?? '') === p.email;
                return (
                  <button
                    key={p.email}
                    type="button"
                    data-detail-owner={p.email}
                    disabled={readOnly}
                    aria-label={name}
                    title={`${name}${p.joined ? '' : ' (가입 대기)'}`}
                    onClick={() => controller.setCardMeta(card.id, { owner: { email: p.email, name } })}
                    style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', lineHeight: 0, opacity: p.joined ? 1 : 0.6 }}
                  >
                    <Avatar name={name} email={p.email} size={30} ring={on ? th.accent : 'transparent'} />
                  </button>
                );
              })}
              {!participants.length && <span style={{ fontSize: 12.5, color: th.subtext }}>공유한 사람이 없어요</span>}
            </Section>

            <Section label="기한" style={label}>
              <input
                className="mf-edit"
                type="date"
                data-detail-due
                value={card.due ?? ''}
                readOnly={readOnly}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => controller.setCardMeta(card.id, { due: e.target.value || null })}
                style={{ height: isMobile ? 40 : 34, padding: '0 11px', borderRadius: 9, border: `1px solid ${th.border}`, background: th.panel, outline: 'none', fontSize: 13, color: th.text, fontFamily: 'inherit' }}
              />
              {card.due && !readOnly && (
                <button type="button" data-detail-due-clear onClick={() => controller.setCardMeta(card.id, { due: null })} style={{ ...chip(false), height: isMobile ? 40 : 34 }}>
                  지우기
                </button>
              )}
            </Section>
          </div>

          <Section label="분류" style={label}>
            <button type="button" data-detail-tag="none" aria-label="분류 없음" disabled={readOnly} onClick={() => controller.setCardMeta(card.id, { tag: null })} style={chip(!card.tag)}>
              없음
            </button>
            {DEFAULT_TAGS.map((t) => (
              <button key={t} type="button" data-detail-tag={t} disabled={readOnly} onClick={() => controller.setCardMeta(card.id, { tag: t })} style={chip(card.tag === t)}>
                {t}
              </button>
            ))}
            {/* 직접 적은 분류도 그대로 쓴다 — 색은 이름에서 정해지므로 목록에 없어도 된다. */}
            {card.tag && !DEFAULT_TAGS.includes(card.tag) && (
              <span data-detail-tag-custom style={chip(true)}>
                {card.tag}
              </span>
            )}
            {!readOnly && <TagInput theme={th} isMobile={isMobile} onCommit={(t) => controller.setCardMeta(card.id, { tag: t })} />}
          </Section>

          <Section label="색" style={label}>
            {CARD_LABELS.map((l) => {
              const on = (card.bg ?? null) === l.bg;
              return (
                <button
                  key={l.name}
                  type="button"
                  data-detail-color={l.name}
                  disabled={readOnly}
                  aria-label={l.bg ? `색 ${l.name}` : '색 없음'}
                  title={l.name}
                  onClick={() => controller.setCardBg(card.id, l.bg)}
                  style={{
                    width: isMobile ? 32 : 26,
                    height: isMobile ? 32 : 26,
                    borderRadius: 999,
                    background: l.bg || 'transparent',
                    backgroundImage: l.bg ? undefined : `linear-gradient(to top right, transparent calc(50% - 1px), ${th.subtext} calc(50% - 1px), ${th.subtext} calc(50% + 1px), transparent calc(50% + 1px))`,
                    border: on ? `2px solid ${th.accent}` : `1px solid ${th.border}`,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              );
            })}
            <span style={{ fontSize: 12, color: th.subtext, alignSelf: 'center' }}>{cardLabelName(card.bg)}</span>
          </Section>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 11, border: `1px solid ${th.border}`, background: th.panel2, cursor: readOnly ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              data-detail-flag
              checked={!!card.flagged}
              disabled={readOnly}
              onChange={(e) => controller.setCardMeta(card.id, { flagged: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'inherit' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: th.text }}>긴급으로 표시</span>
            <span style={{ fontSize: 12, color: th.subtext }}>보드에서 붉은 배지가 붙어요</span>
          </label>

          {/* 댓글은 이 앱의 댓글 기능이 맡는다(스레드·멘션·해결·실시간) — 여기서는
              몇 개인지 알리고 그리로 보낸다. 모달과 패널이 함께 떠 있으면 좁은
              화면에서 서로 자리를 다툰다. */}
          {controller.canComment && (
            <button
              type="button"
              data-detail-comments
              onClick={() => {
                commitTitle();
                controller.openCardDetail(null);
                controller.openComments(card.id);
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '12px 13px', borderRadius: 11, border: `1px solid ${th.border}`, background: th.panel, color: th.text, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <span>댓글 {comments}</span>
              <span style={{ color: th.subtext, fontSize: 12.5 }}>열기 ›</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, style, children }: { label: string; style: CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={style}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

/** 직접 적는 분류 — Enter로 넣는다(색은 이름에서 정해지므로 등록 절차가 없다). */
function TagInput({ theme: th, isMobile, onCommit }: { theme: Theme; isMobile: boolean; onCommit: (t: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <input
      className="mf-edit"
      data-detail-tag-input
      value={val}
      maxLength={24}
      placeholder="직접 입력"
      aria-label="분류 직접 입력"
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const t = e.currentTarget.value.trim();
          if (t) onCommit(t);
          setVal('');
        }
      }}
      style={{ width: 96, height: isMobile ? 34 : 30, padding: '0 10px', borderRadius: 999, border: `1px dashed ${th.border}`, background: 'transparent', color: th.text, fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
    />
  );
}

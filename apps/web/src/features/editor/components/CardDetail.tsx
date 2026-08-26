// 카드 상세 — 제목과 곁정보(상태·담당·기한·분류·색·긴급), 그리고 그 카드의 논의.
//
// 시안 개정판(첨부 이미지)을 옮긴 것이다: **두 단**으로 갈라 왼쪽은 카드의 값,
// 오른쪽은 댓글이다. 머리에는 지금 열·저장 상태, 바닥에는 "자동으로 저장돼요"와
// `완료`를 둔다 — 담긴 기능은 예전과 같고 자리만 바뀌었다(요청).
//
// 댓글은 이 앱의 댓글 기능(0020~0021: 스레드·멘션·좋아요·실시간)을 그대로 쓴다 —
// 같은 것을 두 벌로 두면 어느 쪽이 진짜인지 흐려진다. 담당 명단은 원본의 고정 표가
// 아니라 이 문서의 **공유 참가자**(0011)다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/Modal';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { richToMarkdown } from '@mindflow/mindmap-core';
import type { KanbanCard } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { hexA, mixHex } from '../theme';
import type { Theme } from '../theme';
import { useShareStore } from '../../../adapters/BackendContext';
import type { ShareParticipant } from '../../../adapters/ports';
import { CARD_LABELS, cardLabelName } from '../kanbanLabels';
import { boardSurface, columnColor, tagColor } from '../kanbanMeta';
import { SwatchGroup } from '../../../components/Swatch';
import { Avatar } from './KanbanBoard';
import { CommentIcon } from './ToolbarMenus';
import { CommentThreads } from './CommentPanel';

/** 저장 상태 칩의 색 — 저장됨(초록)·저장 중(호박)·그 밖(중립). 테마와 무관하게
 *  "됐다/하는 중"으로 읽혀야 하는 신호다(문서 칩과 같은 값). */
const SAVE_TONE: Record<string, string> = { saved: '#3fae6a', saving: '#e0b23c' };

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
  /** 지금 카드에 걸린 분류의 목록 항목 — 색을 고칠 대상. */
  const activeTag = card.tag ? controller.tags.find((t) => t.name === card.tag) : undefined;

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

  // Esc·바깥 클릭·초점 트랩은 `Modal`(Radix Dialog)이 맡는다 — 예전에는 캔반 단축키로
  // 새지 않게 capture 리스너를 직접 달았다.

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
  /** 머리·바닥의 알약 버튼(시안) — 테두리만 있는 담담한 꼴. */
  const headBtn: CSSProperties = {
    height: isMobile ? 36 : 32,
    padding: '0 13px',
    borderRadius: 999,
    border: `1px solid ${th.border}`,
    background: th.panel,
    color: th.subtext,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
  const saveState = controller.saveState;
  const saveTone = SAVE_TONE[saveState] ?? th.subtext;
  const saveLabel = readOnly ? '보기 전용' : saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중…' : saveState === 'unsaved' ? '저장 전' : '변경됨';

  return (
    <Modal
      open
      onClose={close}
      label="카드 상세"
      dim={{
        animation: 'mf-dim-in .18s ease-out both',
        zIndex: 340,
        background: hexA('#2e2a26', 0.4),
        alignItems: isMobile ? 'flex-end' : 'center',
        padding: isMobile ? 0 : 28,
      }}
      dimAttrs={{ 'data-card-detail-veil': '' }}
      cardAttrs={{ 'data-card-detail': card.id }}
      cardClass={isMobile ? 'mf-kb-sheet' : 'mf-kb-modal'}
      card={{
          // 두 단이므로 넓다 — 좁은 화면에서는 한 단으로 접힌다.
          width: isMobile ? '100%' : 'min(1080px, 100%)',
          maxHeight: isMobile ? '88vh' : '86vh',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderRadius: isMobile ? '18px 18px 0 0' : 20,
          background: th.panel,
          border: `1px solid ${th.border}`,
          boxShadow: '0 40px 90px -40px rgba(0,0,0,.6)',
          boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <>
        {/* 머리 — [열 · 저장 상태] / [삭제 · 닫기] */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: isMobile ? '13px 15px' : '14px 18px', borderBottom: `1px solid ${th.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: col ? columnColor(col, colIndex, th.palette) : th.border, flex: '0 0 auto' }} />
            <span data-detail-column style={{ fontSize: 12.5, fontWeight: 600, color: th.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col?.title ?? '사라진 열'}</span>
            {/* 저장 상태 — 바닥의 "자동으로 저장돼요"가 약속이고, 이 칩이 그 결과다. */}
            <span
              data-detail-save
              style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 999, background: hexA(saveTone, 0.14), color: saveTone, fontSize: 11, fontWeight: 700 }}
            >
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: saveTone }} />
              {saveLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!readOnly && (
              <button
                type="button"
                className="mf-ed-btn mf-ed-danger"
                data-detail-delete
                onClick={() => {
                  controller.deleteCard(card.id);
                  controller.openCardDetail(null);
                }}
                style={headBtn}
              >
                삭제
              </button>
            )}
            <button
              type="button"
              className="mf-ed-btn"
              data-detail-close
              aria-label="닫기"
              title="닫기"
              onClick={close}
              style={{ ...headBtn, width: isMobile ? 36 : 32, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 본문 — 두 단(왼쪽 값 / 오른쪽 논의). 좁은 화면에서는 위아래로 쌓인다. */}
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: isMobile ? 'auto' : 'hidden' }}>
          <div
            data-detail-main
            style={{ flex: isMobile ? '0 0 auto' : '1 1 auto', minWidth: 0, minHeight: 0, overflow: isMobile ? 'visible' : 'auto', padding: isMobile ? '16px 15px 18px' : '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {/* 제목 — 마크다운 원문으로 열고(카드 렌더와 같은 왕복) Enter로 저장·닫기.
                시안처럼 **테두리 없는 큰 글자**로 두고, 포커스에서만 상자가 보인다. */}
            <textarea
              className="mf-edit mf-kb-title"
              data-detail-title
              value={title}
              readOnly={readOnly}
              rows={2}
              // 폰에서는 포커스를 주지 않는다 — 열자마자 소프트 키보드가 올라와
              // 시트를 반쯤 밀어 올리고(제목이 잘려 보였다) 값을 훑어보기 어렵다.
              autoFocus={!readOnly && !isMobile}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  close();
                }
              }}
              style={{ ['--mf-kb-title-line' as string]: th.border, flex: '0 0 auto', width: '100%', border: '1px solid transparent', borderRadius: 10, padding: '4px 8px', marginLeft: -8, outline: 'none', resize: 'none', background: 'transparent', fontSize: isMobile ? 20 : 22, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.35, color: th.text, fontFamily: 'inherit', boxSizing: 'border-box' }}
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

            {/* 시작일 · 기한 — 상태 바로 아래다(요청): "언제 하는 일인가"가
                상태 다음으로 먼저 읽히고, 담당은 그 아래로 내려간다. 타임라인
                막대가 이 둘 사이를 그린다(시작일이 없으면 오늘부터). 지우기는
                **항상 자리를 지킨다** — 값이 없으면 비활성: 버튼이 떴다 사라지면
                그 줄의 폭이 들썩인다. */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14, minWidth: 0 }}>
              <DateField
                label="시작일"
                value={card.start ?? ''}
                attr="start"
                theme={th}
                isMobile={isMobile}
                readOnly={readOnly}
                labelStyle={label}
                chipStyle={chip(false)}
                onChange={(v) => controller.setCardMeta(card.id, { start: v })}
              />
              <DateField
                label="기한"
                value={card.due ?? ''}
                attr="due"
                theme={th}
                isMobile={isMobile}
                readOnly={readOnly}
                labelStyle={label}
                chipStyle={chip(false)}
                onChange={(v) => controller.setCardMeta(card.id, { due: v })}
              />
            </div>

            {/* 담당 — 아바타가 여러 개라 한 줄을 통째로 쓴다(요청: 하단으로). */}
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
                    <Avatar name={name} email={p.email} size={30} ring={on ? th.accent : 'transparent'} src={p.avatarUrl ?? null} />
                  </button>
                );
              })}
              {!participants.length && <span style={{ fontSize: 12.5, color: th.subtext }}>공유한 사람이 없어요</span>}
            </Section>

            {/* 분류 — 문서가 목록을 들고 있다. 기본은 **없음**뿐이고, 직접 적어
                추가하면 목록에 남는다. 색은 이름에서 자동으로 붙되, 고른 분류의
                스와치 줄에서 바꾸면 그 색이 문서에 저장된다(테마를 바꿔도 유지). */}
            <Section label="분류" style={label}>
              <button type="button" data-detail-tag="none" aria-label="분류 없음" disabled={readOnly} onClick={() => controller.setCardMeta(card.id, { tag: null })} style={chip(!card.tag)}>
                없음
              </button>
              {controller.tags.map((t) => {
                const on = card.tag === t.name;
                const c = tagColor(t.name, th.palette, controller.tags);
                return (
                  <span key={t.id} data-detail-tag-wrap={t.name} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <button
                      type="button"
                      data-detail-tag={t.name}
                      disabled={readOnly}
                      onClick={() => controller.setCardMeta(card.id, { tag: t.name })}
                      style={{
                        ...chip(on),
                        paddingRight: readOnly ? undefined : 6,
                        borderColor: on ? c : th.border,
                        background: on ? hexA(c, 0.14) : th.panel,
                        color: on ? c : th.subtext,
                        gap: 7,
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: c, display: 'block' }} />
                      {t.name}
                      {!readOnly && (
                        <span
                          role="button"
                          tabIndex={-1}
                          data-detail-tag-remove={t.name}
                          aria-label={`분류 '${t.name}' 삭제`}
                          title="이 분류 삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            controller.removeTag(t.id);
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, color: th.subtext, cursor: 'pointer' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  </span>
                );
              })}
              {!readOnly && (
                <TagInput
                  theme={th}
                  isMobile={isMobile}
                  onCommit={(t) => {
                    controller.addTag(t);
                    controller.setCardMeta(card.id, { tag: t });
                  }}
                />
              )}
            </Section>

            {/* 고른 분류의 색 — 분류마다 팔레트에서 고른다(목록에 저장). "자동"은
                이름에서 정하는 기본색으로 되돌린다. */}
            {card.tag && !readOnly && activeTag && (
              <Section label={`'${card.tag}' 색`} style={label}>
                <SwatchGroup
                  label={`'${card.tag}' 색`}
                  value={activeTag.color}
                  colors={th.palette}
                  onPick={(c) => controller.setTagColor(activeTag.id, c)}
                  attrName="data-tag-color"
                  grid={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                  extra={{
                    ariaLabel: '자동 색 (이름에서 정한 색)',
                    onSelect: () => controller.setTagColor(activeTag.id, null),
                    style: (on) => ({
                      width: isMobile ? 30 : 24,
                      height: isMobile ? 30 : 24,
                      borderRadius: 999,
                      background: 'transparent',
                      backgroundImage: `linear-gradient(to top right, transparent calc(50% - 1px), ${th.subtext} calc(50% - 1px), ${th.subtext} calc(50% + 1px), transparent calc(50% + 1px))`,
                      border: on ? `2px solid ${th.accent}` : `1px solid ${th.border}`,
                      cursor: 'pointer',
                      padding: 0,
                    }),
                  }}
                  style={(c, on) => ({
                    width: isMobile ? 30 : 24,
                    height: isMobile ? 30 : 24,
                    borderRadius: 999,
                    background: c,
                    border: on ? `2px solid ${th.text}` : `1px solid ${hexA(th.text, 0.15)}`,
                    cursor: 'pointer',
                    padding: 0,
                  })}
                />
              </Section>
            )}

            <Section label="카드 배경색" style={label}>
              {/* 이름은 팔레트가 이미 들고 있다(`CARD_LABELS.name`) — 손으로 고른
                  톤 이름('빨강')이 hex에서 유도한 이름('연한 빨강')보다 정확하다. */}
              <SwatchGroup
                label="카드 배경색"
                value={card.bg}
                colors={CARD_LABELS.filter((l) => l.bg).map((l) => l.bg!)}
                names={CARD_LABELS.filter((l) => l.bg).map((l) => l.name)}
                onPick={(c) => controller.setCardBg(card.id, c)}
                disabled={readOnly}
                attrName="data-detail-color"
                extraAttrValue="없음"
                grid={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                extra={{
                  ariaLabel: '색 없음',
                  onSelect: () => controller.setCardBg(card.id, null),
                  style: (on) => ({
                    width: isMobile ? 32 : 26,
                    height: isMobile ? 32 : 26,
                    borderRadius: 999,
                    background: 'transparent',
                    backgroundImage: `linear-gradient(to top right, transparent calc(50% - 1px), ${th.subtext} calc(50% - 1px), ${th.subtext} calc(50% + 1px), transparent calc(50% + 1px))`,
                    border: on ? `2px solid ${th.accent}` : `1px solid ${th.border}`,
                    cursor: 'pointer',
                    padding: 0,
                  }),
                }}
                style={(c, on) => ({
                  width: isMobile ? 32 : 26,
                  height: isMobile ? 32 : 26,
                  borderRadius: 999,
                  background: c,
                  border: on ? `2px solid ${th.accent}` : `1px solid ${th.border}`,
                  cursor: 'pointer',
                  padding: 0,
                })}
              />
              <span style={{ fontSize: 12, color: th.subtext, alignSelf: 'center' }}>{cardLabelName(card.bg)}</span>
            </Section>

            <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', borderRadius: 12, border: `1px solid ${th.border}`, background: th.panel2, cursor: readOnly ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                data-detail-flag
                checked={!!card.flagged}
                disabled={readOnly}
                onChange={(e) => controller.setCardMeta(card.id, { flagged: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'inherit' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: th.text }}>긴급으로 표시</span>
              {/* 긴급은 배지가 아니라 카드 **좌측의 붉은 선**이다(시안 ②). */}
              <span data-detail-flag-hint style={{ fontSize: 12, color: th.subtext }}>카드 테두리가 붉게 표시돼요</span>
            </label>
          </div>

          {/* 논의 — 오른쪽 단(시안). 가라앉은 면으로 갈라 "카드의 값"과 "카드에 대한
              말"이 한눈에 구분된다. 좁은 화면에서는 아래로 쌓인다. */}
          {controller.canComment && (
            <div
              data-detail-comments
              style={{
                flex: isMobile ? '0 0 auto' : '0 0 380px',
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                borderLeft: isMobile ? undefined : `1px solid ${th.border}`,
                borderTop: isMobile ? `1px solid ${th.border}` : undefined,
                background: boardSurface(th),
                padding: isMobile ? '14px 15px 16px' : '16px 16px 14px',
                boxSizing: 'border-box',
                gap: 10,
              }}
            >
              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7, color: th.subtext }}>
                <CommentIcon />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>댓글 {comments || ''}</span>
              </div>
              {/* 데스크톱은 목록만 스크롤한다(모달은 고정 높이) — 모바일은 모달
                  전체가 스크롤되므로 목록을 따로 자르지 않는다. */}
              <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <CommentThreads controller={controller} nodeId={card.id} scroll={!isMobile} />
              </div>
            </div>
          )}
        </div>

        {/* 바닥 — 저장 약속과 `완료`(시안). 완료는 닫기와 같은 동작이다: 값은 고치는
            즉시 저장되고 제목만 닫을 때 한 번 커밋되므로, 이 버튼이 곧 "다 됐다"다. */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: isMobile ? '11px 15px' : '12px 18px', borderTop: `1px solid ${th.border}`, background: th.panel }}>
          <span data-detail-footnote style={{ fontSize: 11.5, color: th.subtext }}>
            {readOnly ? '보기 전용이라 값을 고칠 수 없어요' : '변경한 내용은 자동으로 저장돼요'}
          </span>
          <button
            type="button"
            className="mf-ed-btn"
            data-detail-done
            onClick={close}
            style={{
              height: isMobile ? 42 : 38,
              padding: '0 22px',
              borderRadius: 999,
              border: 0,
              // 시안의 강조 알약 — 세로 그라디언트 + 색 그림자.
              background: `linear-gradient(180deg, ${mixHex(th.accent, '#ffffff', 0.12)}, ${th.accent})`,
              boxShadow: `0 8px 18px -8px ${hexA(th.accent, 0.7)}`,
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            완료
          </button>
        </div>
      </>
    </Modal>
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

/** 날짜 한 칸 — 입력 + `지우기`(값이 없으면 비활성, 자리는 지킨다). */
function DateField({
  label,
  value,
  attr,
  theme: th,
  isMobile,
  readOnly,
  labelStyle,
  chipStyle,
  onChange,
}: {
  label: string;
  value: string;
  attr: 'start' | 'due';
  theme: Theme;
  isMobile: boolean;
  readOnly: boolean;
  labelStyle: CSSProperties;
  chipStyle: CSSProperties;
  onChange: (v: string | null) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <input
          className="mf-edit"
          type="date"
          {...{ [`data-detail-${attr}`]: true }}
          value={value}
          readOnly={readOnly}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(e.target.value || null)}
          style={{ flex: '1 1 auto', minWidth: 0, height: isMobile ? 40 : 34, padding: '0 11px', borderRadius: 10, border: `1px solid ${th.border}`, background: th.panel, outline: 'none', fontSize: 13, color: th.text, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        {!readOnly && (
          <button
            type="button"
            className="mf-ed-btn"
            {...{ [`data-detail-${attr}-clear`]: true }}
            disabled={!value}
            onClick={() => onChange(null)}
            style={{ ...chipStyle, flex: '0 0 auto', height: isMobile ? 40 : 34, cursor: value ? 'pointer' : 'default', opacity: value ? 1 : 0.45 }}
          >
            지우기
          </button>
        )}
      </div>
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

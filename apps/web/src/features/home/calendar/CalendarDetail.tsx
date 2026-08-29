// 일정 상세 팝업 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `evOpen` 블록 이식.
//
// 900×640 두 열: 왼쪽이 카드 자체(제목·상태·날짜·기간 바·담당·분류), 오른쪽이 댓글.
// 머리에 상태 점·`칸반 카드` 배지·분류·D-배지·`삭제`·`✕`, 발치에 안내 문구·
// `이 칸반 열기`·`완료`(강조색 그라디언트).
//
// **정본은 그 칸반 문서**다 — 여기서 고치면 문서에 저장된다(`patchCalendarCard` 계열,
// 대시보드 위젯의 열 이동과 같은 write-back). 원본이 목업으로 든 값은 우리 실물로
// 바꿨다: 상태=문서의 열, 담당=공유 참가자, 분류=문서의 분류 목록, 댓글=우리 댓글 표
// (`CommentThreads` 재사용 — 같은 것을 두 벌로 두지 않는다).
//
// 원본에 있지만 두지 않은 것: 카드 배경색·긴급 토글(칸반 카드 상세에 이미 있고, 일정
// 화면에서 고칠 이유가 약하다) · 메모(`desc` — 우리 카드 모델에 없는 필드).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { richToMarkdown } from '@mindflow/mindmap-core';
import type { KanbanCard, KanbanColumn, KanbanTag } from '@mindflow/mindmap-core';
import { Modal, MODAL_DIM } from '../../../components/Modal';
import { useShareStore } from '../../../adapters/BackendContext';
import type { ShareParticipant } from '../../../adapters/ports';
import { Avatar } from '../../editor/components/KanbanBoard';
import { CommentThreads, participantName } from '../../editor/components/CommentPanel';
import { columnColor, tagColor, tagInk } from '../../editor/kanbanMeta';
import { UI_THEME, hexA } from '../../editor/theme';
import { homeEditorTheme } from '../theme';
import type { HomeState } from '../types';
import type { HomeController } from '../useHomeController';
import { RadioCards } from '../../../components/Segmented';
import { DateButton, PillButton, pillStyle } from './DatePop';
import { useCalendarComments } from './useCalendarComments';
import { daysBetween, dueBadge, partsOf, todayISO } from './model';
import type { CalendarEntry } from './entries';

export function CalendarDetail({ state, controller, entry, isMobile }: { state: HomeState; controller: HomeController; entry: CalendarEntry; isMobile: boolean }) {
  const readOnly = !!entry.readOnly;
  const shareStore = useShareStore();
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  // 댓글 열은 에디터의 그 부품이라 색을 `Theme` 꼴로 받는다 — 홈 테마를 그 모양으로
  // 옮겨 넘긴다(다크 홈 안에 밝은 열이 홀로 뜨지 않게).
  const commentTheme = useMemo(() => homeEditorTheme(state.theme, UI_THEME.palette), [state.theme]);
  const commentHost = useCalendarComments(entry.docId, commentTheme);

  // 그 문서의 열·분류·카드 — 상태·분류 칩의 목록이다. 본문은 썸네일이 받아 둔 그
  // 문자열(일정 화면이 이미 읽고 있는 값)이라 새로 내려받는 것이 없다.
  const body = useMemo(() => {
    try {
      const d = JSON.parse(state.previewDocs[entry.docId] ?? '{}') as { columns?: KanbanColumn[]; cards?: KanbanCard[]; tags?: KanbanTag[] };
      return { columns: Array.isArray(d.columns) ? d.columns : [], cards: Array.isArray(d.cards) ? d.cards : [], tags: Array.isArray(d.tags) ? d.tags : [] };
    } catch {
      return { columns: [], cards: [], tags: [] };
    }
  }, [state.previewDocs, entry.docId]);
  const card = body.cards.find((c) => c.id === entry.cardId);

  // 제목은 **blur·닫을 때 한 번** 저장한다(글자마다 커밋하면 저장이 타이핑 수만큼 난다).
  const baseTitle = card ? richToMarkdown(card) : entry.title;
  const [title, setTitle] = useState(baseTitle);
  const titleRef = useRef(title);
  titleRef.current = title;
  const baseRef = useRef(baseTitle);
  baseRef.current = baseTitle;

  const run = async (fn: () => Promise<boolean>): Promise<void> => {
    setSaving(true);
    await fn();
    setSaving(false);
  };

  const commitTitle = (): void => {
    const next = titleRef.current.trim();
    if (readOnly || !next || next === baseRef.current.trim()) return;
    void run(() => controller.renameCalendarCard(entry.docId, entry.cardId, next));
  };

  const close = (): void => {
    commitTitle();
    controller.closeCalendarCard();
  };

  useEffect(() => {
    let alive = true;
    void shareStore
      .listParticipants(entry.docId)
      .then((list) => {
        if (alive && list) setParticipants(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [shareStore, entry.docId]);

  const today = todayISO();
  const badgeLabel = dueBadge(entry.due, today);
  const badgeTone: 'over' | 'today' | 'normal' = entry.due < today ? 'over' : entry.due === today ? 'today' : 'normal';
  const doneColId = body.columns[body.columns.length - 1]?.id;
  const colDot = columnColor({ id: entry.colId, title: entry.colName, ...(entry.colColor ? { color: entry.colColor } : {}) }, entry.colIndex, UI_THEME.palette);
  const tagHex = entry.tag ? (entry.tagColor ?? tagColor(entry.tag, UI_THEME.palette)) : null;

  return (
    <Modal
      open
      onClose={close}
      label="일정 상세"
      // 막을 눌러 닫힌다 — 고르는 즉시 그 칸반에 쓰므로 잃을 입력이 없다(제목만 닫을
      // 때 저장하고, `close`가 그 커밋을 태운다). 달력 항목을 흘깃 보는 팝업의 관례.
      dismissOnBackdrop
      // 막·등장 효과는 설정 팝업과 같은 것(요청) — 예전에는 배경이 그대로 보였다(제보).
      dim={{ ...MODAL_DIM, animation: 'mf-dim-in .18s ease-out', zIndex: 320, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 32 }}
      card={{
        // 원본: 900×640. 폰은 바텀 시트(우리 모달 관례).
        width: isMobile ? '100%' : 900,
        maxWidth: '100%',
        height: isMobile ? '88dvh' : 640,
        maxHeight: '100%',
        boxSizing: 'border-box',
        borderRadius: isMobile ? '22px 22px 0 0' : 22,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'mf-fade .2s ease',
      }}
      cardAttrs={{ 'data-cal-detail': '1' }}
    >
      <>
        {/* 머리 */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: colDot, display: 'block' }} />
            <span data-cal-detail-status style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{entry.colName || '상태 없음'}</span>
          </span>
          <span
            data-cal-detail-badge
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 24,
              padding: '0 11px',
              borderRadius: 999,
              background: readOnly ? 'var(--mf-panel2)' : 'var(--mf-success-soft)',
              color: readOnly ? 'var(--mf-muted)' : 'var(--mf-success-ink)',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
            }}
          >
            {!readOnly && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--mf-success)', display: 'block' }} />}
            {readOnly ? '보기 전용' : '칸반 카드'}
          </span>
          {/* 분류 칩 — 원본은 이 자리를 만들어 두고 껐다(`evShowTagPill: false`, 왼쪽
              열에 분류 칩이 있으니 겹친다). 우리는 켜 둔다: **보기 전용**에서는 왼쪽
              분류 칩이 없어 여기가 분류를 말하는 유일한 자리다. */}
          {tagHex && (
            <span style={{ height: 24, padding: '0 10px', borderRadius: 999, background: hexA(tagHex, 0.16), color: tagInk(tagHex, UI_THEME.text), fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{entry.tag}</span>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          <span
            data-cal-detail-due
            style={{
              height: 24,
              padding: '0 10px',
              borderRadius: 999,
              background: badgeTone === 'over' ? 'var(--mf-danger-bg)' : badgeTone === 'today' ? 'var(--mf-accent-soft)' : 'var(--mf-panel2)',
              color: badgeTone === 'over' ? 'var(--mf-danger)' : badgeTone === 'today' ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
              fontSize: 11,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
            }}
          >
            {badgeLabel}
          </span>
          {!readOnly && (
            <button
              type="button"
              data-cal-detail-delete
              onClick={() => {
                void run(async () => {
                  const ok = await controller.deleteCalendarCard(entry.docId, entry.cardId);
                  if (ok) controller.closeCalendarCard();
                  return ok;
                });
              }}
              className="mf-ctl mf-ctl-danger"
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 30, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              삭제
            </button>
          )}
          <button type="button" aria-label="닫기" title="닫기" onClick={close} className="mf-ctl" style={{ width: 30, height: 30, flex: '0 0 auto', border: '1px solid var(--mf-border)', borderRadius: 999, background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', minWidth: 0, flexDirection: isMobile ? 'column' : 'row' }}>
          {/* 왼쪽 — 카드 자체 */}
          <div className="lnb-scroll" style={{ flex: isMobile ? '1 1 auto' : '1 1 340px', minWidth: isMobile ? 0 : 300, minHeight: 0, overflowY: 'auto', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 19 }}>
            <textarea
              aria-label="카드 제목"
              data-cal-detail-title
              value={title}
              readOnly={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
                if (e.key === 'Escape') setTitle(baseRef.current);
              }}
              placeholder="카드 제목"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 88,
                // 손잡이로 늘리지 않는다(요청) — 팝업이 고정 높이 두 열이라 늘리면
                // 아래 필드가 밀리고, 제목은 두세 줄이면 충분하다.
                resize: 'none',
                padding: '15px 16px',
                borderRadius: 14,
                border: '1px solid var(--mf-border)',
                background: 'var(--mf-card)',
                font: 'inherit',
                fontSize: 19,
                fontWeight: 800,
                letterSpacing: '-.03em',
                lineHeight: 1.45,
                color: 'var(--mf-text)',
                outline: 'none',
              }}
            />

            {readOnly ? (
              <span data-cal-detail-ro style={{ fontSize: 12.5, color: 'var(--mf-muted)', background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', borderRadius: 12, padding: '11px 13px', lineHeight: 1.65 }}>
                보기 전용으로 공유받은 보드예요. 제목·상태·날짜는 이 보드의 편집 권한이 있어야 고칠 수 있어요. 댓글은 남길 수 있어요.
              </span>
            ) : (
              <>
                {body.columns.length > 1 && (
                  <Field label="상태">
                    {/* 원본은 평범한 버튼 셋이지만 우리는 **라디오 묶음**으로 낸다 —
                        "여럿 중 하나"라는 뜻이 보조기술에 전해지고 ←/→로 옮겨 다닌다
                        (Radix RadioGroup, #24에서 세운 규칙). 모양은 원본의 알약 그대로. */}
                    <RadioCards
                      label="상태"
                      value={entry.colId}
                      onChange={(colId) => {
                        if (colId === entry.colId) return;
                        void run(async () => {
                          const ok = await controller.moveCalendarCard(entry.docId, entry.cardId, colId);
                          // 완료(마지막) 열로 옮기면 달력에서 빠진다 — 팝업도 닫는다.
                          if (ok && colId === doneColId) controller.closeCalendarCard();
                          return ok;
                        });
                      }}
                      grid={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
                      gridClass="mf-cal-state"
                      items={body.columns.map((c, i) => ({
                        value: c.id,
                        label: c.title || '이름 없음',
                        attrs: { 'data-cal-state-item': c.id },
                        // 손을 얹으면 반응한다 — 고른 칸은 `aria-checked`라 hover 규칙이
                        // 면을 갈아 끼우지 않고 밝기만 움직인다(home.css).
                        className: 'mf-ctl',
                        style: (on: boolean) => pillStyle(on),
                        children: (
                          <>
                            <span style={{ width: 7, height: 7, borderRadius: 999, background: columnColor(c, i, UI_THEME.palette), display: 'block', flex: '0 0 auto' }} />
                            {c.title || '이름 없음'}
                          </>
                        ),
                      }))}
                    />
                  </Field>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <FieldLabel>시작일</FieldLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <DateButton label="시작일" value={entry.start} attrs={{ 'data-cal-start': '1' }} onPick={(iso) => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { start: iso }))} />
                    </div>
                  </div>
                  <div style={{ flex: '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <FieldLabel>기한</FieldLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <DateButton
                        label="기한"
                        value={entry.due}
                        min={entry.start}
                        attrs={{ 'data-cal-due': '1' }}
                        // 기한은 이 항목이 달력에 **있는 이유**다 — 지우면 목록에서
                        // 사라지므로 그 동작은 칸반에 남긴다(원본은 `지우기`를 두지만,
                        // 우리 일정 화면에서는 방금 보고 있던 항목이 사라지는 셈이다).
                        clearable={false}
                        onPick={(iso) => {
                          if (!iso) return;
                          void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { due: iso }));
                        }}
                      />
                    </div>
                  </div>
                </div>

                <SpanBar entry={entry} today={today} />

                <Field label="담당">
                  <div data-cal-owner style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      data-cal-owner-item="none"
                      aria-label="담당 없음"
                      title="담당 없음"
                      onClick={() => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { owner: null }))}
                      className="mf-ctl"
                      style={{ width: 38, height: 38, flex: '0 0 auto', borderRadius: 999, border: entry.ownerEmail ? '2px solid var(--mf-border)' : '2px solid var(--mf-accent)', background: 'var(--mf-card)', color: 'var(--mf-faint2)', font: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >
                      –
                    </button>
                    {participants.map((p) => {
                      const name = participantName(p);
                      const on = (entry.ownerEmail ?? '') === p.email;
                      return (
                        <button
                          key={p.email}
                          type="button"
                          data-cal-owner-item={p.email}
                          aria-label={name}
                          onClick={() => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { owner: { email: p.email, name } }))}
                          className="mf-ctl"
                          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', flex: '0 0 auto', borderRadius: 999, lineHeight: 0 }}
                        >
                          <Avatar name={name} email={p.email} size={38} ring={on ? 'var(--mf-accent)' : 'var(--mf-border)'} src={p.avatarUrl ?? null} />
                        </button>
                      );
                    })}
                    {!participants.length && <span style={{ fontSize: 12.5, color: 'var(--mf-faint2)' }}>공유한 사람이 없어요</span>}
                  </div>
                </Field>

                <Field label="분류">
                  <div data-cal-tag style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <PillButton on={!entry.tag} attrs={{ 'data-cal-tag-item': '' }} onClick={() => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { tag: null }))}>
                      없음
                    </PillButton>
                    {body.tags.map((t) => (
                      <PillButton key={t.id} on={entry.tag === t.name} dot={t.color ?? tagColor(t.name, UI_THEME.palette)} attrs={{ 'data-cal-tag-item': t.name }} onClick={() => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { tag: t.name }))}>
                        {t.name}
                      </PillButton>
                    ))}
                    {tagDraft === null ? (
                      <PillButton on={false} dashed attrs={{ 'data-cal-tag-custom': '1' }} onClick={() => setTagDraft(entry.tag)}>
                        직접 입력
                      </PillButton>
                    ) : (
                      <input
                        autoFocus
                        aria-label="분류 직접 입력"
                        value={tagDraft}
                        maxLength={24}
                        placeholder="분류 이름"
                        onChange={(e) => setTagDraft(e.target.value)}
                        onBlur={() => setTagDraft(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setTagDraft(null);
                          if (e.key !== 'Enter') return;
                          const name = tagDraft.trim();
                          setTagDraft(null);
                          if (name) void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { tag: name }));
                        }}
                        style={{ height: 34, minWidth: 0, width: 130, padding: '0 12px', borderRadius: 999, border: '1.5px solid var(--mf-accent)', background: 'var(--mf-card)', font: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--mf-text)', outline: 'none', flex: '0 0 auto' }}
                      />
                    )}
                  </div>
                </Field>
              </>
            )}
          </div>

          {/* 오른쪽 — 댓글. 우리 댓글 표(스레드·답글·멘션·좋아요·실시간)를 그대로 쓴다. */}
          <div data-cal-comments style={{ flex: isMobile ? '0 0 auto' : '1 1 240px', minWidth: isMobile ? 0 : 230, minHeight: isMobile ? 240 : 0, borderLeft: isMobile ? undefined : '1px solid var(--mf-border-soft)', borderTop: isMobile ? '1px solid var(--mf-border-soft)' : undefined, background: 'var(--mf-cal-cmt)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 9, padding: '17px 18px 13px' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mf-muted)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
                <path d="M20 15.5A2.5 2.5 0 0 1 17.5 18H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v9Z" />
              </svg>
              <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)' }}>댓글 {commentHost.comments.filter((c) => c.nodeId === entry.cardId).length}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 18px 14px' }}>
              <CommentThreads controller={commentHost} nodeId={entry.cardId} scroll />
            </div>
          </div>
        </div>

        {/* 발치 */}
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: '1px solid var(--mf-border-soft)', background: 'var(--mf-card)' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--mf-faint2)' }}>{saving ? '저장 중…' : readOnly ? `${entry.boardName} · ${entry.spaceName}` : '변경한 내용은 자동으로 저장돼요'}</span>
          <button
            type="button"
            data-cal-detail-open
            onClick={() => {
              commitTitle();
              controller.closeCalendarCard();
              controller.openWithLoader(`/editor?map=${encodeURIComponent(entry.docId)}&title=${encodeURIComponent(entry.boardName)}&docId=${encodeURIComponent(entry.docId)}`, entry.boardName, entry.docId);
            }}
            className="mf-ctl"
            // 폰에서는 44px 터치 타깃(원본은 데스크톱 값 36).
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7, height: isMobile ? 44 : 36, padding: '0 16px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h6v6" />
              <path d="M20 4 11 13" />
              <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
            이 칸반 열기
          </button>
          <button type="button" data-cal-detail-done onClick={close} className="mf-ctl-primary" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: isMobile ? 44 : 40, padding: isMobile ? '0 20px' : '0 26px', borderRadius: 999, border: 0, background: 'linear-gradient(180deg, var(--mf-accent), var(--mf-accent-strong))', color: 'var(--mf-accent-ink)', font: 'inherit', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 18px -10px rgba(var(--mf-accent-rgb), .9)' }}>
            완료
          </button>
        </div>
      </>
    </Modal>
  );
}

/**
 * 기간 진행 바 — 원본 `evHasSpan`(`N일 중 M일째` + 남은 날 + 하루 한 칸 pip).
 * 시작일이 있고 기한보다 앞설 때만 뜬다.
 */
function SpanBar({ entry, today }: { entry: CalendarEntry; today: string }) {
  if (!entry.start || !partsOf(entry.start) || entry.start >= entry.due) return null;
  const total = daysBetween(entry.start, entry.due) + 1;
  if (total < 2 || total > 200) return null; // 지나치게 긴 기간은 pip으로 그릴 뜻이 없다
  const done = Math.max(0, Math.min(total, daysBetween(entry.start, today) + 1));
  const main = done > 0 && done <= total ? `${total}일 중 ${done}일째` : `${total}일간`;
  const rest = today < entry.start ? `${daysBetween(today, entry.start)}일 뒤 시작` : today > entry.due ? '종료' : `${daysBetween(today, entry.due)}일 남음`;
  return (
    <div data-cal-span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{main}</span>
        <span style={{ flex: 1, minWidth: 0 }} />
        <span style={{ flex: '0 0 auto', fontSize: 11.5, color: 'var(--mf-faint2)', whiteSpace: 'nowrap' }}>{rest}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'stretch', gap: 2, height: 5 }}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              borderRadius: 999,
              // 지난 날은 옅은 강조색, **오늘 칸만** 진하게(원본과 같은 규칙).
              background: i < done ? (i === done - 1 ? 'var(--mf-accent-strong)' : 'var(--mf-accent-mute)') : 'var(--mf-border-soft)',
              display: 'block',
            }}
          />
        ))}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--mf-subtext)' }}>{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

/** 팝업이 열려 있으면 그 항목을 찾아 그린다(항목이 사라졌으면 조용히 닫는다). */
export function CalendarDetailHost({ state, controller, entries, isMobile }: { state: HomeState; controller: HomeController; entries: readonly CalendarEntry[]; isMobile: boolean }) {
  const target = state.calDetail;
  const entry = target ? entries.find((e) => e.docId === target.docId && e.cardId === target.cardId) : undefined;
  useEffect(() => {
    // 완료로 옮겼거나 기한이 사라졌거나 상대가 지웠다 — 가리킬 것이 없으면 닫는다.
    if (target && !entry) controller.closeCalendarCard();
  }, [target, entry, controller]);
  if (!entry) return null;
  // 대상이 바뀌면 새로 마운트한다 — 제목 초안이 다른 카드로 넘어가지 않게.
  return <CalendarDetail key={`${entry.docId}:${entry.cardId}`} state={state} controller={controller} entry={entry} isMobile={isMobile} />;
}

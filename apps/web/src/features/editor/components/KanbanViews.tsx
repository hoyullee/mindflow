// 칸반의 다른 두 보기 — 리스트와 타임라인(디자인 원본의 탭).
//
// 보드가 "지금 어느 단계인가"를 보여 준다면, 리스트는 **한눈에 훑기**(제목·분류·
// 기한·담당·댓글을 한 줄에), 타임라인은 **언제까지인가**를 보여 준다. 셋 다 같은
// 문서를 읽을 뿐이라 편집은 카드를 눌러 여는 상세가 맡는다.

import type { CSSProperties } from 'react';
import { cardsInColumn } from '@mindflow/mindmap-core';
import type { KanbanCard, KanbanColumn } from '@mindflow/mindmap-core';
import type { EditorController } from '../useEditorState';
import { hexA } from '../theme';
import type { Theme } from '../theme';
import { EMPTY_FILTER, boardSurface, cardPasses, columnBg, columnColor, columnSurface, dueLabel, dueTone, filterActive, innerLine, ownerLabel, tagInk, timelineRange, timelineSpan } from '../kanbanMeta';
import type { CardFilter } from '../kanbanMeta';
import { Avatar, CardText, TagBadge } from './KanbanBoard';
import { CommentIcon } from './ToolbarMenus';

/** 지난 기한·긴급의 경고색(보드 카드와 같은 값). */
const URGENT = '#d9534f';

/** 열별로 묶어 거른 목록 — 세 보기가 같은 규칙으로 카드를 고른다. */
function groups(columns: KanbanColumn[], cards: KanbanCard[], query: string, filter: CardFilter): { col: KanbanColumn; index: number; cards: KanbanCard[] }[] {
  return columns.map((col, index) => ({ col, index, cards: cardsInColumn(cards, col.id).filter((c) => cardPasses(c, query, filter)) }));
}

const GRID = 'minmax(200px, 1fr) 104px 116px 108px 56px';

export function KanbanList({ controller, theme: th, query, filter = EMPTY_FILTER, isMobile, avatars }: { controller: EditorController; theme: Theme; query: string; filter?: CardFilter; isMobile: boolean; avatars?: Record<string, string> }) {
  const rows = groups(controller.columns, controller.cards, query, filter);
  const head: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: th.subtext, letterSpacing: '.02em' };
  return (
    <div data-kanban-list-view style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: isMobile ? '0 12px 18px' : '0 20px 20px' }}>
      <div style={{ maxWidth: 1100, borderRadius: 16, border: `1px solid ${th.border}`, background: th.panel, overflow: 'hidden' }}>
        {/* 좁은 화면에서는 제목·기한만 남긴다 — 다섯 열을 390px에 밀어 넣으면 전부 잘린다. */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 96px' : GRID, gap: 12, padding: '10px 16px', background: columnSurface(th), borderBottom: `1px solid ${th.border}`, ...head }}>
          <span>제목</span>
          {!isMobile && <span>분류</span>}
          <span>기한</span>
          {!isMobile && <span>담당</span>}
          {!isMobile && <span style={{ textAlign: 'right' }}>댓글</span>}
        </div>
        {rows.map(({ col, index, cards }) => (
          <div key={col.id}>
            <div data-list-group={col.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', background: columnBg(col, th) === columnSurface(th) ? boardSurface(th) : columnBg(col, th), borderBottom: `1px solid ${innerLine(th)}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: columnColor(col, index, th.palette), display: 'block' }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: th.text }}>{col.title}</span>
              <span style={{ fontSize: 11, color: th.subtext }}>{cards.length}</span>
            </div>
            {cards.map((card) => (
              <ListRow key={card.id} card={card} col={col} index={index} done={index === controller.columns.length - 1} controller={controller} theme={th} isMobile={isMobile} avatars={avatars} />
            ))}
            {!cards.length && (
              <div data-list-empty={col.id} style={{ padding: '14px 16px', borderBottom: `1px solid ${innerLine(th)}`, fontSize: 12.5, color: th.subtext }}>
                {query.trim() || filterActive(filter) ? '조건에 맞는 카드가 없어요.' : '아직 카드가 없어요.'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListRow({ card, col, index, done, controller, theme: th, isMobile, avatars }: { card: KanbanCard; col: KanbanColumn; index: number; done: boolean; controller: EditorController; theme: Theme; isMobile: boolean; avatars?: Record<string, string> }) {
  const comments = controller.canComment ? (controller.commentCounts[card.id] ?? 0) : 0;
  const owner = ownerLabel(card);
  // 마지막 열(완료)의 카드는 기한이 지났어도 붉게 쓰지 않는다 — 끝난 일이다(타임라인과 같은 규칙).
  const tone = card.due && !done ? dueTone(card.due) : 'normal';
  return (
    <div
      className="mf-kb-row"
      data-list-row={card.id}
      role="button"
      tabIndex={0}
      onClick={() => controller.openCardDetail(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          controller.openCardDetail(card.id);
        }
      }}
      style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 96px' : GRID, gap: 12, alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${innerLine(th)}`, cursor: 'pointer', minHeight: isMobile ? 44 : undefined }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{ width: 15, height: 15, borderRadius: 5, border: `1.5px solid ${columnColor(col, index, th.palette)}`, display: 'inline-block', flex: '0 0 auto' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.text ? <CardText card={card} /> : '빈 카드'}
        </span>
        {card.flagged && <span style={{ flex: '0 0 auto', height: 18, padding: '0 6px', borderRadius: 5, background: hexA(URGENT, 0.14), color: URGENT, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>긴급</span>}
      </span>
      {!isMobile && <span style={{ justifySelf: 'start' }}>{card.tag ? <TagBadge name={card.tag} theme={th} /> : null}</span>}
      <span style={{ fontSize: 12.5, color: tone === 'over' ? URGENT : tone === 'soon' ? th.accent : th.subtext, fontWeight: tone === 'normal' ? 400 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {card.due ? dueLabel(card.due) : ''}
      </span>
      {!isMobile && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {owner && <Avatar name={owner} email={card.owner ?? owner} size={22} src={card.owner ? (avatars?.[card.owner.toLowerCase()] ?? null) : null} />}
          <span style={{ fontSize: 12, color: th.subtext, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{owner}</span>
        </span>
      )}
      {!isMobile && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', fontSize: 12, color: th.subtext }}>
          <CommentIcon />
          {comments}
        </span>
      )}
    </div>
  );
}

export function KanbanTimeline({ controller, theme: th, query, filter = EMPTY_FILTER, isMobile, avatars }: { controller: EditorController; theme: Theme; query: string; filter?: CardFilter; isMobile: boolean; avatars?: Record<string, string> }) {
  const days = timelineRange();
  const rows = groups(controller.columns, controller.cards, query, filter);
  const withDue = rows.flatMap(({ col, index, cards }) => cards.filter((c) => c.due).map((card) => ({ card, col, index })));
  const noDue = rows.reduce((n, g) => n + g.cards.filter((c) => !c.due).length, 0);
  const NAME_W = isMobile ? 150 : 240;

  return (
    <div data-kanban-timeline style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: isMobile ? '0 12px 18px' : '0 20px 20px' }}>
      <div style={{ minWidth: 720, borderRadius: 16, border: `1px solid ${th.border}`, background: th.panel, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${NAME_W}px 1fr`, borderBottom: `1px solid ${th.border}`, background: columnSurface(th) }}>
          <span style={{ padding: '11px 16px', fontSize: 11.5, fontWeight: 700, color: th.subtext }}>작업</span>
          <div style={{ display: 'flex' }}>
            {days.map((d) => (
              <span
                key={d.iso}
                data-timeline-day={d.iso}
                style={{ flex: 1, padding: '11px 0', textAlign: 'center', fontSize: 10.5, color: d.today ? th.accent : th.subtext, fontWeight: d.today ? 700 : 500, borderLeft: `1px solid ${th.border}`, background: d.today ? hexA(th.accent, 0.08) : 'transparent' }}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>

        {withDue.map(({ card, col, index }) => {
          const span = timelineSpan(card, days);
          const left = span ? (span.start / days.length) * 100 : 0;
          const width = span ? ((span.end - span.start + 1) / days.length) * 100 : 0;
          // 마지막 열(완료)의 카드는 기한이 지났어도 **늦은 일이 아니다** — 끝난 일에
          // 붉은 막대가 남으면 남은 일과 구분되지 않는다(원본도 완료 막대를 달리 칠했다).
          // 막대는 **그 열의 색**을 따른다(요청) — 어느 단계의 일인지 색으로 읽힌다.
          // 글자는 배지와 같은 규칙으로 눌러(`tagInk`) 옅은 막대 위에서도 읽힌다.
          const bar = columnColor(col, index, th.palette);
          const ink = tagInk(bar, th.text);
          const owner = ownerLabel(card);
          return (
            <div
              key={card.id}
              className="mf-kb-row"
              data-timeline-row={card.id}
              role="button"
              tabIndex={0}
              onClick={() => controller.openCardDetail(card.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  controller.openCardDetail(card.id);
                }
              }}
              style={{ display: 'grid', gridTemplateColumns: `${NAME_W}px 1fr`, alignItems: 'center', borderBottom: `1px solid ${innerLine(th)}`, cursor: 'pointer' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: columnColor(col, index, th.palette), flex: '0 0 auto' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.text || '빈 카드'}</span>
              </span>
              <span style={{ position: 'relative', height: 42, display: 'block' }}>
                {/* 날짜 눈금 — 막대가 어느 날에 걸렸는지 읽히게 칸 경계를 옅게 남긴다. */}
                <span style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
                  {days.map((d) => (
                    <span key={d.iso} style={{ flex: 1, borderLeft: `1px solid ${hexA(th.border, 0.6)}`, background: d.today ? hexA(th.accent, 0.06) : 'transparent' }} />
                  ))}
                </span>
                <span
                  data-timeline-bar={card.id}
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 9,
                    height: 24,
                    borderRadius: 8,
                    background: hexA(bar, 0.16),
                    border: `1px solid ${hexA(bar, 0.45)}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 8px',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                  }}
                >
                  {owner && <Avatar name={owner} email={card.owner ?? owner} size={16} src={card.owner ? (avatars?.[card.owner.toLowerCase()] ?? null) : null} />}
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {card.tag || dueLabel(card.due as string)}
                  </span>
                </span>
              </span>
            </div>
          );
        })}

        {!withDue.length && <div data-timeline-empty style={{ padding: '18px 16px', fontSize: 12.5, color: th.subtext }}>기한이 있는 카드가 없어요. 카드를 열어 기한을 정하면 여기 나타납니다.</div>}
        {/* 기한이 없는 카드는 놓을 자리가 없다 — 숨기되 몇 장인지는 밝힌다. */}
        {noDue > 0 && <div data-timeline-nodue style={{ padding: '11px 16px', fontSize: 12, color: th.subtext, background: th.panel2 }}>기한이 없는 카드 {noDue}장은 표시하지 않았어요.</div>}
      </div>
    </div>
  );
}

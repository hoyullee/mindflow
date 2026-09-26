/**
 * 칸반 **카드 마감**을 공책 안에서 들여다보는 작은 판(제보 1, 사용자 결정).
 *
 * 날짜 칩 팝오버의 일정은 원천이 셋인데(칸반 마감 · 그리오 일정 · 구글), 앞의 하나만
 * 누를 곳이 없었다 — 그리오·구글은 각자의 상세 팝업이 있고 칸반은 없었기 때문이다.
 * 일정 화면은 그 줄을 `CalendarDetail`로 여는데, 그 부품은 홈의 **쓰기 경로 여섯**
 * (`renameCalendarCard`·`moveCalendarCard`·`patchCalendarCard`·`deleteCalendarCard`…)에
 * 묶여 있어 공책에서는 그대로 띄울 수 없다.
 *
 * 그래서 **읽기 전용**으로 둔다. 공책에서 칸반 카드를 고치는 길을 새로 여는 것은
 * 이 라운드의 일이 아니고, 임베드에서 이미 정한 선과도 같다(「편집은 칸반 열 이동만」).
 * 고칠 것이 있으면 **그 보드로 건너간다** — 단추 하나가 그 길이다.
 */

import type { CalendarEntry } from '../../home/calendar/entries';
import { entryChip } from '../../home/calendar/chips';
import { dayProgress } from '../../home/calendar/model';
import type { Theme } from '../theme';

/** 한 줄짜리 항목 — 값이 없으면 그 줄을 아예 세우지 않는다. */
function Row({ label, children, th }: { label: string; children: React.ReactNode; th: Theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
      <span style={{ flex: '0 0 52px', fontSize: 11.5, fontWeight: 700, color: th.subtext }}>{label}</span>
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12.5, fontWeight: 700, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </div>
  );
}

export function NoteCardPeek({
  entry,
  iso,
  theme,
  onClose,
  onOpenBoard,
}: {
  entry: CalendarEntry;
  /** 어느 날에서 열었나 — 기간 카드의 「며칠째」가 그 날 기준이다. */
  iso: string;
  theme: Theme;
  onClose: () => void;
  onOpenBoard: () => void;
}) {
  const th = theme;
  const chip = entryChip(entry, { card: th.panel, text: th.text });
  const when = dayProgress(entry, iso);
  return (
    <div
      data-note-card-peek={entry.cardId}
      role="dialog"
      aria-label="카드"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        zIndex: 1400,
        background: 'rgba(24,18,12,.28)',
      }}
      onMouseDown={(e) => {
        // 바깥을 누르면 닫는다 — 판 안에서 시작한 누름은 위에서 막았다.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(360px, calc(100vw - 32px))',
          borderRadius: 14,
          border: '1px solid var(--mf-border-soft)',
          background: 'var(--mf-card)',
          boxShadow: '0 18px 44px rgba(40,28,18,.20)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 15px 9px' }}>
          <span aria-hidden style={{ flex: '0 0 4px', height: 17, borderRadius: 999, background: chip.dot }} />
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 14.5, fontWeight: 800, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 15px 13px' }}>
          <Row label="보드" th={th}>
            {entry.boardName}
            {entry.spaceName ? <span style={{ color: th.subtext, fontWeight: 700 }}> · {entry.spaceName}</span> : null}
          </Row>
          {entry.colName ? (
            <Row label="열" th={th}>
              {entry.colName}
            </Row>
          ) : null}
          <Row label="기한" th={th}>
            {entry.start ? `${entry.start} ~ ${entry.due}` : entry.due}
            {when ? <span style={{ color: th.subtext, fontWeight: 700 }}> · {when}</span> : null}
          </Row>
          {entry.owner ? (
            <Row label="담당" th={th}>
              {entry.owner}
            </Row>
          ) : null}
          {entry.tag ? (
            <Row label="분류" th={th}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: chip.base }} />
                {entry.tag}
              </span>
            </Row>
          ) : null}
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid var(--mf-border-soft)' }}>
          <button
            type="button"
            data-note-card-peek-open
            onClick={onOpenBoard}
            style={{ flex: '1 1 auto', height: 36, border: 0, background: 'var(--mf-note-chip-bg)', color: th.text, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            보드에서 열기
          </button>
          <button
            type="button"
            data-note-card-peek-close
            onClick={onClose}
            style={{ flex: '0 0 96px', height: 36, border: 0, borderLeft: '1px solid var(--mf-border-soft)', background: 'var(--mf-note-chip-bg)', color: th.subtext, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

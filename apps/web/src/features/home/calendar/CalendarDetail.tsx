import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../../components/Modal';
import { Segmented } from '../../../components/Segmented';
import type { HomeState } from '../types';
import type { HomeController } from '../useHomeController';
import { homeChipSurface } from '../theme';
import { entryChip } from './chips';
import { isSpan } from './model';
import type { CalendarEntry } from './entries';

/**
 * 일정 상세 — 항목을 눌렀을 때 뜨는 팝업. 정본은 **그 칸반 문서**이고, 여기서 고치면
 * 문서에 저장된다(`patchCalendarCard` — 대시보드 위젯의 열 이동과 같은 write-back).
 *
 * 고칠 수 있는 것을 **일부러 좁게** 뒀다: 상태(열) · 시작일 · 기한. 제목·분류·담당·
 * 삭제·댓글은 칸반의 일이고, 이 팝업의 `이 칸반 열기`가 그리로 보낸다. 캘린더를
 * 칸반 편집기로 만들지 않는다(디자인 원본은 카드 상세를 통째로 열지만, 그 상세는
 * 캔버스 상태에 얽힌 댓글 패널까지 품고 있어 홈에서 그대로 열 수 없다).
 */
export function CalendarDetail({ state, controller, entry, isMobile }: { state: HomeState; controller: HomeController; entry: CalendarEntry; isMobile: boolean }) {
  const surface = useMemo(() => homeChipSurface(state.theme), [state.theme]);
  const chip = entryChip(entry, surface);
  const dark = state.theme === 'dark';
  const [saving, setSaving] = useState(false);
  // 열 목록은 그 문서의 본문에서 읽는다(상태 세그먼트).
  const columns = useMemo(() => {
    try {
      const d = JSON.parse(state.previewDocs[entry.docId] ?? '{}') as { columns?: { id: string; title: string }[] };
      return Array.isArray(d.columns) ? d.columns : [];
    } catch {
      return [];
    }
  }, [state.previewDocs, entry.docId]);

  const run = async (fn: () => Promise<boolean>): Promise<void> => {
    setSaving(true);
    await fn();
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={controller.closeCalendarCard}
      label="일정 상세"
      // 막 클릭으로 닫힌다 — 이 팝업에는 **아직 저장되지 않은 입력이 없다**(고르는
      // 즉시 그 칸반에 쓴다). 그래서 "편집 중인 팝업은 막 클릭으로 닫지 않는다"는
      // 규칙의 근거(타이핑을 잃는다)가 여기엔 없고, 달력에서 항목을 흘깃 보는 팝업은
      // 바깥을 눌러 닫는 것이 관례다(구글 캘린더의 일정 팝업).
      dismissOnBackdrop
      dim={{ zIndex: 320, alignItems: isMobile ? 'flex-end' : 'center', padding: isMobile ? 0 : 24 }}
      card={{
        width: isMobile ? '100%' : 452,
        maxWidth: '100%',
        borderRadius: isMobile ? '22px 22px 0 0' : 22,
        background: 'var(--mf-card)',
        border: '1px solid var(--mf-border)',
        boxShadow: 'var(--mf-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <>
        {/* 머리 — 상태 점 + 열 이름 + 출처 배지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px 12px' }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: chip.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mf-text)', whiteSpace: 'nowrap' }}>{entry.colName || '상태 없음'}</span>
          <span data-cal-detail-badge style={{ height: 20, padding: '0 8px', borderRadius: 999, background: entry.readOnly ? 'var(--mf-panel2)' : chip.bg, color: entry.readOnly ? 'var(--mf-muted)' : chip.fg, fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {entry.readOnly ? '보기 전용' : '칸반 카드'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" aria-label="닫기" onClick={controller.closeCalendarCard} className="mf-ctl" style={{ width: 30, height: 30, borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '0 18px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* 제목은 읽기만 — 글자 편집은 칸반의 일이다. */}
          <span data-cal-detail-title style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--mf-text)', wordBreak: 'break-word' }}>{entry.title || '제목 없음'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>
            {entry.boardName} · {entry.spaceName}
            {entry.owner ? ` · ${entry.owner}` : ''}
            {entry.tag ? ` · ${entry.tag}` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 18px 4px' }}>
          {/* 상태(열) — 옮기면 그 칸반에 저장된다. 마지막 열(완료)로 옮기면 달력에서 빠진다. */}
          {/* 보기 전용으로 공유받은 보드는 고칠 수 없다 — 고쳐지는 척하는 화면을
              만들지 않는다(이 앱의 보기 전용 원칙). 진짜 게이트는 서버 RLS다. */}
          {entry.readOnly && (
            <span data-cal-detail-ro style={{ fontSize: 11.5, color: 'var(--mf-muted)', background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)', borderRadius: 10, padding: '9px 11px' }}>
              보기 전용으로 공유받은 보드예요. 상태와 날짜는 이 보드의 편집 권한이 있어야 고칠 수 있어요.
            </span>
          )}

          {!entry.readOnly && columns.length > 1 && (
            <Field label="상태">
              <Segmented
                label="상태"
                value={entry.colId}
                onChange={(colId) => {
                  if (colId === entry.colId) return;
                  void run(async () => {
                    const ok = await controller.moveDashCard(entry.docId, entry.cardId, colId);
                    // 완료 열로 옮기면 이 항목은 달력에서 빠진다 — 팝업도 닫는다.
                    if (ok && colId === columns[columns.length - 1]?.id) controller.closeCalendarCard();
                    return ok;
                  });
                }}
                track={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: 3, borderRadius: 11, background: 'var(--mf-panel2)', border: '1px solid var(--mf-border)' }}
                trackAttrs={{ 'data-cal-state': '1' }}
                itemClass="mf-ctl"
                items={columns.map((c, i) => ({
                  value: c.id,
                  label: c.title || '이름 없음',
                  attrs: { 'data-cal-state-item': c.id },
                  style: (on: boolean): CSSProperties => ({
                    flex: '1 1 auto',
                    minWidth: 0,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 9,
                    border: 0,
                    font: 'inherit',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: saving ? 'progress' : 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    background: on ? 'var(--mf-card)' : 'transparent',
                    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
                    boxShadow: on ? '0 2px 6px -4px rgba(0,0,0,.35)' : 'none',
                  }),
                  ...(i === columns.length - 1 ? { title: '완료로 옮기면 달력에서 빠져요' } : {}),
                }))}
              />
            </Field>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <DateField
              label="시작일"
              value={entry.start ?? ''}
              max={entry.due}
              disabled={saving || !!entry.readOnly}
              dark={dark}
              onChange={(v) => void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { start: v || null }))}
            />
            <DateField
              label="기한"
              value={entry.due}
              min={entry.start}
              disabled={saving || !!entry.readOnly}
              dark={dark}
              // 기한은 이 항목이 달력에 **있는 이유**다 — 지우면 목록에서 사라지므로
              // 그 동작은 칸반에 남긴다(눌러도 아무 일 없는 `지우기`를 두지 않는다).
              clearable={false}
              onChange={(v) => {
                if (!v) return;
                void run(() => controller.patchCalendarCard(entry.docId, entry.cardId, { due: v }));
              }}
            />
          </div>

          {isSpan(entry) && !entry.readOnly && (
            <span style={{ fontSize: 11.5, color: 'var(--mf-faint)' }}>
              기간 일정 — 달력에서 바를 끌면 시작일과 기한이 함께 움직여요.
            </span>
          )}
        </div>

        {/* 발치 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '18px 18px 24px' : '18px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--mf-faint)' }}>
            {saving ? '저장 중…' : entry.readOnly ? `${entry.boardName} · ${entry.spaceName}` : '변경한 내용은 자동으로 저장돼요'}
          </span>
          <button
            type="button"
            onClick={() => {
              controller.closeCalendarCard();
              controller.openWithLoader(`/editor?map=${encodeURIComponent(entry.docId)}&title=${encodeURIComponent(entry.boardName)}&docId=${encodeURIComponent(entry.docId)}`, entry.boardName, entry.docId);
            }}
            className="mf-ctl"
            style={{ height: isMobile ? 44 : 34, padding: '0 15px', borderRadius: 999, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-text)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            이 칸반 열기
          </button>
        </div>
      </>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.02em', color: 'var(--mf-muted)' }}>{label}</span>
      {children}
    </div>
  );
}

/**
 * 날짜 입력은 **native `<input type="date">`**를 쓴다 — 폰에서 OS 날짜 선택기가
 * 그대로 뜨고(공유 모달의 native select와 같은 판단), 접근성도 공짜다.
 */
function DateField({ label, value, min, max, disabled, clearable = true, dark, onChange }: { label: string; value: string; min?: string; max?: string; disabled?: boolean; clearable?: boolean; dark?: boolean; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Field label={label}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="date"
            aria-label={label}
            value={draft}
            min={min}
            max={max}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              onChange(e.target.value);
            }}
            // 다크 테마에서는 native 날짜 선택기(달력 글리프·팝업)도 함께 뒤집는다 —
            // `color-scheme`을 루트에 두면 에디터의 native 위젯까지 홈 테마를 따른다.
            style={{ flex: 1, minWidth: 0, height: 36, padding: '0 10px', borderRadius: 10, border: '1px solid var(--mf-border)', background: 'var(--mf-card)', color: 'var(--mf-text)', font: 'inherit', fontSize: 12.5, boxSizing: 'border-box', colorScheme: dark ? 'dark' : 'light' }}
          />
          {clearable && value && !disabled && (
            <button type="button" onClick={() => onChange('')} className="mf-ctl" style={{ height: 30, padding: '0 9px', borderRadius: 999, border: 0, background: 'transparent', color: 'var(--mf-muted)', font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              지우기
            </button>
          )}
        </span>
      </Field>
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
  return <CalendarDetail state={state} controller={controller} entry={entry} isMobile={isMobile} />;
}

// 날짜 고르기 팝오버 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `pkOpen`(`pkIsDate`).
//
// **native `<input type="date">`를 쓰지 않는 이유**: 디자인은 이 팝오버 하나를 상세
// 팝업·새 일정·반복 종료일이 함께 쓰고(원본의 `openPk('date', …)`), 발치에 `오늘`·
// `지우기`를 둔다 — native 위젯에는 그 자리가 없고 모양도 브라우저·OS마다 다르다.
//
// 트리거 버튼도 함께 낸다(`DateButton`) — 원본의 `data-pkf` 버튼 꼴(달력 글리프 +
// 라벨, 열려 있으면 강조색 테두리 + 링)이 세 곳에서 같아야 한다.

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Popover } from '../../../components/Popover';
import { DOW, addMonth, isoOf, monthLabel, partsOf, todayISO } from './model';

/**
 * 이 한 벌이 쓰는 색 — 기본은 **홈의 CSS 변수**다.
 *
 * 왜 프롭으로 뚫는가: 홈 변수는 문서 루트에 있어 어느 화면에서나 읽히지만, 그
 * 값은 **사용자가 홈에서 고른 테마**다. 에디터(칸반 카드 상세)가 그걸 그대로
 * 읽으면 다크 홈을 쓰는 사람의 밝은 팝업에 어두운 날짜 버튼이 섞인다 —
 * `ShareTheme`·`FeedbackTheme`와 같은 처방으로 그 화면의 색을 받는다.
 */
export interface DateTone {
  card: string;
  border: string;
  borderSoft: string;
  shadow: string;
  text: string;
  muted: string;
  faint: string;
  faint2: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  accentInk: string;
  panel2: string;
  danger: string;
  info: string;
}

/** 홈에서 쓰는 기본 색 — 지금까지의 값 그대로(호출부 무변경). */
export const CSS_DATE_TONE: DateTone = {
  card: 'var(--mf-card)',
  border: 'var(--mf-border)',
  borderSoft: 'var(--mf-border-soft)',
  shadow: 'var(--mf-card-shadow)',
  text: 'var(--mf-text)',
  muted: 'var(--mf-muted)',
  faint: 'var(--mf-faint)',
  faint2: 'var(--mf-faint2)',
  accent: 'var(--mf-accent)',
  accentSoft: 'var(--mf-accent-soft)',
  accentStrong: 'var(--mf-accent-strong)',
  accentInk: 'var(--mf-accent-ink)',
  panel2: 'var(--mf-panel2)',
  danger: 'var(--mf-danger)',
  info: 'var(--mf-info)',
};

/** `8월 30일 (일)` — 원본 `fmtDateLabel`. 값이 없으면 `날짜 선택`. */
export function dateLabelOf(iso: string | undefined): string {
  const p = iso ? partsOf(iso) : null;
  if (!p) return '날짜 선택';
  const dow = DOW[new Date(p.y, p.m - 1, p.d).getDay()]!;
  return `${p.m}월 ${p.d}일 (${dow})`;
}

/** 달력 글리프 — 원본의 그 도형(둥근 사각 + 고리 둘 + 가로선). */
export function CalendarIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}

/**
 * 날짜 트리거 + 팝오버 한 벌. 값이 바뀌면 `onPick`이 곧바로 불린다(원본과 같이
 * 고르는 즉시 저장 — 확인 버튼이 없다). `null`은 지우기.
 */
export function DateButton({
  value,
  onPick,
  label,
  min,
  disabled,
  clearable = true,
  attrs,
  tone = CSS_DATE_TONE,
  hoverClass = 'mf-ctl',
  height = 38,
}: {
  value: string | undefined;
  onPick: (iso: string | null) => void;
  /** 접근 이름 — `시작일`·`기한`처럼 무엇의 날짜인지. */
  label: string;
  /** 이보다 앞선 날은 고를 수 없다(기한 < 시작일 방지). */
  min?: string;
  disabled?: boolean;
  clearable?: boolean;
  attrs?: Record<string, string>;
  /** 색 한 벌 — 기본은 홈 CSS 변수(`DateTone` 주석 참고). */
  tone?: DateTone;
  /**
   * 손을 얹었을 때 반응하는 방식 — 홈은 `mf-ctl`(면을 갈아 끼운다), 에디터는
   * `mf-ed-btn`(글자색을 옅게 덮는다). 홈 규칙은 면 색까지 **홈 변수**로 바꾸므로
   * 에디터에서 쓰면 색이 그 화면과 어긋난다.
   */
  hoverClass?: string;
  /** 트리거 높이 — 그 화면의 다른 입력과 같아야 한다(에디터 상세는 34). */
  height?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={`${label} 고르기`}
      side="bottom"
      align="start"
      sideOffset={6}
      panel={{
        width: 262,
        boxSizing: 'border-box',
        borderRadius: 16,
        background: tone.card,
        border: `1px solid ${tone.border}`,
        boxShadow: tone.shadow,
        overflow: 'hidden',
        zIndex: 340,
      }}
      trigger={
        <button
          type="button"
          // 팝오버 트리거도 손을 얹으면 반응한다(디자인 원본의 `style-hover`).
          className={hoverClass}
          aria-label={label}
          disabled={disabled}
          {...attrs}
          style={{
            // ⚠️ `flex: 1`을 쓰지 않는다 — 이 버튼의 부모는 **세로 flex**(라벨 위, 버튼
            // 아래)라 `flex-basis: 0`이 **높이**에 걸려 `height`가 통째로 무시된다
            // (실측 40 → 16px. 시각 버튼은 부모가 가로라 같은 값이 살아 있었다).
            width: '100%',
            minWidth: 0,
            height,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            boxSizing: 'border-box',
            borderRadius: 12,
            border: `1px solid ${open ? tone.accent : tone.border}`,
            background: tone.card,
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: tone.text,
            cursor: disabled ? 'default' : 'pointer',
            textAlign: 'left',
            boxShadow: open ? `0 0 0 3px ${tone.accentSoft}` : 'none',
          }}
        >
          <span style={{ color: tone.faint2, display: 'inline-flex' }}>
            <CalendarIcon />
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dateLabelOf(value)}</span>
        </button>
      }
    >
      <DateGrid
        value={value}
        min={min}
        clearable={clearable}
        tone={tone}
        hoverClass={hoverClass}
        onPick={(iso) => {
          setOpen(false);
          onPick(iso);
        }}
      />
    </Popover>
  );
}

/** 팝오버 안의 미니 달력 — 원본 `pkCells`(6주 42칸) + 발치 `오늘`·`지우기`. */
function DateGrid({ value, min, clearable, onPick, tone, hoverClass }: { value: string | undefined; min?: string; clearable: boolean; onPick: (iso: string | null) => void; tone: DateTone; hoverClass: string }) {
  const today = todayISO();
  const seed = partsOf(value ?? '') ?? partsOf(today)!;
  const [ym, setYm] = useState({ y: seed.y, m: seed.m });

  // 항상 6주 = 42칸(월 격자와 같은 규칙 — 달을 넘겨도 높이가 흔들리지 않는다).
  const first = new Date(ym.y, ym.m - 1, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { iso, n: d.getDate(), inMonth: d.getMonth() + 1 === ym.m, blocked: !!min && iso < min };
  });

  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '11px 11px 8px' }}>
        <NavBtn label="이전 달" d="m15 6-6 6 6 6" tone={tone} hoverClass={hoverClass} onClick={() => setYm((p) => addMonth(p.y, p.m, -1))} />
        <span data-datepop-month style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 13, fontWeight: 800, letterSpacing: '-.025em', color: tone.text, whiteSpace: 'nowrap' }}>
          {monthLabel(ym.y, ym.m)}
        </span>
        <NavBtn label="다음 달" d="m9 6 6 6-6 6" tone={tone} hoverClass={hoverClass} onClick={() => setYm((p) => addMonth(p.y, p.m, 1))} />
      </span>

      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, padding: '0 10px 3px' }}>
        {DOW.map((d, i) => (
          <span key={d} style={{ height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 700, color: i === 0 ? tone.danger : i === 6 ? tone.info : tone.faint2 }}>
            {d}
          </span>
        ))}
      </span>

      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, padding: '0 10px 8px' }}>
        {cells.map((c) => {
          const on = c.iso === value;
          const isToday = c.iso === today;
          return (
            <button
              key={c.iso}
              type="button"
              data-datepop-day={c.iso}
              aria-label={`${c.n}일`}
              aria-pressed={on}
              disabled={c.blocked}
              onClick={() => onPick(c.iso)}
              className={c.blocked ? undefined : hoverClass}
              style={{
                height: 30,
                border: 0,
                borderRadius: 999,
                background: on ? tone.accent : isToday ? tone.accentSoft : 'transparent',
                color: on ? tone.accentInk : c.blocked ? tone.faint : c.inMonth ? tone.text : tone.faint,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11.5,
                fontWeight: on || isToday ? 800 : c.inMonth ? 600 : 500,
                cursor: c.blocked ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: c.blocked ? 0.45 : 1,
              }}
            >
              {c.n}
            </button>
          );
        })}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 10px', borderTop: `1px solid ${tone.borderSoft}`, background: tone.panel2 }}>
        <button type="button" className={hoverClass} onClick={() => onPick(today)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 25, padding: '0 11px', border: 0, borderRadius: 999, background: 'transparent', color: tone.accentStrong, font: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
          오늘
        </button>
        <span style={{ flex: 1, minWidth: 0 }} />
        {clearable && (
          <button type="button" className={hoverClass} onClick={() => onPick(null)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', height: 25, padding: '0 11px', border: 0, borderRadius: 999, background: 'transparent', color: tone.muted, font: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            지우기
          </button>
        )}
      </span>
    </>
  );
}

function NavBtn({ label, d, onClick, tone, hoverClass }: { label: string; d: string; onClick: () => void; tone: DateTone; hoverClass: string }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={hoverClass} style={{ width: 26, height: 26, flex: '0 0 auto', border: 0, borderRadius: 999, background: 'transparent', color: tone.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

/** 원본의 알약 칩 스타일 — 상세 팝업의 `상태`(라디오)·`분류`(버튼)가 같은 꼴을 쓴다. */
export function pillStyle(on: boolean, dashed = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 34,
    padding: '0 15px',
    borderRadius: 999,
    border: dashed ? '1.5px dashed var(--mf-border)' : `1.5px solid ${on ? 'var(--mf-accent-mute)' : 'var(--mf-border)'}`,
    background: dashed ? 'transparent' : on ? 'var(--mf-accent-soft)' : 'var(--mf-card)',
    color: on ? 'var(--mf-accent-strong)' : 'var(--mf-muted)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: on ? 800 : 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  };
}

export function PillButton({ on, dot, children, onClick, attrs, dashed }: { on: boolean; dot?: string; children: ReactNode; onClick: () => void; attrs?: Record<string, string>; dashed?: boolean }) {
  return (
    // 켜짐을 `aria-pressed`로 알린다 — 종일 토글은 두 상태 버튼이고, 분류 알약은
    // 통계 칩과 같은 "지금 이것"이다(보이는 테두리만으로는 보조기술이 알 수 없다).
    <button type="button" className="mf-ctl" aria-pressed={on} onClick={onClick} {...attrs} style={pillStyle(on, dashed)}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, display: 'block', flex: '0 0 auto' }} />}
      {children}
    </button>
  );
}

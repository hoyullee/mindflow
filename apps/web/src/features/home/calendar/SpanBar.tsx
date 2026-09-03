// 기간 진행 바 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `evHasSpan`.
//
// `N일 중 M일째` + 남은 날 + 하루 한 칸 pip. 칸반 카드 상세가 쓰던 것을 떼어 내
// **일정 상세**(Geurio·구글)도 같은 것을 쓴다(제보 ⑦: 구글 다일 일정에도 진행 바를).
// 값을 두 벌로 두면 같은 "3일 중 2일째"가 화면마다 다르게 읽힌다.

import { daysBetween, partsOf } from './model';

export function SpanBar({ start, due, today }: { start: string | undefined; due: string; today: string }) {
  if (!start || !partsOf(start) || start >= due) return null;
  const total = daysBetween(start, due) + 1;
  if (total < 2 || total > 200) return null; // 지나치게 긴 기간은 pip으로 그릴 뜻이 없다
  const done = Math.max(0, Math.min(total, daysBetween(start, today) + 1));
  const main = done > 0 && done <= total ? `${total}일 중 ${done}일째` : `${total}일간`;
  const rest = today < start ? `${daysBetween(today, start)}일 뒤 시작` : today > due ? '종료' : `${daysBetween(today, due)}일 남음`;
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

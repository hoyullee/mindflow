// 반복 — 디자인 원본 `Geurio 일정 캘린더.dc.html`의 `nRepeatOpts` 블록.
//
// **두 목적지가 함께 쓴다.** 예전에는 구글 전용 묶음 안에 있었는데(구글만 반복을
// 처리해 준다고 봤다), 우리 표(0033)도 규칙을 담게 되면서 Geurio 일정도 반복한다.
// 그래서 이 구획은 "저장할 캘린더"와 무관하게 왼쪽 열에 선다.
//
// 다섯 칸(반복 없음·매일·매주·매월·맞춤)은 하나만 고르는 묶음이라 `Segments`다 —
// ←/→로도 옮겨 다닌다(이 앱의 규칙). `맞춤`을 고르면 원본과 같은 두 행이 펼쳐진다:
// 반복 주기(N × 일/주/개월)와 반복 종료(없음/날짜/횟수).

import { DateButton } from './DatePop';
import { Row, SubText, Segments, Stepper } from './fieldBits';
import type { RecurrenceSpec } from './googleCalendar';
import { applyPreset, presetOf, recurrenceLabel, type RecurrencePreset } from './recurrence';

const PRESETS: { p: RecurrencePreset; label: string }[] = [
  { p: 'none', label: '반복 없음' },
  { p: 'daily', label: '매일' },
  { p: 'weekly', label: '매주' },
  { p: 'monthly', label: '매월' },
  { p: 'custom', label: '맞춤' },
];

const UNITS: { u: RecurrenceSpec['unit']; label: string }[] = [
  { u: 'day', label: '일' },
  { u: 'week', label: '주' },
  { u: 'month', label: '개월' },
];

const END_MODES: { m: RecurrenceSpec['endMode']; label: string }[] = [
  { m: 'none', label: '없음' },
  { m: 'date', label: '날짜' },
  { m: 'count', label: '횟수' },
];

export function RecurrenceField({
  value,
  onChange,
  /** 요약 문구의 기준일(`매주 수요일`·`매월 26일`) — 일정의 시작 날짜. */
  baseDate,
}: {
  value: RecurrenceSpec;
  onChange: (next: RecurrenceSpec) => void;
  baseDate: string;
}) {
  const preset = presetOf(value);
  return (
    <div data-recurrence style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--mf-subtext)' }}>반복</span>
      <Segments aria="반복" items={PRESETS.map((p) => ({ value: p.p, label: p.label }))} value={preset} onChange={(p) => onChange(applyPreset(value, p as RecurrencePreset))} attr="data-rep-preset" wide />

      {preset === 'custom' && (
        // 원본의 맞춤 블록 — 왼쪽에 강조색 세로선을 둔 들여쓴 판.
        <div
          data-rep-custom
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginLeft: 2,
            paddingLeft: 11,
            borderLeft: '2px solid var(--mf-accent-mute)',
          }}
        >
          <Row label="반복 주기">
            <Stepper value={value.interval} min={1} max={30} onChange={(n) => onChange({ ...value, interval: n })} />
            <Segments aria="반복 단위" items={UNITS.map((u) => ({ value: u.u, label: u.label }))} value={value.unit} onChange={(u) => onChange({ ...value, unit: u as RecurrenceSpec['unit'] })} attr="data-rep-unit" />
            <SubText>마다</SubText>
          </Row>
          <Row label="반복 종료">
            <Segments
              aria="반복 종료"
              items={END_MODES.map((e) => ({ value: e.m, label: e.label }))}
              value={value.endMode}
              // `횟수`를 고르면 **기본 횟수를 함께 정한다** — 값이 없으면 규칙에 COUNT가
              // 실리지 않아 "횟수"라 적힌 채 무한 반복이 된다. 날짜는 사용자가 고를
              // 때까지 비워 두고(원본의 `날짜 선택`), 그동안 요약은 "종료 없음"이라 말한다.
              onChange={(m) => onChange({ ...value, endMode: m as RecurrenceSpec['endMode'], ...(m === 'count' ? { count: value.count ?? 5 } : {}) })}
              attr="data-rep-endmode"
            />
            {value.endMode === 'date' && <DateButton label="반복 종료 날짜" value={value.until ?? ''} min={baseDate} clearable={false} attrs={{ 'data-rep-until': '1' }} onPick={(iso) => iso && onChange({ ...value, until: iso })} />}
            {value.endMode === 'count' && (
              <>
                <Stepper value={value.count ?? 5} min={2} max={99} onChange={(n) => onChange({ ...value, count: n })} />
                <SubText>회 반복 후 종료</SubText>
              </>
            )}
          </Row>
        </div>
      )}

      {value.on && (
        <span
          data-rep-summary
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: 'var(--mf-faint2)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: '0 0 auto' }}>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />
          </svg>
          {recurrenceLabel(value, baseDate)}
        </span>
      )}
    </div>
  );
}

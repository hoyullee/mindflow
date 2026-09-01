// 반복 일정 — 규칙과 그 규칙이 만드는 **날짜들**.
//
// 규칙은 문서 원본(`Geurio 일정 캘린더.dc.html`)의 `nRepeatOpts`가 정한 다섯 가지다:
// 반복 없음 · 매일 · 매주 · 매월 · 맞춤(N 일/주/개월 × 종료 없음/날짜/횟수).
//
// **저장은 RRULE 한 줄**이다(`RRULE:FREQ=WEEKLY;INTERVAL=2`). 구글에 만드는 일정이
// 이미 그 형식을 쓰므로(`buildRecurrence`), 우리 표(0033)도 같은 문자열을 담으면
// 나중에 어느 쪽으로 옮겨도 규칙을 다시 짜지 않는다.
//
// 이 파일은 **순수**하다 — 화면도 저장소도 모른다. 그래서 달력·목록·시간표·위젯이
// 같은 규칙으로 같은 날짜를 얻는다(소비처가 갈리면 그 자체가 버그다).

import { addDays, partsOf } from './model';
import { RECURRENCE_OFF, type RecurrenceSpec } from './googleCalendar';

export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

/** 지금 설정이 어느 칸인가 — 사용자가 고른 것을 그대로 되읽는다. */
export function presetOf(r: RecurrenceSpec): RecurrencePreset {
  if (!r.on) return 'none';
  if (r.custom) return 'custom';
  return r.unit === 'day' ? 'daily' : r.unit === 'month' ? 'monthly' : 'weekly';
}

/**
 * 칸을 고르면 규칙이 이렇게 바뀐다. 프리셋 셋은 **1마다 · 종료 없음**이고, `맞춤`은
 * 지금 값을 그대로 들고 상세 행만 펼친다(고르는 순간 값이 초기화되면 놀란다).
 */
export function applyPreset(r: RecurrenceSpec, p: RecurrencePreset): RecurrenceSpec {
  if (p === 'none') return { ...r, on: false, custom: false };
  if (p === 'custom') return { ...r, on: true, custom: true };
  const unit: RecurrenceSpec['unit'] = p === 'daily' ? 'day' : p === 'monthly' ? 'month' : 'week';
  return { ...r, on: true, custom: false, unit, interval: 1, endMode: 'none' };
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const UNIT: Record<RecurrenceSpec['unit'], string> = {
  day: '일',
  week: '주',
  month: '개월',
};

/**
 * 한 줄 요약(원본 `repeatSummary`) — 프리셋은 **규칙만** 간결하게(매주 수요일 반복),
 * 맞춤은 종료 조건까지 붙인다. 종료를 정한 프리셋은 없으므로 꼬리표가 필요 없다.
 */
export function recurrenceLabel(r: RecurrenceSpec, baseDate?: string): string {
  if (!r.on) return '';
  const p = presetOf(r);
  const b = baseDate ? partsOf(baseDate) : null;
  if (p === 'daily') return '매일 반복';
  if (p === 'weekly') return b ? `매주 ${DOW[new Date(b.y, b.m - 1, b.d).getDay()]}요일 반복` : '매주 반복';
  if (p === 'monthly') return b ? `매월 ${b.d}일 반복` : '매월 반복';
  // 맞춤은 **간격을 언제나 적는다**(원본 `repeatSummary`) — 1이면 숫자를 빼면
  // "주마다 반복"처럼 읽혀 어색하다.
  const every = `${r.interval}${UNIT[r.unit]}마다 반복`;
  if (r.endMode === 'date' && r.until) {
    const u = partsOf(r.until);
    return `${every} · ${u ? `${u.y}년 ${u.m}월 ${u.d}일` : r.until} 종료`;
  }
  if (r.endMode === 'count') return `${every} · ${r.count ?? 5}회 반복 후 종료`;
  return `${every} · 종료 없음`;
}

/**
 * 저장된 규칙 문자열 → RRULE 줄과 **제외한 회차들**(이 일정만 삭제 — EXDATE).
 *
 * 회차 하나를 지우는 일은 별도 칼럼이 아니라 **같은 문자열의 줄**로 담는다
 * (`RRULE:...\nEXDATE:20260901,20260908`) — iCalendar가 쓰는 그 이름이고, 저장이
 * 한 칸이라 마이그레이션도 어댑터 변경도 없다(검증 `/^RRULE:/`은 줄 시작이 그대로다).
 */
export function ruleParts(rule: string): { rrule: string; exdates: string[] } {
  const lines = rule.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rrule = lines.find((l) => /^RRULE:/i.test(l)) ?? '';
  const exdates: string[] = [];
  for (const line of lines) {
    const m = /^EXDATE:(.+)$/i.exec(line);
    if (!m) continue;
    for (const tok of m[1]!.split(',')) {
      const d = /^(\d{4})(\d{2})(\d{2})$/.exec(tok.trim());
      if (d) exdates.push(`${d[1]}-${d[2]}-${d[3]}`);
    }
  }
  return { rrule, exdates };
}

/** ISO → RRULE의 날짜 표기(`YYYYMMDD`). */
function compact(iso: string): string {
  return iso.replaceAll('-', '');
}

/** "이 일정만 삭제" — 그 회차를 제외 목록에 더한 규칙 문자열. */
export function excludeOccurrence(rule: string, occurrenceIso: string): string {
  const { rrule, exdates } = ruleParts(rule);
  const set = [...new Set([...exdates, occurrenceIso])].sort();
  return `${rrule}\nEXDATE:${set.map(compact).join(',')}`;
}

/**
 * "이 일정과 이후 일정 삭제" — 규칙의 끝을 `lastIso`로 당긴다(UNTIL). COUNT는 함께
 * 버린다: 끝이 당겨진 만큼 회차는 언제나 예전보다 적으므로 남겨 둘 뜻이 없다.
 * 이미 제외한 회차(EXDATE)는 그대로 남는다 — 남는 구간의 구멍은 유효하다.
 */
export function endRuleBefore(rule: string, lastIso: string): string {
  const { rrule, exdates } = ruleParts(rule);
  const body = rrule
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p));
  body.push(`UNTIL=${compact(lastIso)}`);
  const head = `RRULE:${body.join(';')}`;
  return exdates.length ? `${head}\nEXDATE:${exdates.map(compact).join(',')}` : head;
}

/** RRULE 한 줄 → 설정. 우리가 만든 것만 읽는다(모르는 규칙은 null → 반복 없음으로 본다). */
export function parseRecurrence(rule: string | undefined): RecurrenceSpec | null {
  if (!rule) return null;
  // EXDATE 줄이 붙은 문자열일 수 있다 — 규칙은 RRULE 줄에서만 읽는다.
  const line = ruleParts(rule).rrule || rule.split(/\r?\n/)[0] || '';
  const body = line.replace(/^RRULE:/i, '');
  const kv = new Map<string, string>();
  for (const part of body.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) kv.set(part.slice(0, i).toUpperCase(), part.slice(i + 1));
  }
  const freq = kv.get('FREQ');
  const unit: RecurrenceSpec['unit'] | null = freq === 'DAILY' ? 'day' : freq === 'WEEKLY' ? 'week' : freq === 'MONTHLY' ? 'month' : null;
  if (!unit) return null;
  const interval = Math.max(1, Math.floor(Number(kv.get('INTERVAL') ?? '1')) || 1);
  const untilRaw = kv.get('UNTIL');
  const until = untilRaw && /^(\d{4})(\d{2})(\d{2})/.exec(untilRaw) ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}` : undefined;
  const count = kv.get('COUNT') ? Math.max(1, Math.floor(Number(kv.get('COUNT'))) || 1) : undefined;
  const endMode: RecurrenceSpec['endMode'] = count ? 'count' : until ? 'date' : 'none';
  // `맞춤`으로 볼 것: 간격이 2 이상이거나 종료 조건이 있는 규칙(프리셋으로는 만들 수 없다).
  const custom = interval > 1 || endMode !== 'none';
  return {
    ...RECURRENCE_OFF,
    on: true,
    unit,
    interval,
    endMode,
    custom,
    ...(until ? { until } : {}),
    ...(count ? { count } : {}),
  };
}

/** 달을 더하되 그 달에 없는 날은 말일로 당긴다(1/31 + 1개월 = 2/28). */
function addMonths(iso: string, n: number): string {
  const p = partsOf(iso);
  if (!p) return iso;
  const y = p.y + Math.floor((p.m - 1 + n) / 12);
  const m = ((((p.m - 1 + n) % 12) + 12) % 12) + 1;
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(p.d, last);
  return `${y}-${`${m}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`;
}

/** 무한 규칙(종료 없음)도 유한하게 — 구간 밖으로 나가면 멈추므로 안전망이다. */
const MAX_OCCURRENCES = 1000;

/**
 * 규칙이 만드는 시작일들 중 `[from, to]`와 겹치는 것.
 *
 * 규칙이 없거나 읽을 수 없으면 **원래 하루**만 돌려준다 — "반복이 아니다"가 곧
 * "그 날 하나"이므로, 호출부가 두 경우를 갈라 다룰 필요가 없다.
 *
 * @param spanDays 하나의 발생이 며칠짜리인가(기간 일정) — 구간에 걸치면 포함한다.
 */
export function expandRecurrence(rule: string | undefined, startDate: string, from: string, to: string, spanDays = 0): string[] {
  const spec = parseRecurrence(rule);
  const within = (d: string): boolean => addDays(d, spanDays) >= from && d <= to;
  if (!spec) return within(startDate) ? [startDate] : [];
  // "이 일정만 삭제"로 제외한 회차 — 만들고 나서 거른다(RFC 5545의 순서: COUNT가
  // 회차를 만들고 EXDATE가 뺀다. 반대로 하면 제외한 만큼 뒤 회차가 늘어난다).
  const { exdates } = ruleParts(rule ?? '');
  const step = (d: string, i: number): string => (spec.unit === 'month' ? addMonths(startDate, spec.interval * i) : addDays(d, spec.interval * (spec.unit === 'week' ? 7 : 1)));
  const limit = spec.endMode === 'count' ? Math.min(spec.count ?? 1, MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const out: string[] = [];
  let cur = startDate;
  for (let i = 0; i < limit; i += 1) {
    if (i > 0) cur = step(cur, i);
    if (spec.endMode === 'date' && spec.until && cur > spec.until) break;
    if (cur > to) break;
    if (within(cur) && !exdates.includes(cur)) out.push(cur);
  }
  return out;
}

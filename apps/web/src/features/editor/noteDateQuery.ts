// 멘션 허브(`@`)의 **날짜 후보** — 친 글자를 날짜 목록으로 푸는 계산만 한다.
//
// 순수로 둔 이유 둘. ① 기준 날짜를 **인자로 받는다**(`today`) — 이 저장소는 시계를
// 직접 읽는 테스트로 CI가 여러 번 깨졌다(자정 무렵이냐, 달의 며칠이냐로 결과가
// 갈렸다). 날짜를 밖에서 주면 그 갈림이 아예 생기지 않는다. ② DOM·React를 모른다 —
// 목록을 그리고 고르는 것은 허브 쪽 일이고 여기서는 `iso`와 이름표만 낸다.
//
// 날짜 산술은 일정 화면이 쓰는 `home/calendar/model`을 그대로 가져다 쓴다. 같은 뜻의
// 함수를 두 벌 두면 언젠가 한쪽만 고쳐지고, 그게 곧 "달력과 멘션이 다른 날을 가리키는"
// 버그다(그쪽 `addDays`는 서머타임에 하루가 어긋나지 않게 정오 기준으로 계산한다).

import { DOW, addDays, addMonth, daysBetween, isoOf, partsOf, weekStartISO } from '../home/calendar/model';

/** 멘션 허브의 날짜 후보 한 줄. */
export interface DateHit {
  /** 'YYYY-MM-DD' */
  iso: string;
  /** 목록에 보일 이름 — '오늘' · '내일' · '모레' · '8월 27일' 같은 것 */
  label: string;
  /** 오른쪽 보조 — '8.27 목' */
  sub: string;
}

/** 요일 번호(0=일 … 6=토). `Date`는 산술에만 쓴다 — 시계는 읽지 않는다. */
function dowOf(iso: string): number {
  const p = partsOf(iso);
  return p ? new Date(p.y, p.m - 1, p.d).getDay() : 0;
}

/** 그 달의 날 수 — 없는 날짜(2.30·9.31)를 거르는 자리에서만 쓴다. */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 실제로 있는 날인가. 달력에 없는 날을 후보로 올리면 고른 순간 다른 날이 된다. */
function exists(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * 목록에 보일 이름.
 *
 * 가까운 날은 **숫자보다 말**이 빠르게 읽히므로 오늘·내일·모레·어제를 먼저 쓰고,
 * 그 다음이 같은 주·다음 주의 요일, 그 밖은 날짜 그대로다. 순서를 이렇게 못박아야
 * "모레"와 "이번 주 토요일"이 같은 날일 때 이름이 흔들리지 않는다.
 */
function labelOf(iso: string, today: string, weekly = true): string {
  const n = daysBetween(today, iso);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === 2) return '모레';
  if (n === -1) return '어제';
  /**
   * **숫자로 찾은 날에는 요일 이름표를 붙이지 않는다**(`weekly = false`).
   *
   * `9월`을 쳤는데 `다음 주 화요일`이 나오면 내가 친 것과 화면의 글자가 이어지지
   * 않는다 — 사람은 자기가 친 말이 되돌아오길 기대한다. 요일 이름표는 `금요일`처럼
   * **이름으로 찾았을 때**만 답이 된다. 오늘/내일/모레/어제는 어느 쪽에서도 짧고
   * 분명해서 그대로 둔다.
   */
  if (weekly) {
    const ws = weekStartISO(today);
    const dow = DOW[dowOf(iso)] ?? '';
    if (iso >= ws && iso <= addDays(ws, 6)) return `이번 주 ${dow}요일`;
    if (iso >= addDays(ws, 7) && iso <= addDays(ws, 13)) return `다음 주 ${dow}요일`;
  }
  const p = partsOf(iso);
  return p ? `${p.m}월 ${p.d}일` : iso;
}

/** `8.27 목` — 이름이 '모레'여도 실제 날짜가 함께 보여야 고르기 전에 확인이 된다. */
function subOf(iso: string): string {
  const p = partsOf(iso);
  if (!p) return '';
  return `${p.m}.${p.d} ${DOW[dowOf(iso)] ?? ''}`;
}

/**
 * 이름으로 고를 수 있는 기본 후보.
 *
 * 맞춰 볼 **이름은 못박아** 둔다(보이는 이름표는 `labelOf`가 따로 만든다) — 오늘이
 * 목요일이면 토요일의 이름표는 '모레'가 되는데, 그렇다고 `토요일`이라고 친 사람이
 * 아무것도 못 찾으면 안 되기 때문이다.
 */
function baseCandidates(today: string): { iso: string; name: string }[] {
  const ws = weekStartISO(today);
  return [
    { iso: today, name: '오늘' },
    { iso: addDays(today, 1), name: '내일' },
    { iso: addDays(today, 2), name: '모레' },
    { iso: addDays(ws, 6), name: '이번주토요일' },
    { iso: addDays(ws, 8), name: '다음주월요일' },
  ];
}

/** `금` · `금요일` — 요일 한 글자에 `요일`이 붙어도 같게 읽는다. */
const WEEKDAY = /^([일월화수목금토])(요일)?$/;
/** `8.27` · `8/27` · `8-27` · `8월27일` — 구분 기호만 다르고 뜻은 하나다. */
const MONTH_DAY = /^(\d{1,2})(?:[./-]|월)(\d{1,2})일?$/;
/** `0827` — 네 자리는 월·일 두 자리씩으로만 읽는다(세 자리는 아래 주석 참고). */
const MMDD = /^(\d{2})(\d{2})$/;
/** `27` · `27일` — 달을 말하지 않은 '일(day)만'. */
const DAY_ONLY = /^(\d{1,2})일?$/;
/** `9월` · `9.` — 달만. */
const MONTH_ONLY = /^(\d{1,2})(?:월|\.)$/;

/**
 * 요일 입력을 날짜로. `다음주`/`이번주` 앞머리를 떼고 남은 글자를 요일로 읽는다.
 *
 * 앞머리가 없으면 **다가오는** 그 요일이고, 오늘이 바로 그 요일이면 **다음 주**로
 * 보낸다 — 오늘을 말하고 싶은 사람은 `오늘`이라고 치지 요일 이름을 대지 않는다.
 * 주의 시작은 저장소 공통 규칙인 **일요일**이라 `다음주 금요일`은 이번 주가 끝난 뒤의
 * 금요일이 된다(달력 화면의 `weekStartISO`와 같은 기준이어야 둘이 어긋나지 않는다).
 */
function weekdayHits(q: string, today: string): string[] {
  let rest = q;
  let week: 'coming' | 'this' | 'next' = 'coming';
  if (rest.startsWith('다음주')) {
    week = 'next';
    rest = rest.slice(3);
  } else if (rest.startsWith('이번주')) {
    week = 'this';
    rest = rest.slice(3);
  }
  const m = WEEKDAY.exec(rest);
  if (!m) return [];
  const target = DOW.indexOf(m[1] ?? '');
  if (target < 0) return [];
  if (week === 'coming') {
    // 0이면 오늘이라는 뜻 — 일곱 날 뒤로 민다.
    const delta = (target - dowOf(today) + 7) % 7 || 7;
    return [addDays(today, delta)];
  }
  const ws = weekStartISO(today);
  return [addDays(ws, (week === 'next' ? 7 : 0) + target)];
}

/**
 * 연도가 없는 `8.27`을 언제로 볼 것인가 — **오늘 이후로 가장 가까운** 그 월/일.
 *
 * 멘션으로 날짜를 다는 자리는 대개 앞으로의 약속(마감·회의)이라, 이미 지난 날을
 * 기본으로 내밀면 거의 언제나 틀린 답이 된다. 그래서 올해 것이 지났으면 내년으로
 * 넘긴다. 지난 날을 정말 가리키고 싶으면 달력 행(`다른 날짜 고르기…`)이 있다.
 *
 * 2.29처럼 **있는 해가 드문 날**은 있는 해까지 앞으로 넘긴다(그래서 여덟 해를 본다 —
 * 그레고리력에서 윤년 간격이 최대 8년이다). 2.30처럼 어느 해에도 없는 날은 없는 것이다.
 */
function nearestMonthDay(m: number, d: number, today: string): string[] {
  const p = partsOf(today);
  if (!p || m < 1 || m > 12 || d < 1 || d > 31) return [];
  for (let i = 0; i <= 8; i += 1) {
    const y = p.y + i;
    if (!exists(y, m, d)) continue;
    const iso = isoOf(y, m, d);
    if (iso >= today) return [iso];
  }
  return [];
}

/**
 * `27` — 달을 말하지 않았으니 **이번 달과 다음 달**을 나란히 준다.
 *
 * 이번 달 것이 오늘보다 앞이어도 넣는다(지난 27일을 가리키려는 사람이 있다) — 다만
 * 순서는 이번 달이 먼저, 다음 달이 뒤다. 그 달에 없는 날(9월 31일)은 조용히 빠진다.
 */
function dayOnlyHits(d: number, today: string): string[] {
  const p = partsOf(today);
  if (!p || d < 1 || d > 31) return [];
  const out: string[] = [];
  for (const delta of [0, 1]) {
    const { y, m } = addMonth(p.y, p.m, delta);
    if (exists(y, m, d)) out.push(isoOf(y, m, d));
  }
  return out;
}

/**
 * `9월` — 그 달의 첫 사흘. 달 전체를 목록에 쏟을 수는 없으니 **들머리 세 날**만 준다
 * (나머지는 달력 행으로 간다).
 *
 * 이번 달이면 1일이 아니라 **오늘부터** 센다 — 이미 지난 날로 목록을 채우면 세 줄이
 * 통째로 쓸모없어진다. 그 달을 넘어가면 거기서 끊는다(`12월`을 물었는데 1월이 섞여
 * 나오면 답이 아니다). 지난 달 이름을 대면 내년 그 달로 본다 — `nearestMonthDay`와
 * 같은 근거다.
 */
function monthHits(m: number, today: string): string[] {
  const p = partsOf(today);
  if (!p || m < 1 || m > 12) return [];
  const y = m >= p.m ? p.y : p.y + 1;
  const first = m === p.m ? p.d : 1;
  const last = daysInMonth(y, m);
  const out: string[] = [];
  for (let d = first; d < first + 3 && d <= last; d += 1) out.push(isoOf(y, m, d));
  return out;
}

/**
 * 검색어를 날짜 후보로 푼다. 공백은 무시하고 해석한다.
 *
 * 규칙을 위에서 아래로 모두 적용하고 마지막에 겹치는 `iso`를 하나로 합친다 — `토요일`
 * 하나에도 이름 규칙과 요일 규칙이 같이 걸리는데, 둘이 같은 날을 가리키면 사용자에게는
 * 한 줄이어야 하고 다른 날을 가리키면(오늘이 토요일일 때) 둘 다 보여야 하기 때문이다.
 *
 * @param q   `@` 뒤에 친 글자 (빈 문자열 가능)
 * @param today 기준 날짜 'YYYY-MM-DD' (테스트가 고정값을 넣는다)
 * @returns 겹치는 날짜는 하나로 합친, 사람이 기대하는 순서의 목록
 */
export function dateHits(q: string, today: string): DateHit[] {
  const s = q.replace(/\s+/g, '');
  /** 각 줄이 **이름으로 찾은 것인가** — 이름표를 요일로 붙일지 가른다(`labelOf`). */
  const isos: { iso: string; weekly: boolean }[] = [];
  const byName = (iso: string): void => void isos.push({ iso, weekly: true });
  const byNumber = (iso: string): void => void isos.push({ iso, weekly: false });
  if (!s) {
    // 아무것도 치지 않았을 때는 가장 많이 쓰는 둘만 — 목록의 첫 화면은 짧아야 한다.
    byName(today);
    byName(addDays(today, 1));
  } else {
    // 숫자가 섞였으면 이름 맞추기는 건너뛴다 — 숫자는 날 이름이 될 수 없는데,
    // `27일`의 '일'이 '토요일'에 걸리는 식의 헛다리가 나온다.
    if (!/\d/.test(s)) {
      for (const c of baseCandidates(today)) if (c.name.includes(s)) byName(c.iso);
    }
    weekdayHits(s, today).forEach(byName);
    const md = MONTH_DAY.exec(s) ?? MMDD.exec(s);
    // 세 자리(`827`)는 읽지 않는다 — 8월 27일인지 82월 7일인지 가를 근거가 없고,
    // `112`처럼 1월 12일과 11월 2일이 모두 말이 되는 입력이 실제로 있다.
    if (md) nearestMonthDay(Number(md[1]), Number(md[2]), today).forEach(byNumber);
    const day = DAY_ONLY.exec(s);
    if (day) dayOnlyHits(Number(day[1]), today).forEach(byNumber);
    const mon = MONTH_ONLY.exec(s);
    if (mon) monthHits(Number(mon[1]), today).forEach(byNumber);
  }

  const seen = new Set<string>();
  const out: DateHit[] = [];
  for (const { iso, weekly } of isos) {
    if (seen.has(iso) || !partsOf(iso)) continue;
    seen.add(iso);
    out.push({ iso, label: labelOf(iso, today, weekly), sub: subOf(iso) });
  }
  return out;
}

/**
 * 날짜 그룹 끝에 `다른 날짜 고르기…` 행을 붙일지 — 검색어가 비었거나 숫자·`날`·`달`을
 * 포함하면 참.
 *
 * 날짜를 찾고 있다는 신호가 있을 때만 달력을 권한다. 이름만 친 경우(`금요일`)는 위
 * 후보가 이미 답이라 한 줄을 더 얹을 이유가 없지만, 숫자를 치기 시작했다면 우리가
 * 못 푸는 날짜(지난 해·먼 미래)일 수 있어 빠져나갈 길이 있어야 한다.
 */
export function wantsCalendarRow(q: string): boolean {
  const s = q.replace(/\s+/g, '');
  return !s || /\d/.test(s) || s.includes('날') || s.includes('달');
}

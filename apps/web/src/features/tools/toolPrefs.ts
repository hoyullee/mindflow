/**
 * 도구 설정 — **사용자별**(표 `user_tool_prefs`, 0044). LNB 도구 목록의 표시·이름과
 * 작업 현황의 담당자 목록·휴일 설정을 담는다.
 *
 * 휴일은 **개인 단위**다(결정 2026-09-30 — 스펙의 "워크스페이스 공통"은 그리오에 그런
 * 저장 단위가 없어 개인으로 정했다). 화면 문구도 그렇게 말한다(`내 설정`).
 *
 * 저장된 값은 믿지 않는다 — 모양이 어긋나면 그 칸만 기본값으로 떨어진다(`coerceToolPrefs`).
 */

export type HolidayCountryKey = 'KR' | 'US' | 'JP';
export const HOLIDAY_COUNTRY_KEYS: HolidayCountryKey[] = ['KR', 'US', 'JP'];
export const HOLIDAY_COUNTRY_LABEL: Record<HolidayCountryKey, string> = { KR: '한국', US: '미국', JP: '일본' };

export type HolidayRepeat = 'none' | 'yearly' | 'monthly' | 'weekly';

export interface CompanyHoliday {
  /** `YYYY-MM-DD` — 반복이면 **이 날부터** 적용된다. */
  d: string;
  name: string;
  repeat: HolidayRepeat;
}

export interface JiraPersonRef {
  id: string;
  name: string;
  /** 이 사람의 정보를 Jira에서 받은 시각(ISO) — Atlassian 개인정보 보고의 `updatedAt`(jira-privacy). */
  at?: string;
}

export interface WorkStatusPrefs {
  /** 이 화면에서 **끈** 담당자(accountId). 기본은 티켓이 있는 모든 담당자가 켜져 있다 —
   *  켠 목록이 아니라 끈 목록을 드는 이유: 새로 배정된 사람이 저절로 보여야 한다. */
  hidden: string[];
  /** 검색으로 직접 더한 Jira 사용자(티켓이 없어도 목록·일정 맞춰보기에 선다). */
  extra: JiraPersonRef[];
  country: HolidayCountryKey;
  /** 주말도 영업일로 센다(교대·주말 근무 팀). */
  weekend: boolean;
  /** 근무일로 처리한 공휴일(`YYYY-MM-DD`). */
  exceptions: string[];
  company: CompanyHoliday[];
}

export interface JiraToolPrefs {
  /** 왼쪽 목록에 표시. */
  show: boolean;
  /** 왼쪽 목록 이름 — `null`이면 기본 이름(`작업 현황`). */
  label: string | null;
}

export interface ToolPrefs {
  jira: JiraToolPrefs;
  work: WorkStatusPrefs;
}

export const DEFAULT_WORK_PREFS: WorkStatusPrefs = { hidden: [], extra: [], country: 'KR', weekend: false, exceptions: [], company: [] };
export const DEFAULT_TOOL_PREFS: ToolPrefs = { jira: { show: true, label: null }, work: DEFAULT_WORK_PREFS };

/** 목록 이름의 최대 길이 — LNB 한 줄에 말줄임으로 들어가는 정도. */
export const TOOL_LABEL_MAX = 24;
/** 추가 휴일·직접 더한 담당자의 상한 — 설정 한 행이 무한히 자라지 않게. */
const LIST_CAP = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

export function normalizeLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, TOOL_LABEL_MAX);
  return t ? t : null;
}

export function coerceWorkPrefs(raw: unknown): WorkStatusPrefs {
  const w = obj(raw);
  if (!w) return DEFAULT_WORK_PREFS;
  const strs = (v: unknown, re?: RegExp) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200 && (!re || re.test(x))))].slice(0, LIST_CAP) : []);
  const extra: JiraPersonRef[] = [];
  if (Array.isArray(w.extra)) {
    const seen = new Set<string>();
    for (const p of w.extra) {
      const o = obj(p);
      if (!o || typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
      seen.add(o.id);
      extra.push({ id: o.id, name: typeof o.name === 'string' && o.name ? o.name.slice(0, 80) : '이름 없음', ...(typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? { at: o.at } : {}) });
      if (extra.length >= LIST_CAP) break;
    }
  }
  const company: CompanyHoliday[] = [];
  if (Array.isArray(w.company)) {
    for (const h of w.company) {
      const o = obj(h);
      if (!o || typeof o.d !== 'string' || !DATE_RE.test(o.d) || typeof o.name !== 'string' || !o.name.trim()) continue;
      const repeat: HolidayRepeat = o.repeat === 'yearly' || o.repeat === 'monthly' || o.repeat === 'weekly' ? o.repeat : 'none';
      company.push({ d: o.d, name: o.name.trim().slice(0, 40), repeat });
      if (company.length >= LIST_CAP) break;
    }
  }
  return {
    hidden: strs(w.hidden),
    extra,
    country: HOLIDAY_COUNTRY_KEYS.includes(w.country as HolidayCountryKey) ? (w.country as HolidayCountryKey) : 'KR',
    weekend: w.weekend === true,
    exceptions: strs(w.exceptions, DATE_RE),
    company,
  };
}

export function coerceToolPrefs(raw: unknown): ToolPrefs {
  const r = obj(raw);
  if (!r) return DEFAULT_TOOL_PREFS;
  const j = obj(r.jira);
  return {
    jira: { show: j ? j.show !== false : true, label: normalizeLabel(j?.label) },
    work: coerceWorkPrefs(r.work),
  };
}

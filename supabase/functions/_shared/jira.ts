// Jira 조회의 **순수한 부분** — JQL을 짓고, 응답을 화면이 쓰는 모양으로 줄이고,
// 시작일 필드를 고른다. Deno·네트워크 의존이 없어서 웹 쪽 vitest가 그대로 검사한다
// (`apps/web/src/features/tools/jira/jiraShared.test.ts`).
//
// ── 왜 서버에서 줄이는가 ──────────────────────────────────────────────
// Jira 이슈 응답은 필드마다 객체가 겹겹이라 한 건이 수 KB다. 화면에 필요한 것은
// 키·요약·부모·담당자·상태 분류·두 날짜뿐이라, 여기서 줄여 보내면 한 달치가 수십 KB로 끝난다.
// 그리고 **담당자의 이메일 같은 것은 애초에 싣지 않는다**(Jira가 숨기기도 하고, 우리가 쓸 일도 없다).

export type TicketStatus = 'todo' | 'doing' | 'done';

export interface JiraPerson {
  /** Atlassian accountId. */
  id: string;
  name: string;
}

export interface JiraEpic {
  key: string;
  name: string;
  /** `YYYY-MM-DD` 또는 null(에픽에 날짜가 없다). */
  start: string | null;
  end: string | null;
  status: TicketStatus;
}

export interface JiraTicket {
  key: string;
  summary: string;
  /** 부모 에픽의 키. */
  epic: string;
  person: JiraPerson;
  start: string;
  end: string;
  status: TicketStatus;
  /** 시작일 필드가 비어 있어 기한 하루로 그렸다 — 화면이 `시작일 없음`을 붙인다. */
  startMissing: boolean;
  /** 기한이 비어 있어 시작일 하루로 그렸다 — 화면이 `기한 없음`을 붙인다. */
  endMissing: boolean;
}

export interface JiraProjectRef {
  key: string;
  name: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{0,19}$/;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const FIELD_RE = /^customfield_(\d{1,9})$/;

export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v);
export const isProjectKey = (v: unknown): v is string => typeof v === 'string' && PROJECT_KEY_RE.test(v);
export const isIssueKey = (v: unknown): v is string => typeof v === 'string' && ISSUE_KEY_RE.test(v);
export const isCustomField = (v: unknown): v is string => typeof v === 'string' && FIELD_RE.test(v);

/** `customfield_10015` → JQL의 `cf[10015]`. 모양이 어긋나면 null(JQL에 날것을 넣지 않는다). */
export function jqlField(fieldId: string): string | null {
  const m = FIELD_RE.exec(fieldId);
  return m ? `cf[${m[1]}]` : null;
}

/** Jira의 상태 **분류**(`statusCategory.key`)를 세 칸으로. 모르는 값은 예정으로 둔다. */
export function statusOf(categoryKey: unknown): TicketStatus {
  if (categoryKey === 'done') return 'done';
  if (categoryKey === 'indeterminate') return 'doing';
  return 'todo';
}

/**
 * 한 기간에 걸친 **에픽의 자식 티켓**을 찾는 JQL.
 *
 * - 하위 작업(sub-task)은 빼고(`standardIssueTypes()`) 부모가 있는 것만 — 회사·팀 관리
 *   프로젝트 모두 에픽의 자식은 `parent`로 잡힌다(2024 통합). 부모가 정말 에픽인지는
 *   응답의 계층으로 한 번 더 거른다(`normalizeTicket`).
 * - 날짜: 시작일 필드가 있으면 **[시작, 기한]이 기간과 겹치는 것** + 한쪽만 있는 것은
 *   그 하루가 기간 안인 것. 둘 다 없는 티켓은 그릴 자리가 없어 JQL에서부터 뺀다.
 */
export function ticketsJql(projects: string[], from: string, to: string, startField: string | null): string | null {
  const keys = projects.filter(isProjectKey);
  if (!keys.length || !isDate(from) || !isDate(to) || from > to) return null;
  const sf = startField ? jqlField(startField) : null;
  const inRange = (f: string) => `(${f} >= "${from}" AND ${f} <= "${to}")`;
  const date = sf
    ? `((duedate >= "${from}" AND ${sf} <= "${to}") OR (${sf} is EMPTY AND ${inRange('duedate')}) OR (duedate is EMPTY AND ${inRange(sf)}))`
    : inRange('duedate');
  return `project in (${keys.join(', ')}) AND issuetype in standardIssueTypes() AND parent is not EMPTY AND assignee is not EMPTY AND ${date} ORDER BY key ASC`;
}

/** 에픽 몇 개의 날짜·이름을 한 번에. 키 모양이 틀린 것은 뺀다. */
export function epicsJql(keys: string[]): string | null {
  const ok = [...new Set(keys.filter(isIssueKey))];
  return ok.length ? `key in (${ok.join(', ')})` : null;
}

/** 조회에 실을 필드 목록 — 시작일 필드는 사이트마다 이름이 달라 끝에 붙인다. */
export function ticketFields(startField: string | null): string[] {
  const f = ['summary', 'assignee', 'status', 'duedate', 'parent'];
  if (startField && isCustomField(startField)) f.push(startField);
  return f;
}

export function epicFields(startField: string | null): string[] {
  const f = ['summary', 'status', 'duedate'];
  if (startField && isCustomField(startField)) f.push(startField);
  return f;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** Jira 날짜 필드는 `YYYY-MM-DD`거나(기한·날짜 선택기) 시각이 붙어 온다(일부 커스텀) — 앞 10자만. */
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && DATE_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/** 부모가 **에픽 계층**인가 — 계층 번호(1)가 있으면 그것으로, 없으면 이름으로. */
function isEpicParent(parent: Obj): boolean {
  const pf = obj(parent.fields);
  const it = obj(pf?.issuetype);
  if (!it) return true; // 계층 정보를 안 주는 사이트 — JQL이 이미 부모 있는 것만 골랐다
  if (typeof it.hierarchyLevel === 'number') return it.hierarchyLevel === 1;
  const name = str(it.name)?.toLowerCase() ?? '';
  return name === 'epic' || name === '에픽';
}

/**
 * 검색 결과 한 건 → 화면의 티켓. 그릴 수 없는 것(담당자·부모·날짜가 없음)은 null.
 * 시작일이 없으면 **기한 하루**로 둔다(생성일로 두면 몇 달짜리 막대가 되어 진행 일수가
 * 부풀었다 — 2026-09-30 결정). 기한이 없으면 시작일 하루.
 */
export function normalizeTicket(issue: unknown, startField: string | null): JiraTicket | null {
  const it = obj(issue);
  const key = str(it?.key);
  const f = obj(it?.fields);
  if (!it || !key || !f) return null;
  const parent = obj(f.parent);
  const epic = str(parent?.key);
  if (!parent || !epic || !isEpicParent(parent)) return null;
  const a = obj(f.assignee);
  const pid = str(a?.accountId);
  if (!a || !pid) return null;
  const due = day(f.duedate);
  const st = startField ? day(f[startField]) : null;
  const start = st ?? due;
  const end = due ?? st;
  if (!start || !end) return null;
  // 시작이 기한보다 늦게 적힌 티켓(흔한 입력 실수) — 순서를 바로잡아 하루 이상은 그린다.
  const [s, e] = start <= end ? [start, end] : [end, start];
  return {
    key,
    summary: str(f.summary) ?? key,
    epic,
    person: { id: pid, name: str(a.displayName) ?? '이름 없음' },
    start: s,
    end: e,
    status: statusOf(obj(obj(f.status)?.statusCategory)?.key),
    startMissing: !st,
    endMissing: !due,
  };
}

export function normalizeEpic(issue: unknown, startField: string | null): JiraEpic | null {
  const it = obj(issue);
  const key = str(it?.key);
  const f = obj(it?.fields);
  if (!it || !key || !f) return null;
  const due = day(f.duedate);
  const st = startField ? day(f[startField]) : null;
  return {
    key,
    name: str(f.summary) ?? key,
    start: st,
    end: due,
    status: statusOf(obj(obj(f.status)?.statusCategory)?.key),
  };
}

/** 부모 필드만으로도 에픽의 이름은 안다 — 에픽 조회가 실패해도 칩에 이름은 붙는다. */
export function epicFromParent(issue: unknown): JiraEpic | null {
  const parent = obj(obj(obj(issue)?.fields)?.parent);
  const key = str(parent?.key);
  if (!parent || !key) return null;
  const pf = obj(parent.fields);
  return { key, name: str(pf?.summary) ?? key, start: null, end: null, status: statusOf(obj(obj(pf?.status)?.statusCategory)?.key) };
}

interface FieldMeta {
  id: string;
  name: string;
}

/**
 * 시작일로 쓸 필드를 고른다(`GET /rest/api/3/field`의 응답).
 *
 * 이름은 **사용자 언어로 번역돼** 올 수 있어서(예: `시작 날짜`) 이름 하나로 찾지 않는다.
 * 순서: ① Jira 기본 `Start date`(날짜 선택기) ② Advanced Roadmaps의 `Target start`
 * ③ 이름에 start·시작이 든 날짜 필드. 없으면 null — 그때 티켓은 기한 하루로 그린다.
 */
export function pickStartField(fields: unknown): FieldMeta | null {
  if (!Array.isArray(fields)) return null;
  const dates: { id: string; name: string; custom: string }[] = [];
  for (const raw of fields) {
    const f = obj(raw);
    const id = str(f?.id);
    const name = str(f?.name);
    const schema = obj(f?.schema);
    if (!f || !id || !name || !isCustomField(id) || !schema) continue;
    if (schema.type !== 'date' && schema.type !== 'datetime') continue;
    dates.push({ id, name, custom: str(schema.custom) ?? '' });
  }
  const norm = (s: string) => s.trim().toLowerCase();
  const exact = ['start date', '시작일', '시작 날짜', '開始日'];
  const byRank = [
    dates.find((d) => d.custom.endsWith(':datepicker') && exact.includes(norm(d.name))),
    dates.find((d) => exact.includes(norm(d.name))),
    dates.find((d) => /jpo-custom-field-baseline-start/.test(d.custom) || norm(d.name) === 'target start'),
    dates.find((d) => /start|시작/.test(norm(d.name))),
  ];
  const hit = byRank.find((d) => !!d);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** 사용자 검색 응답 → 사람 목록. 앱·봇 계정과 비활성 계정은 뺀다. */
export function normalizeUsers(users: unknown): JiraPerson[] {
  if (!Array.isArray(users)) return [];
  const out: JiraPerson[] = [];
  for (const raw of users) {
    const u = obj(raw);
    const id = str(u?.accountId);
    if (!u || !id || u.active === false || (u.accountType && u.accountType !== 'atlassian')) continue;
    out.push({ id, name: str(u.displayName) ?? '이름 없음' });
  }
  return out;
}

/** 저장해 둘 프로젝트 목록 — 모양을 확인하고 30개로 자른다(JQL 길이와 조회 시간의 상한). */
export const MAX_PROJECTS = 30;
export function coerceProjects(v: unknown): JiraProjectRef[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: JiraProjectRef[] = [];
  for (const raw of v) {
    const p = obj(raw);
    const key = str(p?.key);
    if (!p || !isProjectKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: (str(p.name) ?? key).slice(0, 120) });
    if (out.length >= MAX_PROJECTS) break;
  }
  return out;
}

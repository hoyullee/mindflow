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
  /** 부모 에픽의 키 — 에픽이 없는 티켓은 **프로젝트 키**(그 프로젝트로 묶는다 — 2026-10-01). */
  epic: string;
  person: JiraPerson;
  start: string;
  end: string;
  status: TicketStatus;
  /** 시작일 필드가 비어 있어 기한 하루로 그렸다 — 화면이 `시작일 없음`을 붙인다. */
  startMissing: boolean;
  /** 기한이 비어 있어 시작일 하루로 그렸다 — 화면이 `기한 없음`을 붙인다. */
  endMissing: boolean;
  /** 두 날짜가 다 비어 만든 날 ~ 해결된 날(아직이면 오늘)로 그렸다(`DateRule.fill`). */
  filled?: boolean;
}

/**
 * **어느 날짜로 그릴지**(0045 — 사용자가 프로젝트 고르기에서 정한다).
 * - `start`: 커스텀 날짜 필드 · `created`(만든 날) · null(시작 없이 끝 날짜 하루로)
 * - `end`: `duedate`(기한) · `resolutiondate`(해결된 날 — 아직이면 오늘까지) · 커스텀 날짜 필드
 * - `fill`: 둘 다 비면 만든 날 ~ 해결된 날(아직이면 오늘)
 */
export interface DateRule {
  start: string | null;
  end: string;
  fill: boolean;
}

export const DEFAULT_RULE: DateRule = { start: null, end: 'duedate', fill: true };

/** 고른 이슈 유형 하나(id는 프로젝트마다 다를 수 있다 — 팀 관리 프로젝트). */
export interface JiraIssueTypeRef {
  id: string;
  name: string;
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
const TYPE_ID_RE = /^\d{1,12}$/;
export const isTypeId = (v: unknown): v is string => typeof v === 'string' && TYPE_ID_RE.test(v);
export const isStartField = (v: unknown): v is string => v === 'created' || isCustomField(v);
export const isEndField = (v: unknown): v is string => v === 'duedate' || v === 'resolutiondate' || isCustomField(v);

/** 저장된 값 → 규칙. 모양이 틀린 것은 기본값으로(JQL에 날것을 넣지 않는다). */
export function coerceRule(start: unknown, end: unknown, fill: unknown): DateRule {
  return { start: isStartField(start) ? start : null, end: isEndField(end) ? end : 'duedate', fill: fill !== false };
}

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

/** JQL에서 그 필드를 부르는 이름 — 커스텀은 `cf[N]`, 해결된 날은 `resolved`. 모양이 틀리면 null. */
function jqlName(id: string): string | null {
  if (id === 'duedate' || id === 'created') return id;
  if (id === 'resolutiondate') return 'resolved';
  return jqlField(id);
}

/** `YYYY-MM-DD`의 다음 날 — 시각이 붙은 필드(만든 날·해결된 날)는 `<= 그날`이 그날 0시까지라 `< 다음 날`로 묻는다. */
export function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * 한 기간에 걸친 티켓을 찾는 JQL.
 *
 * - 하위 작업(sub-task)은 뺀다(`standardIssueTypes()`). 에픽 자신은 응답의 계층으로 거른다
 *   (`normalizeTicket`). 예전에는 **부모(에픽)가 있는 것만** 불렀는데, 에픽을 안 쓰는 프로젝트
 *   (비즈니스 템플릿 등)가 통째로 비었다(제보 2026-10-01) — 이제 에픽이 없으면 프로젝트로 묶는다.
 * - 날짜: [시작, 끝]이 기간과 겹치는 것 + 한쪽만 있는 것은 그 하루가 기간 안인 것.
 *   끝이 `해결된 날`이면 아직 안 끝난 것은 오늘까지 이어지므로 **시작이 기간 끝 전**이면 부른다.
 *   `fill`이면 두 날짜가 다 빈 것도 만든 날로 부른다. 겹침의 마지막 판정은 정리한 뒤에 한다(`overlaps`).
 */
export function ticketsJql(projects: string[], from: string, to: string, rule: DateRule = DEFAULT_RULE, types: string[] = []): string | null {
  const keys = projects.filter(isProjectKey);
  const typeIds = [...new Set(types.filter(isTypeId))];
  if (!keys.length || !isDate(from) || !isDate(to) || from > to) return null;
  const e = jqlName(rule.end) ?? 'duedate';
  const s = rule.start ? jqlName(rule.start) : null;
  const to1 = nextDay(to);
  const inRange = (f: string) => `(${f} >= "${from}" AND ${f} < "${to1}")`;
  const openEnd = rule.end === 'resolutiondate';
  const parts: string[] = [];
  if (s && s !== e) {
    parts.push(`(${e} >= "${from}" AND ${s} < "${to1}")`);
    if (s !== 'created') parts.push(`(${s} is EMPTY AND ${inRange(e)})`);
    parts.push(openEnd ? `(${e} is EMPTY AND ${s} < "${to1}")` : `(${e} is EMPTY AND ${inRange(s)})`);
  } else {
    parts.push(inRange(e));
  }
  if (rule.fill) {
    const empty = s && s !== e && s !== 'created' ? `${s} is EMPTY AND ${e} is EMPTY` : `${e} is EMPTY`;
    // `created`가 시작이면 시작이 비는 일이 없다 — 위의 열린 끝 조건이 이미 다 부른다.
    if (s !== 'created') parts.push(`(${empty} AND created < "${to1}" AND (resolved is EMPTY OR resolved >= "${from}"))`);
  }
  const typeQ = typeIds.length ? ` AND issuetype in (${typeIds.join(', ')})` : '';
  return `project in (${keys.join(', ')}) AND issuetype in standardIssueTypes()${typeQ} AND assignee is not EMPTY AND (${parts.join(' OR ')}) ORDER BY key ASC`;
}

/** 정리한 티켓이 기간과 겹치는가 — JQL이 넉넉히 부른 것(열린 끝·날짜 채우기)의 마지막 판정. */
export const overlaps = (t: { start: string; end: string }, from: string, to: string) => t.start <= to && t.end >= from;

/** 에픽 몇 개의 날짜·이름을 한 번에. 키 모양이 틀린 것(프로젝트 묶음 등)은 뺀다. */
export function epicsJql(keys: string[]): string | null {
  const ok = [...new Set(keys.filter(isIssueKey))];
  return ok.length ? `key in (${ok.join(', ')})` : null;
}

const ruleFields = (rule: DateRule) => [...new Set([rule.end, ...(rule.start ? [rule.start] : []), ...(rule.fill ? ['created', 'resolutiondate'] : [])])].filter((f) => f === 'duedate' || isStartField(f) || isEndField(f));

/** 조회에 실을 필드 목록 — 날짜 필드는 사이트마다·고른 규칙마다 달라 끝에 붙인다. */
export function ticketFields(rule: DateRule = DEFAULT_RULE): string[] {
  return [...new Set(['summary', 'assignee', 'status', 'parent', 'project', 'issuetype', ...ruleFields(rule)])];
}

export function epicFields(rule: DateRule = DEFAULT_RULE): string[] {
  return [...new Set(['summary', 'status', rule.end, ...(rule.start ? [rule.start] : [])])];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** Jira 날짜 필드는 `YYYY-MM-DD`거나(기한·날짜 선택기) 시각이 붙어 온다(만든 날·일부 커스텀) — 앞 10자만(사이트 시간대의 날짜다). */
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && DATE_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/** 부모가 **에픽 계층**인가 — 계층 번호(1)가 있으면 그것으로, 없으면 이름으로. */
function isEpicParent(parent: Obj): boolean {
  const pf = obj(parent.fields);
  const it = obj(pf?.issuetype);
  if (!it) return true; // 계층 정보를 안 주는 사이트 — 부모가 있으면 에픽으로 본다
  if (typeof it.hierarchyLevel === 'number') return it.hierarchyLevel === 1;
  const name = str(it.name)?.toLowerCase() ?? '';
  return name === 'epic' || name === '에픽';
}

/** 티켓 자신이 에픽(이상) 계층인가 — 그것은 묶음이지 막대가 아니다. */
function isEpicItself(f: Obj): boolean {
  const it = obj(f.issuetype);
  return !!it && typeof it.hierarchyLevel === 'number' && it.hierarchyLevel >= 1;
}

/**
 * 검색 결과 한 건 → 화면의 티켓. 그릴 수 없는 것(담당자·날짜가 없음 · 에픽 자신)은 null.
 *
 * - 묶음: 부모가 에픽이면 그 에픽, 아니면 **프로젝트**(키가 곧 묶음 키 — 에픽 키와 모양이 달라 겹치지 않는다).
 * - 날짜: 시작이 없으면 **끝 하루**(생성일로 두면 몇 달짜리 막대가 되어 진행 일수가 부풀었다 —
 *   2026-09-30 결정 — 그래서 만든 날은 사용자가 고를 때만), 끝이 없으면 시작 하루.
 *   끝이 `해결된 날`인데 아직 안 끝났으면 오늘까지. 둘 다 없고 `fill`이면 만든 날 ~ 해결된 날(아직이면 오늘).
 */
export function normalizeTicket(issue: unknown, rule: DateRule = DEFAULT_RULE, today?: string): JiraTicket | null {
  const it = obj(issue);
  const key = str(it?.key);
  const f = obj(it?.fields);
  if (!it || !key || !f || isEpicItself(f)) return null;
  const parent = obj(f.parent);
  const parentKey = str(parent?.key);
  const projectKey = str(obj(f.project)?.key);
  const epic = parent && parentKey && isEpicParent(parent) ? parentKey : projectKey;
  if (!epic) return null;
  const a = obj(f.assignee);
  const pid = str(a?.accountId);
  if (!a || !pid) return null;
  const status = statusOf(obj(obj(f.status)?.statusCategory)?.key);
  const now = isDate(today) ? today : new Date().toISOString().slice(0, 10);
  let en = day(f[rule.end]);
  const st = rule.start ? day(f[rule.start]) : null;
  let openEnd = false;
  if (!en && st && rule.end === 'resolutiondate' && status !== 'done') {
    en = st > now ? st : now;
    openEnd = true;
  }
  let start = st ?? en;
  let end = en ?? st;
  let filled = false;
  if (!start && !end && rule.fill) {
    const c = day(f.created);
    if (c) {
      start = c;
      const r = day(f.resolutiondate);
      end = r ?? (c > now ? c : now);
      filled = true;
    }
  }
  if (!start || !end) return null;
  // 시작이 끝보다 늦게 적힌 티켓(흔한 입력 실수) — 순서를 바로잡아 하루 이상은 그린다.
  const [s, e] = start <= end ? [start, end] : [end, start];
  return {
    key,
    summary: str(f.summary) ?? key,
    epic,
    person: { id: pid, name: str(a.displayName) ?? '이름 없음' },
    start: s,
    end: e,
    status,
    startMissing: !filled && !st,
    endMissing: !filled && !en && !openEnd,
    ...(filled ? { filled: true } : {}),
  };
}

export function normalizeEpic(issue: unknown, rule: DateRule = DEFAULT_RULE): JiraEpic | null {
  const it = obj(issue);
  const key = str(it?.key);
  const f = obj(it?.fields);
  if (!it || !key || !f) return null;
  return {
    key,
    name: str(f.summary) ?? key,
    start: rule.start ? day(f[rule.start]) : null,
    end: day(f[rule.end]),
    status: statusOf(obj(obj(f.status)?.statusCategory)?.key),
  };
}

/**
 * 티켓이 든 묶음의 이름 — 부모가 에픽이면 부모 필드에서(에픽 조회가 실패해도 칩에 이름은 붙는다),
 * 아니면 프로젝트(`normalizeTicket`과 같은 판정).
 */
export function epicFromParent(issue: unknown): JiraEpic | null {
  const f = obj(obj(issue)?.fields);
  const parent = obj(f?.parent);
  const key = str(parent?.key);
  if (parent && key && isEpicParent(parent)) {
    const pf = obj(parent.fields);
    return { key, name: str(pf?.summary) ?? key, start: null, end: null, status: statusOf(obj(obj(pf?.status)?.statusCategory)?.key) };
  }
  const p = obj(f?.project);
  const pk = str(p?.key);
  return pk ? { key: pk, name: str(p?.name) ?? pk, start: null, end: null, status: 'doing' } : null;
}

export interface FieldMeta {
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

/** 고를 수 있는 커스텀 날짜 필드(`GET /rest/api/3/field`) — 프로젝트 고르기의 날짜 칸이 쓴다. 이름순, 60개까지. */
export function dateFields(fields: unknown): FieldMeta[] {
  if (!Array.isArray(fields)) return [];
  const out: FieldMeta[] = [];
  const seen = new Set<string>();
  for (const raw of fields) {
    const f = obj(raw);
    const id = str(f?.id);
    const name = str(f?.name);
    const schema = obj(f?.schema);
    if (!f || !id || !name || !isCustomField(id) || !schema || seen.has(id)) continue;
    if (schema.type !== 'date' && schema.type !== 'datetime') continue;
    seen.add(id);
    out.push({ id, name: name.slice(0, 120) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
}

/** 저장해 둘 이슈 유형 — 모양을 확인하고 중복을 빼고 100개로 자른다. 비어 있으면 "전부". */
export function coerceIssueTypes(v: unknown): JiraIssueTypeRef[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: JiraIssueTypeRef[] = [];
  for (const raw of v) {
    const t = obj(raw);
    const id = str(t?.id);
    if (!t || !isTypeId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: (str(t.name) ?? id).slice(0, 80) });
    if (out.length >= 100) break;
  }
  return out;
}

/** 프로젝트 응답(`GET /rest/api/3/project/{key}`)의 이슈 유형 → 고를 수 있는 것(하위 작업·에픽 이상은 뺀다). */
export function issueTypesOf(project: unknown): JiraIssueTypeRef[] {
  const list = obj(project)?.issueTypes;
  if (!Array.isArray(list)) return [];
  const out: JiraIssueTypeRef[] = [];
  for (const raw of list) {
    const t = obj(raw);
    const id = str(t?.id);
    const name = str(t?.name);
    if (!t || !isTypeId(id) || !name || t.subtask === true) continue;
    if (typeof t.hierarchyLevel === 'number' && t.hierarchyLevel !== 0) continue;
    out.push({ id, name: name.slice(0, 80) });
  }
  return out;
}

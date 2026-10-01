import type { JiraIssues, JiraResult, JiraSite, JiraSource, JiraStatus } from './jiraApi';
import type { JiraEpic, JiraPerson, JiraProjectRef, JiraTicket, TicketStatus } from '../../../../../../supabase/functions/_shared/jira';

/**
 * 로컬·데모 모드의 Jira — 프로토타입(`Geurio 작업 현황.dc.html`)의 샘플 데이터를 그대로
 * 돌려준다. 샘플은 2026년 9월 기준이라 **오늘이 든 달로 옮겨서** 준다(언제 열어도 이번 달
 * 화면이 채워진다). 연결 상태는 이 기기의 localStorage에만 산다.
 */

const KEY = 'mf_jira_demo';
const SITE: JiraSite = { id: 'demo', url: 'https://demo.atlassian.net', name: '데모 사이트' };
const PROJECTS: JiraProjectRef[] = [
  { key: 'PAY', name: '결제' },
  { key: 'ONB', name: '온보딩' },
  { key: 'SRCH', name: '검색' },
  { key: 'DATA', name: '데이터' },
];

const P = (id: string, name: string): JiraPerson => ({ id, name });
const PEOPLE = {
  p1: P('demo-p1', '이호율'),
  p2: P('demo-p2', '김서연'),
  p3: P('demo-p3', '박지훈'),
  p4: P('demo-p4', '황리건'),
  p5: P('demo-p5', '정다은'),
  p6: P('demo-p6', '최민준'),
};
const USERS: JiraPerson[] = [...Object.values(PEOPLE), P('demo-p7', '오세훈'), P('demo-p8', '한지민'), P('demo-p9', '류승완'), P('demo-p10', '문가영')];

const EPICS: JiraEpic[] = [
  { key: 'PAY-100', name: '결제 개편', start: '2026-09-01', end: '2026-10-16', status: 'doing' },
  { key: 'ONB-30', name: '온보딩 v2', start: '2026-08-24', end: '2026-09-30', status: 'doing' },
  { key: 'SRCH-1', name: '검색 품질', start: '2026-08-17', end: '2026-10-09', status: 'doing' },
  { key: 'DATA-50', name: '데이터 파이프라인', start: '2026-09-01', end: '2026-10-30', status: 'doing' },
];

const T = (key: string, epic: string, person: JiraPerson, start: string, end: string, status: TicketStatus, summary: string): JiraTicket => ({ key, epic, person, start, end, status, summary, startMissing: false, endMissing: false });
const TICKETS: JiraTicket[] = [
  T('PAY-101', 'PAY-100', PEOPLE.p1, '2026-09-01', '2026-09-05', 'done', '결제 수단 선택 화면'),
  T('PAY-102', 'PAY-100', PEOPLE.p1, '2026-09-07', '2026-09-16', 'done', 'PG 연동 어댑터'),
  T('PAY-103', 'PAY-100', PEOPLE.p2, '2026-09-03', '2026-09-11', 'done', '결제 실패 재시도 UX'),
  T('PAY-104', 'PAY-100', PEOPLE.p2, '2026-09-14', '2026-09-23', 'doing', '영수증 이메일 템플릿'),
  T('PAY-105', 'PAY-100', PEOPLE.p1, '2026-09-21', '2026-10-02', 'doing', '정산 리포트 API'),
  T('PAY-106', 'PAY-100', PEOPLE.p6, '2026-09-28', '2026-10-08', 'todo', '부분 취소 처리'),
  T('ONB-31', 'ONB-30', PEOPLE.p3, '2026-09-01', '2026-09-09', 'done', '가입 퍼널 A/B'),
  T('ONB-32', 'ONB-30', PEOPLE.p3, '2026-09-10', '2026-09-18', 'done', '첫 화면 튜토리얼'),
  T('ONB-33', 'ONB-30', PEOPLE.p4, '2026-09-02', '2026-09-18', 'doing', '초대 링크 흐름'),
  T('ONB-34', 'ONB-30', PEOPLE.p3, '2026-09-22', '2026-09-30', 'doing', '이메일 인증 개선'),
  T('SRCH-7', 'SRCH-1', PEOPLE.p5, '2026-08-26', '2026-09-04', 'done', '동의어 사전 v3'),
  T('SRCH-8', 'SRCH-1', PEOPLE.p5, '2026-09-07', '2026-09-23', 'doing', '랭킹 재정렬 실험'),
  T('SRCH-9', 'SRCH-1', PEOPLE.p4, '2026-09-21', '2026-10-06', 'doing', '검색 로그 대시보드'),
  T('SRCH-10', 'SRCH-1', PEOPLE.p6, '2026-09-14', '2026-09-18', 'done', '오타 교정'),
  T('DATA-52', 'DATA-50', PEOPLE.p6, '2026-09-01', '2026-09-11', 'done', '이벤트 스키마 정리'),
  T('DATA-53', 'DATA-50', PEOPLE.p6, '2026-09-21', '2026-09-25', 'doing', '배치 재처리'),
  T('DATA-54', 'DATA-50', PEOPLE.p2, '2026-09-24', '2026-10-09', 'todo', '웨어하우스 마이그레이션'),
  T('DATA-55', 'DATA-50', PEOPLE.p5, '2026-09-28', '2026-09-30', 'todo', '품질 알림'),
];

/** 샘플의 기준 달(2026-09)에서 오늘이 든 달까지 몇 달인가. */
function monthOffset(now = new Date()): number {
  return now.getFullYear() * 12 + now.getMonth() - (2026 * 12 + 8);
}

/** `YYYY-MM-DD`를 n달 옮긴다 — 날은 그 달의 끝을 넘지 않게 자른다. */
export function shiftMonths(s: string, n: number): string {
  if (!n) return s;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

interface DemoState {
  connected: boolean;
  projects: JiraProjectRef[];
}

function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<DemoState>) : null;
    return { connected: v?.connected === true, projects: Array.isArray(v?.projects) ? v.projects : [] };
  } catch {
    return { connected: false, projects: [] };
  }
}

function write(s: DemoState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 데모 — 저장이 안 되면 새로고침에 잊을 뿐이다 */
  }
}

function status(s: DemoState): JiraStatus {
  return { connected: s.connected, site: s.connected ? SITE : null, projects: s.connected ? s.projects : [], startField: s.connected ? { id: 'customfield_10015', name: 'Start date' } : null };
}

const ok = <T extends object>(v: T): JiraResult<T> => ({ ok: true, ...v });
const need = <T extends object>(fn: (s: DemoState) => JiraResult<T>): Promise<JiraResult<T>> => {
  const s = read();
  return Promise.resolve(s.connected ? fn(s) : { ok: false, reason: 'no-credentials' });
};

export const demoJira: JiraSource = {
  demo: true,
  status: () => Promise.resolve(ok(status(read()))),
  authorize: (redirectUri) => Promise.resolve(ok({ url: `${redirectUri}?code=demo&state=demo` })),
  exchange: () => {
    const next = { connected: true, projects: read().projects };
    write(next);
    return Promise.resolve(ok({ ...status(next), sites: [SITE] }));
  },
  sites: () => need(() => ok({ sites: [SITE] })),
  selectSite: () => need((s) => ok(status(s))),
  projects: (query) => need(() => ok({ projects: PROJECTS.filter((p) => !query || `${p.key} ${p.name}`.toLowerCase().includes(query.toLowerCase())) })),
  issueTypes: (projects) => need(() => ok({ types: projects.length ? [{ id: '10001', name: '작업' }, { id: '10002', name: '버그' }, { id: '10101', name: '작업' }] : [] })),
  fields: () => need(() => ok({ fields: [{ id: 'customfield_10015', name: 'Start date' }, { id: 'customfield_10020', name: 'Target end' }], suggested: { id: 'customfield_10015', name: 'Start date' } })),
  saveProjects: (projects) =>
    need(() => {
      const next = { connected: true, projects };
      write(next);
      return ok(status(next));
    }),
  issues: (from, to) =>
    need((s) => {
      const n = monthOffset();
      const keys = new Set(s.projects.map((p) => p.key));
      const inProject = (key: string) => keys.has(key.split('-')[0] ?? '');
      const tickets = TICKETS.filter((t) => inProject(t.key))
        .map((t) => ({ ...t, start: shiftMonths(t.start, n), end: shiftMonths(t.end, n) }))
        .filter((t) => t.start <= to && t.end >= from);
      const used = new Set(tickets.map((t) => t.epic));
      const epics = EPICS.filter((e) => used.has(e.key)).map((e) => ({ ...e, start: e.start && shiftMonths(e.start, n), end: e.end && shiftMonths(e.end, n) }));
      const res: JiraIssues = { epics, tickets, truncated: false };
      return ok(res);
    }),
  users: (query) => need(() => ok({ users: USERS.filter((u) => u.name.includes(query.trim())) })),
  disconnect: () => {
    write({ connected: false, projects: read().projects });
    return Promise.resolve(ok({}));
  },
};

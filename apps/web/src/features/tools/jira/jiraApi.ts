import { getSupabaseClient } from '../../../adapters/supabase/supabaseClient';
import { isSupabaseConfigured, readViteEnv } from '../../../adapters/env';
import type { JiraEpic, JiraPerson, JiraProjectRef, JiraTicket } from '../../../../../../supabase/functions/_shared/jira';
import { demoJira } from './jiraDemo';

export type { JiraEpic, JiraPerson, JiraProjectRef, JiraTicket, TicketStatus } from '../../../../../../supabase/functions/_shared/jira';

/**
 * Jira에 묻는 창구 — Edge Function `jira`를 부른다(토큰은 서버에만 있다, 0044).
 *
 * 로컬·데모 모드(Supabase가 없다)에서는 **데모 소스**가 같은 모양으로 답한다(프로토타입의
 * 샘플 데이터 — `jiraDemo.ts`). 화면이 어느 쪽인지 알 필요가 없게, 둘 다 `JiraSource`다.
 */

export interface JiraSite {
  id: string;
  url: string;
  name: string;
}

export interface JiraStatus {
  connected: boolean;
  site: JiraSite | null;
  projects: JiraProjectRef[];
  startField: { id: string; name: string } | null;
}

export interface JiraIssues {
  epics: JiraEpic[];
  tickets: JiraTicket[];
  /** 상한(1,000건)에서 잘렸다 — 화면이 그 사실을 말한다. */
  truncated: boolean;
}

export type JiraResult<T> = ({ ok: true } & T) | { ok: false; reason: string; detail?: string };

export interface JiraSource {
  /** 샘플 데이터로 도는가(로컬·데모). */
  demo: boolean;
  status(): Promise<JiraResult<JiraStatus>>;
  authorize(redirectUri: string): Promise<JiraResult<{ url: string }>>;
  exchange(code: string, state: string, redirectUri: string): Promise<JiraResult<JiraStatus & { sites: JiraSite[] }>>;
  sites(): Promise<JiraResult<{ sites: JiraSite[] }>>;
  selectSite(cloudId: string): Promise<JiraResult<JiraStatus>>;
  projects(query: string): Promise<JiraResult<{ projects: JiraProjectRef[] }>>;
  saveProjects(projects: JiraProjectRef[]): Promise<JiraResult<JiraStatus>>;
  issues(from: string, to: string): Promise<JiraResult<JiraIssues>>;
  users(query: string): Promise<JiraResult<{ users: JiraPerson[] }>>;
  disconnect(): Promise<JiraResult<object>>;
}

async function invoke<T>(body: Record<string, unknown>): Promise<JiraResult<T>> {
  const env = readViteEnv();
  const client = getSupabaseClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
  try {
    const res = await client.functions.invoke<JiraResult<T>>('jira', { body });
    // 함수가 배포되지 않았거나(404) 네트워크가 끊겼다 — 화면에는 "연결할 수 없다"로.
    if (res.error || !res.data) return { ok: false, reason: 'unavailable' };
    return res.data;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

const serverJira: JiraSource = {
  demo: false,
  status: () => invoke({ action: 'status' }),
  authorize: (redirectUri) => invoke({ action: 'authorize', redirectUri }),
  exchange: (code, state, redirectUri) => invoke({ action: 'exchange', code, state, redirectUri }),
  sites: () => invoke({ action: 'sites' }),
  selectSite: (cloudId) => invoke({ action: 'select-site', cloudId }),
  projects: (query) => invoke({ action: 'projects', query }),
  saveProjects: (projects) => invoke({ action: 'save-projects', projects }),
  issues: (from, to) => invoke({ action: 'issues', from, to }),
  users: (query) => invoke({ action: 'users', query }),
  disconnect: () => invoke({ action: 'disconnect' }),
};

let override: JiraSource | null = null;

/** 지금 쓸 소스 — 테스트는 `setJiraSourceForTest`로 갈아 끼운다. */
export function jiraSource(): JiraSource {
  if (override) return override;
  return isSupabaseConfigured(readViteEnv()) ? serverJira : demoJira;
}

export function setJiraSourceForTest(s: JiraSource | null): void {
  override = s;
}

/** 서버가 준 사유 → 사람이 읽고 무엇을 할지 아는 문장. */
export function jiraReasonText(reason: string): string {
  switch (reason) {
    case 'not-configured':
      return 'Jira 연결이 아직 준비 중이에요';
    case 'unavailable':
      return 'Jira 연결 서버에 닿지 못했어요';
    case 'revoked':
    case 'no-credentials':
      return 'Jira 연결이 끊겼어요 · 다시 연결해 주세요';
    case 'no-offline':
      return '연결 유지 권한을 받지 못했어요 · 다시 시도해 주세요';
    case 'bad-state':
      return '연결 요청이 만료됐어요 · 다시 시도해 주세요';
    case 'forbidden':
      return '이 Jira 사이트에서 읽을 권한이 없어요';
    case 'rate-limited':
      return 'Jira 요청이 많아요 · 잠시 뒤 다시 시도해 주세요';
    case 'no-site':
      return 'Jira 사이트를 먼저 골라 주세요';
    default:
      return 'Jira에서 불러오지 못했어요';
  }
}

/** 연결이 **끊겼다**고 볼 사유 — 이 둘은 다시 연결해야 풀린다. */
export const isDisconnectReason = (reason: string) => reason === 'revoked' || reason === 'no-credentials';

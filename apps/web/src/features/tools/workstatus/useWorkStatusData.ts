import { useCallback, useEffect, useState } from 'react';
import { jiraReasonText, jiraSource, type JiraIssues } from '../jira/jiraApi';
import { reportJiraSync, type JiraConn } from '../jira/jiraStore';

/**
 * 한 기간의 에픽·티켓 — **기간 단위로 5분 캐시**(작업 현황 스펙 §12). 달을 넘겨 보고 돌아와도
 * 다시 묻지 않고, 5분이 지나면 조용히 새로 받는다(그동안 옛 값을 그대로 보여 준다).
 *
 * 성공·실패는 LNB 도구 행의 상태 점으로도 알린다(`reportJiraSync` — 도구 스펙 §3.3).
 */

const TTL_MS = 5 * 60 * 1000;

/**
 * 캐시 키의 **질문 부분** — 프로젝트와 날짜 규칙(유형·상태·배포 필드 포함). 어느 쪽이 바뀌어도 새로 묻는다.
 * 작업 현황과 폰의 도구 시트(「오늘 N」)가 같은 키를 써야 한쪽이 받은 달을 다른 쪽이 다시 묻지 않는다.
 */
export function workStatusKey(conn: Pick<JiraConn, 'projects' | 'startField' | 'endField' | 'fillDates' | 'issueTypes' | 'releaseField' | 'issueStatuses'>): string {
  return `${conn.projects.map((p) => p.key).join(',')}|${conn.startField?.id ?? ''}|${conn.endField?.id ?? ''}|${conn.fillDates === false ? 0 : 1}|${(conn.issueTypes ?? []).map((t) => t.id).join(',')}|${conn.releaseField?.id ?? ''}|${(conn.issueStatuses ?? []).map((t) => t.id).join(',')}`;
}

/** 이 기기의 오늘 — 아직 안 끝난 티켓(해결된 날을 끝으로 고른 경우·날짜 채우기)을 여기까지 그린다. */
export const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
const cache = new Map<string, { at: number; data: JiraIssues }>();

/** 프로젝트를 다시 고르면 옛 캐시는 다른 질문의 답이다 — 비운다. */
export function clearWorkStatusCache(): void {
  cache.clear();
}

export interface WorkStatusData {
  data: JiraIssues | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * @param key 캐시 키에 섞을 값(고른 프로젝트 목록 등) — 바뀌면 새 질문이다.
 * @param enabled 연결·프로젝트가 준비됐을 때만 묻는다.
 */
export function useWorkStatusData(from: string, to: string, key: string, enabled: boolean): WorkStatusData {
  const ck = `${key}|${from}|${to}`;
  const hit = cache.get(ck);
  const [state, setState] = useState<{ ck: string; data: JiraIssues | null; error: string | null; loading: boolean }>({ ck, data: hit?.data ?? null, error: null, loading: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const cached = cache.get(ck);
    if (cached && Date.now() - cached.at < TTL_MS) {
      setState({ ck, data: cached.data, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ck, data: s.ck === ck ? s.data : (cached?.data ?? null), error: null, loading: true }));
    void jiraSource()
      .issues(from, to, localToday())
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          const data: JiraIssues = { epics: r.epics, tickets: r.tickets, truncated: r.truncated };
          cache.set(ck, { at: Date.now(), data });
          setState({ ck, data, error: null, loading: false });
          reportJiraSync(true);
        } else {
          setState((s) => ({ ...s, error: jiraReasonText(r.reason), loading: false }));
          reportJiraSync(r.reason);
        }
      });
    return () => {
      alive = false;
    };
  }, [ck, from, to, enabled, nonce]);

  const reload = useCallback(() => {
    cache.delete(ck);
    setNonce((n) => n + 1);
  }, [ck]);

  const cur = state.ck === ck ? state : { data: hit?.data ?? null, error: null, loading: enabled };
  return { data: cur.data, loading: cur.loading, error: cur.error, reload };
}

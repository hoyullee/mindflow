import { useMemo } from 'react';
import { useJiraConn } from '../jira/jiraStore';
import { useToolPrefs } from '../toolPrefsStore';
import { buildDataset, monthDays, overlaps } from './model';
import { localToday, useWorkStatusData, workStatusKey } from './useWorkStatusData';

/**
 * **오늘 걸린 티켓 수** — 폰 도구 시트(모바일 홈 디자인 M4b)의 「작업 현황 · 오늘 N」.
 *
 * 작업 현황의 「고른 날」 목록이 오늘을 골랐을 때 세는 것과 같은 셈이다: 이번 달을 받아(작업 현황과 **같은
 * 캐시 키** — 시트가 받은 달을 화면이 다시 묻지 않는다) 끈 담당자를 빼고, 기간이 오늘에 걸친 티켓을 센다.
 * 검색 칩(담당자·에픽 필터)은 화면의 일시적인 보기라 여기 섞지 않는다.
 *
 * `enabled`가 거짓이거나 아직 받는 중이면 `null` — 배지를 그리지 않는다(0과 "모른다"는 다르다).
 */
export function useJiraTodayCount(enabled: boolean): number | null {
  const conn = useJiraConn();
  const { prefs } = useToolPrefs();
  const today = localToday();
  const days = monthDays(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const ready = conn.connected && !!conn.site && conn.projects.length > 0;
  const month = useWorkStatusData(days[0] as string, days[days.length - 1] as string, workStatusKey(conn), enabled && ready);
  const work = prefs.work;
  return useMemo(() => {
    if (!enabled || !ready || !month.data) return null;
    const ds = buildDataset(month.data.epics, month.data.tickets, work.extra);
    return ds.tickets.filter((t) => !work.hidden.includes(t.person.id) && overlaps(t, today, today)).length;
  }, [enabled, ready, month.data, work, today]);
}

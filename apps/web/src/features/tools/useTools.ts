import { useEffect } from 'react';
import type { HomeController } from '../home/useHomeController';
import type { HomeState } from '../home/types';
import { googlePrefsOf, useGoogleCalendar } from '../home/calendar/useGoogleCalendar';
import { TOOL_DEFS, TOOL_ORDER, type ToolKey } from './toolDefs';
import { normalizeLabel } from './toolPrefs';
import { ensureToolPrefs, updateToolPrefs, useToolPrefs } from './toolPrefsStore';
import { beginJiraConnect, disconnectJira, ensureJiraStatus, useJiraConn, type JiraConn } from './jira/jiraStore';
import { toolToast } from './ui';

/**
 * 도구 목록의 **한 벌뿐인 계산** — LNB 구획·도구 관리 팝오버·설정 카드가 모두 이것을 쓴다
 * (도구 스펙 §9 "어디서 해도 즉시 서로 반영").
 *
 * 연결 상태의 출처는 도구마다 다르다: Jira는 `jiraStore`(서버), 구글 캘린더는 기존
 * `useGoogleCalendar`(워크스페이스 블롭의 `enabled`). 구글 훅은 `off`로 불러 조회는 하지 않는다.
 */

export interface ToolRow {
  key: ToolKey;
  name: string;
  connected: boolean;
  /** 화면이 있는 도구(Jira)인가 — 표시 토글·이름 편집이 이것에 달린다. */
  hasScreen: boolean;
  /** 왼쪽 목록 이름(사용자 지정 또는 기본). */
  label: string;
  labelCustom: boolean;
  show: boolean;
  /** `wantedlab.atlassian.net` · `hoyul.lee@…`. */
  account: string;
  /** 연결 전 설명 또는 연결 뒤 계정 줄(§2). */
  sub: string;
  busy: boolean;
  /** 동기화 실패 사유 — 있으면 상태 점이 주황이다(§8). */
  syncError: string | null;
  syncTitle: string;
}

export interface Tools {
  rows: ToolRow[];
  connected: ToolRow[];
  available: ToolRow[];
  /** LNB에 화면으로 나올 행(연결됨 + 표시 + 화면 있음). */
  screens: ToolRow[];
  jira: JiraConn;
  connect: (key: ToolKey) => void;
  disconnect: (key: ToolKey) => void;
  setShow: (key: ToolKey, show: boolean) => void;
  setLabel: (key: ToolKey, v: string | null) => void;
}

const siteHost = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function syncTitleOf(j: JiraConn): string {
  if (j.sync.state === 'error') return `동기화 실패 · ${j.sync.reason ?? ''}`;
  if (j.sync.state === 'ok' && j.sync.at) {
    const min = Math.floor((Date.now() - j.sync.at) / 60_000);
    return `연결됨 · ${min < 1 ? '방금' : `${min}분 전`} 동기화`;
  }
  return '연결됨';
}

export function useTools(state: HomeState, controller: HomeController): Tools {
  const who = state.userEmail || 'local';
  useEffect(() => {
    ensureToolPrefs(who);
    ensureJiraStatus(who);
  }, [who]);
  const { prefs } = useToolPrefs();
  const jira = useJiraConn();
  const google = useGoogleCalendar(1970, 1, googlePrefsOf(state.google), controller.setGoogleCalendars, 'off');

  const jiraLabel = prefs.jira.label ?? (TOOL_DEFS.jira.screen as string);
  const jiraRow: ToolRow = {
    key: 'jira',
    name: TOOL_DEFS.jira.name,
    connected: jira.connected,
    hasScreen: true,
    label: jiraLabel,
    labelCustom: prefs.jira.label !== null,
    show: prefs.jira.show,
    account: jira.site ? siteHost(jira.site.url) || jira.site.name : jira.demo ? '데모' : '',
    sub: jira.connected ? (jira.site ? siteHost(jira.site.url) || jira.site.name : '사이트를 골라 주세요') : TOOL_DEFS.jira.desc,
    busy: jira.busy,
    syncError: jira.sync.state === 'error' ? jira.sync.reason : null,
    syncTitle: syncTitleOf(jira),
  };
  const gcalOn = google.available && google.enabled;
  const gmail = google.selfEmail || state.userEmail;
  const gcalRow: ToolRow = {
    key: 'gcal',
    name: TOOL_DEFS.gcal.name,
    connected: gcalOn,
    hasScreen: false,
    label: TOOL_DEFS.gcal.name,
    labelCustom: false,
    show: false,
    account: gmail,
    sub: gcalOn ? `${gmail ? `${gmail} · ` : ''}일정 안에서 보여요` : TOOL_DEFS.gcal.desc,
    busy: google.connecting,
    syncError: google.enabled && google.needsReauth ? '권한을 다시 받아야 해요' : null,
    syncTitle: '연결됨',
  };
  // 배포에 구글 클라이언트 ID가 없으면 구글 행은 아예 없다(설정의 예전 규칙과 같다 —
  // 할 수 없는 것은 보이지 않는다).
  const rows = TOOL_ORDER.map((k) => (k === 'jira' ? jiraRow : gcalRow)).filter((r) => r.key !== 'gcal' || google.available);

  const connect = (key: ToolKey) => {
    if (key === 'gcal') {
      void google.connect().then(() => toolToast(`${TOOL_DEFS.gcal.name}을 연결했어요`));
      return;
    }
    if (jira.unavailable && !jira.demo) {
      toolToast(jira.unavailable);
      return;
    }
    // 연결하면 목록에 곧바로 서야 한다(§4.3 "성공 시 show:true") — 돌아왔을 때 다시 켜 두지
    // 않도록 떠나기 전에 적는다(이름은 그대로 — 재연결 때 되살아난다).
    updateToolPrefs((p) => (p.jira.show ? p : { ...p, jira: { ...p.jira, show: true } }));
    void beginJiraConnect().then((err) => {
      if (err) toolToast(`연결하지 못했어요 · ${err}`);
    });
  };

  const disconnect = (key: ToolKey) => {
    if (key === 'gcal') {
      void google.disconnect().then(() => toolToast(`${TOOL_DEFS.gcal.name} 연결을 해제했어요`));
      return;
    }
    void disconnectJira().then((err) => {
      if (err) {
        toolToast(err);
        return;
      }
      if (state.activeTool === 'jira') controller.closeTool();
      toolToast(`${TOOL_DEFS.jira.name} 연결을 해제했어요`);
    });
  };

  const setShow = (key: ToolKey, show: boolean) => {
    if (key !== 'jira') return;
    updateToolPrefs((p) => ({ ...p, jira: { ...p.jira, show } }));
    if (!show && state.activeTool === 'jira') controller.closeTool();
  };

  const setLabel = (key: ToolKey, v: string | null) => {
    if (key !== 'jira') return;
    const label = normalizeLabel(v);
    updateToolPrefs((p) => ({ ...p, jira: { ...p.jira, label } }));
    toolToast(`왼쪽 목록 이름을 '${label ?? (TOOL_DEFS.jira.screen as string)}'로 바꿨어요`);
  };

  const connected = rows.filter((r) => r.connected);
  return {
    rows,
    connected,
    available: rows.filter((r) => !r.connected),
    screens: connected.filter((r) => r.hasScreen && r.show),
    jira,
    connect,
    disconnect,
    setShow,
    setLabel,
  };
}

/**
 * 도구의 **정적 정의**(도구 스펙 §2). 연결 상태는 여기 없다 — Jira는 `jiraStore`, 구글
 * 캘린더는 기존 `useGoogleCalendar`가 안다. 이 표는 이름·아이콘·화면만 정한다.
 */

export type ToolKey = 'jira' | 'gcal';

export interface ToolDef {
  key: ToolKey;
  name: string;
  icon: { bg: string; fg: string; border: string | null; text: string };
  /** 화면의 기본 이름 — `null`이면 화면이 없다(구글 캘린더는 일정 화면 안에서 동작). */
  screen: string | null;
  /** 연결 전 부제. */
  desc: string;
}

export const TOOL_DEFS: Record<ToolKey, ToolDef> = {
  jira: {
    key: 'jira',
    name: 'Jira',
    icon: { bg: '#2684FF', fg: '#FFFFFF', border: null, text: 'J' },
    screen: '작업 현황',
    desc: '에픽·티켓 일정을 팀 달력으로 보기',
  },
  gcal: {
    key: 'gcal',
    name: 'Google 캘린더',
    icon: { bg: '#FFFDFB', fg: '#4285F4', border: '#EADFD3', text: 'G' },
    screen: null,
    desc: '일정 페이지에 내 구글 일정 함께 보기',
  },
};

/** 목록 순서 — 연결됨/미연결 그룹 안에서도 이 순서를 지킨다. */
export const TOOL_ORDER: ToolKey[] = ['jira', 'gcal'];

/** 설정의 실제 경로(도구 스펙 §4.1 바닥 문구 — "실제 경로 이름으로" 요청 2026-09-30). */
export const TOOLS_SETTINGS_PATH = ['설정', '계정 설정', '도구'] as const;

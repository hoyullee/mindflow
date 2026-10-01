import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from '../home/Home';
import { mockMatchMedia } from '../../test/matchMedia';
import { resetToolPrefs } from './toolPrefsStore';
import { resetJiraStore } from './jira/jiraStore';
import { monthBiz } from './workstatus/model';
import { demoJira } from './jira/jiraDemo';

// 도구(LNB 구획 · 도구 관리 · 작업 현황) — 로컬 모드라 Jira는 **데모 소스**가 답한다(`jiraDemo.ts`).

const ALL = [
  { key: 'PAY', name: '결제' },
  { key: 'ONB', name: '온보딩' },
  { key: 'SRCH', name: '검색' },
  { key: 'DATA', name: '데이터' },
];

function connectDemo(projects = ALL): void {
  localStorage.setItem('mf_jira_demo', JSON.stringify({ connected: true, projects }));
}

function renderHome(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/home" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qi = (sel: string) => document.querySelector<HTMLInputElement>(sel);
const wait = <T,>(fn: () => T | null | undefined) =>
  waitFor(() => {
    const v = fn();
    expect(v).toBeTruthy();
    return v as T;
  });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetToolPrefs();
  resetJiraStore();
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('LNB 도구 구획', () => {
  it('연결한 도구가 없으면 `도구 연결` 한 줄 — 누르면 도구 관리가 뜨고 바닥이 설정의 실제 경로를 가리킨다', async () => {
    const user = userEvent.setup();
    renderHome();
    const row = await wait(() => q('[data-tools-connect-row]'));
    expect(row.textContent).toContain('도구 연결');
    expect(q('[data-tools-manage]')).toBeNull();
    await user.click(row);
    const pop = await wait(() => q('[data-tools-popover]'));
    expect(pop.textContent).toContain('연결할 수 있는 도구');
    expect(within(pop).getByText('Jira')).toBeTruthy();
    expect(q('[data-tools-settings-link]')?.textContent).toBe('설정 → 계정 설정 → 도구');
  });

  it('바닥 링크는 설정 › 계정 설정을 곧바로 열고, 거기에 같은 도구 카드가 있다', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await wait(() => q('[data-tools-connect-row]')));
    await user.click(await wait(() => q('[data-tools-settings-link]')));
    await wait(() => q('[data-tools-settings]'));
    expect(q('[data-settings-title]')?.textContent).toBe('계정 설정');
    expect(q('[data-settings-tool="jira"]')?.textContent).toContain('에픽·티켓 일정을 팀 달력으로 보기');
  });

  it('연결돼 있으면 머리줄 `도구` + `작업 현황` 행 — 누르면 본문이 작업 현황이 되고 LNB는 남는다', async () => {
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    const nav = await wait(() => q('[data-tool-nav="jira"]'));
    expect(nav.textContent).toContain('작업 현황');
    expect(nav.textContent).toContain('Jira · demo.atlassian.net');
    expect(q('[data-tools-manage]')).toBeTruthy();
    await user.click(nav);
    await wait(() => q('[data-work-status]'));
    expect(q('[data-tool-nav="jira"]')?.getAttribute('aria-current')).toBe('page');
    expect(q('aside')).toBeTruthy();
    // 스페이스를 누르면 도구 화면이 닫힌다(화면은 하나만).
    await user.click(screen.getAllByText(/일반 스페이스|업무/)[0]!);
    await waitFor(() => expect(q('[data-work-status]')).toBeNull());
  });

  it('이름을 바꾸면 LNB 행이 곧바로 바뀌고, 표시를 끄면 `도구 연결` 줄로 돌아간다', async () => {
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    await wait(() => q('[data-tool-nav="jira"]'));
    await user.click(q('[data-tools-manage]')!);
    await user.click(await wait(() => q('[data-tool-label]')));
    const input = await wait(() => qi('[data-tool-label-input]'));
    await user.clear(input);
    await user.type(input, '팀 현황{Enter}');
    await waitFor(() => expect(q('[data-tool-nav="jira"]')?.textContent).toContain('팀 현황'));
    expect(await screen.findByText("왼쪽 목록 이름을 '팀 현황'로 바꿨어요")).toBeTruthy();
    await user.click(within(q('[data-tools-popover]')!).getByRole('switch', { name: '왼쪽 목록에 표시' }));
    await wait(() => q('[data-tools-connect-row]'));
    expect(q('[data-tool-nav="jira"]')).toBeNull();
  });

  it('연결 해제는 두 번 눌러야 한다 — 첫 클릭은 `정말 해제`', async () => {
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    await wait(() => q('[data-tool-nav="jira"]'));
    await user.click(q('[data-tools-manage]')!);
    const btn = await wait(() => within(q('[data-tool-row="jira"]')!).queryByRole('button', { name: '연결 해제' }));
    await user.click(btn);
    expect(btn.textContent).toBe('정말 해제');
    await user.click(btn);
    await wait(() => q('[data-tools-connect-row]'));
    expect(JSON.parse(localStorage.getItem('mf_jira_demo')!).connected).toBe(false);
  });
});

describe('연결에서 돌아오기', () => {
  it('`?jira=setup`이면 작업 현황을 열고 프로젝트 고르기를 띄운다 — 고르면 티켓이 선다', async () => {
    connectDemo([]);
    window.history.replaceState(null, '', '/home?jira=setup');
    const user = userEvent.setup();
    renderHome('/home?jira=setup');
    const modal = await wait(() => q('[data-jira-setup]'));
    await wait(() => q('[data-work-status]'));
    expect(window.location.search).toBe('');
    await user.click(await wait(() => within(modal).queryByText('결제')));
    await user.click(within(modal).getByText('온보딩'));
    // 날짜 기준 — 사이트의 날짜 필드가 칸에 서고, 고른 것이 저장에 실린다(제보 2026-10-01).
    await wait(() => within(modal).queryAllByRole('option', { name: 'Target end' })[0]);
    expect((q('[data-jira-rule-start]') as HTMLSelectElement).value).toBe('customfield_10015');
    await user.selectOptions(q('[data-jira-rule-end]')!, 'resolutiondate');
    await user.selectOptions(q('[data-jira-rule-release]')!, 'customfield_10020');
    // 이슈 유형 — 같은 이름(프로젝트마다 다른 id)은 한 칩, 고르면 그 이름의 id가 다 실린다.
    await user.click(await wait(() => q('[data-jira-issue-type="작업"]')));
    expect(modal.querySelectorAll('[data-jira-issue-type]').length).toBe(2);
    await user.click(await wait(() => q('[data-jira-status="진행 중"]')));
    const save = vi.spyOn(demoJira, 'saveProjects');
    await user.click(q('[data-jira-setup-save]')!);
    expect(save.mock.calls[0]?.[1]).toMatchObject({ start: 'customfield_10015', end: 'resolutiondate', endName: '해결된 날짜 (아직이면 오늘)', fill: true, release: 'customfield_10020', releaseName: 'Target end' });
    expect(save.mock.calls[0]?.[2]).toEqual([{ id: '10001', name: '작업' }, { id: '10101', name: '작업' }]);
    expect(save.mock.calls[0]?.[3]).toEqual([{ id: '3', name: '진행 중' }, { id: '31', name: '진행 중' }]);
    save.mockRestore();
    await waitFor(() => expect(q('[data-jira-setup]')).toBeNull());
    await wait(() => q('[data-ws-chip]'));
    expect(q('[data-ws-chip="SRCH-1"]')).toBeNull();
    expect(q('[data-ws-chip="PAY-100"]')).toBeTruthy();
  });
});

describe('작업 현황', () => {
  async function open() {
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    await user.click(await wait(() => q('[data-tool-nav="jira"]')));
    await wait(() => q('[data-ws-chip]'));
    return user;
  }

  it('상단 `Jira 설정` 단추 — 지금 설정을 툴팁에 · 누르면 네 칸(프로젝트·유형·상태·날짜)이 번호와 함께', async () => {
    const user = await open();
    const btn = q('[data-ws-date-rule-btn]')!;
    expect(btn.textContent).toContain('Jira 설정');
    expect(btn.title).toContain('날짜 시작 Start date');
    expect(btn.title).toContain('상태 전부');
    await user.click(btn);
    const modal = await wait(() => q('[data-jira-setup]'));
    for (const t of ['프로젝트', '이슈 유형', '상태', '날짜 기준']) expect(modal.textContent).toContain(t);
    // 상태 — 같은 이름(프로젝트마다 다른 id)은 칩 하나
    await wait(() => q('[data-jira-status="진행 중"]'));
    expect(modal.querySelectorAll('[data-jira-status]').length).toBe(3);
    // 팝업의 열림은 모듈 상태다 — 닫고 끝내야 다음 테스트가 가려지지 않는다.
    await user.click(within(q('[data-jira-setup]')!).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(q('[data-jira-setup]')).toBeNull());
  });

  it('세 보기가 같은 데이터를 본다 — 달력 칩 · 타임라인 막대 · 집계 행', async () => {
    const user = await open();
    await user.click(screen.getByRole('radio', { name: '타임라인' }));
    await wait(() => q('[data-ws-bar="PAY-101"]'));
    await user.click(screen.getByRole('radio', { name: '프로젝트별' }));
    await wait(() => q('[data-ws-bar="PAY-100"]'));
    await user.click(screen.getByRole('radio', { name: '집계' }));
    await wait(() => q('[data-ws-stat-row]'));
    expect(document.querySelectorAll('[data-ws-stat-row]').length).toBe(6);
  });

  it('검색 → Enter로 첫 결과가 필터가 되고, 같은 종류는 OR로 더해진다', async () => {
    const user = await open();
    await user.type(qi('[data-ws-search]')!, '결제 개편{Enter}');
    await wait(() => q('[data-filter-chip="epic:PAY-100"]'));
    await waitFor(() => expect(q('[data-ws-chip="ONB-30"]')).toBeNull());
    expect(q('[data-ws-chip="PAY-100"]')).toBeTruthy();
    await user.click(q('[data-filter-clear]')!);
    await wait(() => q('[data-ws-chip="ONB-30"]'));
  });

  it('휴일 설정(주말도 영업일)을 바꾸면 요약 줄의 영업일이 곧바로 바뀐다(내 설정)', async () => {
    const user = await open();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const before = monthBiz(y, m, { country: 'KR', weekend: false, exceptions: [], company: [] }).biz.length;
    const summary = () => q('[data-ws-summary]')!.textContent ?? '';
    expect(summary()).toContain(`영업일${before}`);
    await user.click(q('[data-ws-holiday-btn]')!);
    const modal = await wait(() => q('[data-ws-holiday]'));
    // 주말도 영업일로 — 이달의 주말 수만큼 늘어난다
    await user.click(within(modal).getByRole('switch', { name: '주말도 영업일로 계산' }));
    const after = monthBiz(y, m, { country: 'KR', weekend: true, exceptions: [], company: [] }).biz.length;
    await waitFor(() => expect(summary()).toContain(`영업일${after}`));
    expect(after).toBeGreaterThan(before);
  });
});

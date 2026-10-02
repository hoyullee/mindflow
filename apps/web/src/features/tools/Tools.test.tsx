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

  it('티켓을 누르면 상세 팝업 — 에픽 칩으로 에픽(하위 티켓)으로 가고 ‹로 돌아온다', async () => {
    const user = await open();
    await user.click(screen.getByRole('radio', { name: '타임라인' }));
    await user.click(await wait(() => q('[data-ws-bar="PAY-101"]')));
    const modal = await wait(() => q('[data-ws-issue="PAY-101"]'));
    await wait(() => q('[data-ws-issue-title]'));
    expect(modal.textContent).toContain('결제 수단 선택 화면');
    expect(modal.textContent).toContain('보기 전용이에요');
    // 모든 필드는 펼친 채로 열린다(채워진 필드가 숨지 않게) — 누르면 접힌다
    expect(q('[data-ws-issue-field="QA 담당"]')).toBeTruthy();
    await user.click(q('[data-ws-issue-all]')!);
    expect(q('[data-ws-issue-fields]')).toBeNull();
    // 상위 에픽으로
    await user.click(q('[data-ws-issue-epic="PAY-100"]')!);
    await wait(() => q('[data-ws-issue="PAY-100"] [data-ws-issue-children]'));
    expect(document.querySelectorAll('[data-ws-issue-child]').length).toBe(6);
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    await wait(() => q('[data-ws-issue="PAY-101"]'));
    await user.click(within(q('[data-ws-issue]')!).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(q('[data-ws-issue]')).toBeNull());
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

describe('폰 — 하단 탭 「도구」는 고르기 시트(모바일 홈 디자인 M4b)', () => {
  it('작업 현황 줄(Jira · 사이트) · 오늘 N · 도구 연결·관리 — 줄을 누르면 시트가 닫히고 작업 현황이 열린다', async () => {
    mockMatchMedia(true);
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    await user.click(await wait(() => q('[data-m-tab="tools"]')));
    const sheet = await wait(() => q('[data-m-tools-sheet]'));
    expect(sheet.textContent).toContain('연결한 도구의 화면으로 바로 가요');
    const row = await wait(() => q('[data-m-tool="jira"]'));
    expect(row.textContent).toContain('작업 현황');
    expect(row.textContent).toContain('Jira');
    expect(q('[data-m-tools-manage]')!.textContent).toContain('도구 연결 · 관리');
    // 디자인의 「회의실 예약(예시 · 추후 추가)」은 갈 화면이 없어 그리지 않는다.
    expect(sheet.textContent).not.toContain('회의실 예약');
    // 오늘 N — 작업 현황이 오늘을 골랐을 때의 목록과 같은 셈이다.
    const badge = await wait(() => q('[data-m-tool-today]'));
    const n = Number(/오늘\s*(\d+)/.exec(badge.textContent ?? '')?.[1]);
    expect(n).toBeGreaterThan(0);

    await user.click(row);
    await wait(() => q('[data-ws-mobile]'));
    await waitFor(() => expect(q('[data-m-tools-sheet]')).toBeNull());
    expect(q('[data-m-tab="tools"]')!.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(document.querySelectorAll('[data-ws-mday-ticket]').length).toBe(n));

    // 작업 현황 위에서 다시 누르면 시트가 그 자리에서 올라온다(도구가 하나여도 늘 시트 — 사용자 결정).
    await user.click(q('[data-m-tab="tools"]')!);
    await wait(() => q('[data-m-tools-sheet]'));
    expect(q('[data-ws-mobile]')).toBeTruthy();
  });

  it('화면 있는 도구가 없으면 안내 한 줄 · 도구 연결·관리는 설정 › 계정 설정의 도구로 간다', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderHome();
    await user.click(await wait(() => q('[data-m-tab="tools"]')));
    await wait(() => q('[data-m-tools-sheet]'));
    expect(q('[data-m-tool="jira"]')).toBeNull();
    expect(q('[data-m-tools-empty]')!.textContent).toContain('Jira를 연결하면');
    expect(q('[data-m-tool-today]')).toBeNull();
    await user.click(q('[data-m-tools-manage]')!);
    await wait(() => q('[data-tools-settings]'));
    await waitFor(() => expect(q('[data-m-tools-sheet]')).toBeNull());
  });
});

describe('작업 현황 — 폰(모바일 디자인 W1~W5)', () => {
  async function openPhone() {
    mockMatchMedia(true);
    connectDemo();
    const user = userEvent.setup();
    renderHome();
    // 폰에는 LNB가 없다 — 작업 현황은 전체 탭의 `도구` 묶음에서 연다.
    await user.click(await wait(() => q('[data-m-tab="more"]')));
    await user.click(await wait(() => q('[data-m-more-row="tool-jira"]')));
    await wait(() => q('[data-ws-mobile]'));
    await wait(() => q('[data-ws-lane-epic]'));
    return user;
  }

  it('머리는 [‹ 전체 · 휴일] / [월 · 보기] / [검색 · 담당자 · 맞춰보기] — 오른쪽 패널·Jira 설정 단추는 없다', async () => {
    await openPhone();
    expect(q('[data-ws-back]')!.textContent).toContain('전체');
    expect(q('[data-ws-holiday-btn]')).toBeTruthy();
    expect(q('[data-ws-members-btn]')).toBeTruthy();
    expect(q('[data-ws-avail-btn]')).toBeTruthy();
    expect(q('[data-ws-panel-btn]')).toBeNull();
    expect(q('[data-ws-date-rule-btn]')).toBeNull();
    // 데스크톱의 칩 격자 대신 폰 달력
    expect(q('[data-ws-calendar]')).toBeNull();
    expect(q('[data-ws-mcal]')).toBeTruthy();
  });

  it('달력 칸은 날짜 + 묶음 선(최대 셋), 칸을 누르면 아래 목록이 그날의 티켓이다(W1)', async () => {
    const user = await openPhone();
    for (const cell of document.querySelectorAll('[data-ws-day]')) expect(cell.querySelectorAll('[data-ws-lane]').length).toBeLessThanOrEqual(3);
    const day = q('[data-ws-lane-epic]')!.closest('[data-ws-day]') as HTMLElement;
    const d = day.getAttribute('data-ws-day')!;
    await user.click(day);
    await waitFor(() => expect(q('[data-ws-mday]')!.getAttribute('data-ws-mday')).toBe(d));
    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[data-ws-mday-ticket]').length).toBeGreaterThan(0);
  });

  it('`‹ 전체`는 전체 탭으로 — 거기서 작업 현황을 다시 누르면 같은 화면이 다시 열린다', async () => {
    const user = await openPhone();
    await user.click(q('[data-ws-back]')!);
    await wait(() => q('[data-m-more]'));
    expect(q('[data-ws-mobile]')).toBeNull();
    expect(q('[data-m-tab="more"]')!.getAttribute('aria-current')).toBe('page');
    await user.click(q('[data-m-more-row="tool-jira"]')!);
    await wait(() => q('[data-ws-mobile]'));
    // 작업 현황에서 전체 탭을 눌러도 같다(예전에는 탭만 바뀌고 도구가 남아 같은 줄이 아무것도 열지 못했다).
    await user.click(q('[data-m-tab="more"]')!);
    await wait(() => q('[data-m-more]'));
    await user.click(q('[data-m-more-row="tool-jira"]')!);
    await wait(() => q('[data-ws-mobile]'));
  });

  it('집계는 표 대신 담당자 카드 — 누르면 프로젝트별 일수가 펼쳐진다(W3)', async () => {
    const user = await openPhone();
    await user.click(screen.getByRole('radio', { name: '집계' }));
    await wait(() => q('[data-ws-mstat]'));
    expect(q('[data-ws-stat-row]')).toBeNull();
    expect(document.querySelectorAll('[data-ws-mstat]').length).toBe(6);
    const first = q('[data-ws-mstat]')!;
    expect(first.getAttribute('aria-expanded')).toBe('false');
    await user.click(first);
    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('true'));
    expect(first.querySelector('[data-ws-mstat-epics]')).toBeTruthy();
  });

  it('타임라인은 묶음 고르기가 표 위로 · 같은 막대(W2)', async () => {
    const user = await openPhone();
    await user.click(screen.getByRole('radio', { name: '타임라인' }));
    await wait(() => q('[data-ws-bar="PAY-101"]'));
    await user.click(screen.getByRole('radio', { name: '프로젝트' }));
    await wait(() => q('[data-ws-bar="PAY-100"]'));
    // 이름 열 머리에는 세그먼트가 아니라 무엇의 줄인지만
    expect(within(q('[data-ws-timeline]')!).queryByRole('radio')).toBeNull();
  });

  it('휴일·영업일은 밀어 들어가는 화면 — 휴일 추가는 바닥 시트(W6)', async () => {
    const user = await openPhone();
    await user.click(q('[data-ws-holiday-btn]')!);
    const page = await wait(() => q('[data-ws-holiday-mobile]'));
    expect(page.querySelectorAll('[data-ws-public]').length).toBeGreaterThan(0);
    // 추가 칸(날짜 · 이름 · 반복)은 화면에 없고 시트에서 연다.
    expect(page.querySelector('[data-ws-company-name]')).toBeNull();
    await user.click(page.querySelector('[data-ws-company-open]')!);
    const sheet = await wait(() => q('[data-ws-company-sheet]'));
    await user.click(sheet.querySelector('[data-ws-company-date]')!);
    const day = await wait(() => document.querySelector<HTMLElement>('[data-datepop-day]'));
    const iso = day.getAttribute('data-datepop-day')!;
    await user.click(day);
    await user.type(sheet.querySelector('[data-ws-company-name]')!, '창립기념일');
    await user.click(sheet.querySelector('[data-ws-company-add]')!);
    await waitFor(() => expect(q('[data-ws-company-sheet]')).toBeNull());
    await wait(() => q(`[data-ws-company="${iso}"]`));
    // ‹ 작업 현황으로 돌아간다
    await user.click(q('[data-ws-holiday-back]')!);
    await waitFor(() => expect(q('[data-ws-holiday]')).toBeNull());
  });

  it('프로젝트 고르기는 전체 화면 두 단계 — 다음은 엄지 자리, 날짜 필드는 시트(W7·W8)', async () => {
    mockMatchMedia(true);
    connectDemo([]);
    window.history.replaceState(null, '', '/home?jira=setup');
    const user = userEvent.setup();
    renderHome('/home?jira=setup');
    await wait(() => q('[data-jira-setup-mobile]'));
    // 폰에는 LNB(도구 구획)가 없다 — 연결 상태는 홈이 직접 불러온다(예전에는 전체 탭을 열기 전까지 「먼저 연결」 판이었다).
    expect((await wait(() => q('[data-jira-step="1"]'))).getAttribute('aria-current')).toBe('step');
    const next = q('[data-jira-setup-next]') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await user.click(await wait(() => q('[data-jira-project="PAY"]')));
    await user.click(q('[data-jira-project="ONB"]')!);
    expect(q('[data-jira-project="PAY"]')!.getAttribute('aria-checked')).toBe('true');
    await user.click(next);
    await wait(() => q('[data-jira-step="2"][aria-current="step"]'));
    // 끝 날짜 — 행을 누르면 바닥 시트, 고르면 닫히고 행이 바뀐다.
    await user.click(q('[data-jira-rule-row="end"]')!);
    const sheet = await wait(() => q('[data-jira-field-sheet="end"]'));
    await user.click(sheet.querySelector('[data-jira-rule-option="resolutiondate"]')!);
    await waitFor(() => expect(q('[data-jira-field-sheet]')).toBeNull());
    expect(q('[data-jira-rule-row="end"]')!.textContent).toContain('해결된 날짜');
    await user.click(await wait(() => q('[data-jira-issue-type="작업"]')));
    // 지난 단계는 눌러 돌아갈 수 있고, 고른 것은 그대로다.
    await user.click(q('[data-jira-setup-back]')!);
    await wait(() => q('[data-jira-step="1"][aria-current="step"]'));
    expect(q('[data-jira-project="ONB"]')!.getAttribute('aria-checked')).toBe('true');
    await user.click(q('[data-jira-setup-next]')!);
    const save = vi.spyOn(demoJira, 'saveProjects');
    await user.click(await wait(() => q('[data-jira-setup-save]')));
    expect(save.mock.calls[0]?.[0].map((p) => p.key)).toEqual(['PAY', 'ONB']);
    expect(save.mock.calls[0]?.[1]).toMatchObject({ end: 'resolutiondate' });
    expect(save.mock.calls[0]?.[2]?.map((t) => t.name)).toEqual(['작업', '작업']);
    save.mockRestore();
    await waitFor(() => expect(q('[data-jira-setup]')).toBeNull());
  });

  it('담당자 · 일정 맞춰보기는 바닥 시트로 연다(W4·W5)', async () => {
    const user = await openPhone();
    await user.click(q('[data-ws-members-btn]')!);
    await wait(() => q('[data-ws-members-sheet]'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(q('[data-ws-members-sheet]')).toBeNull());
    await user.click(q('[data-ws-avail-btn]')!);
    const sheet = await wait(() => q('[data-ws-avail-sheet]'));
    expect(sheet.querySelector('[data-ws-avail]')).toBeTruthy();
  });
});

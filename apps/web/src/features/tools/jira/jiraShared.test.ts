import { describe, expect, it } from 'vitest';
import { coerceIssueTypes, statusesOf, coerceProjects, coerceRule, issueTypesOf, dateFields, epicFromParent, epicsJql, jqlField, nextDay, normalizeTicket, normalizeUsers, overlaps, pickStartField, statusOf, ticketsJql } from '../../../../../../supabase/functions/_shared/jira';

// Edge Function(`supabase/functions/jira`)이 쓰는 순수한 부분 — JQL·정리·필드 고르기.

const R = (start: string | null, end = 'duedate', fill = false) => ({ start, end, fill });

describe('JQL', () => {
  it('시작일 필드가 있으면 겹침 + 한쪽만 있는 경우', () => {
    const q = ticketsJql(['PAY', 'ONB'], '2026-09-01', '2026-09-30', R('customfield_10015'));
    expect(q).toContain('project in (PAY, ONB)');
    expect(q).toContain('issuetype in standardIssueTypes()');
    expect(q).toContain('(duedate >= "2026-09-01" AND cf[10015] < "2026-10-01")');
    expect(q).toContain('(cf[10015] is EMPTY AND (duedate >= "2026-09-01" AND duedate < "2026-10-01"))');
    expect(q).toContain('(duedate is EMPTY AND (cf[10015] >= "2026-09-01" AND cf[10015] < "2026-10-01"))');
  });
  it('에픽이 없는 티켓도 부른다(부모 조건이 없다 — 제보 2026-10-01)', () => {
    expect(ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R(null))).not.toContain('parent');
  });
  it('시작일 필드가 없으면 끝 날짜가 그 기간 안인 것', () => {
    expect(ticketsJql(['PAY'], '2026-09-01', '2026-09-30', R(null))).toContain('AND ((duedate >= "2026-09-01" AND duedate < "2026-10-01")) ORDER BY');
  });
  it('만든 날 ~ 해결된 날: 아직 안 끝난 것은 시작이 기간 끝 전이면', () => {
    const q = ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R('created', 'resolutiondate'))!;
    expect(q).toContain('(resolved >= "2026-09-01" AND created < "2026-10-01")');
    expect(q).toContain('(resolved is EMPTY AND created < "2026-10-01")');
    expect(q).not.toContain('created is EMPTY');
  });
  it('날짜 채우기: 두 날짜가 다 빈 것은 만든 날로', () => {
    const q = ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R('customfield_10014', 'duedate', true))!;
    expect(q).toContain('(cf[10014] is EMPTY AND duedate is EMPTY AND created < "2026-10-01" AND (resolved is EMPTY OR resolved >= "2026-09-01"))');
  });
  it('이슈 유형은 id로만 — 모양이 틀린 것은 빠진다', () => {
    const q = ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R(null), ['10146', '10143', '10146', 'x) OR (1=1'])!;
    expect(q).toContain('AND issuetype in standardIssueTypes() AND issuetype in (10146, 10143) AND assignee');
    expect(ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R(null), [])).not.toContain('issuetype in (');
    expect(coerceIssueTypes([{ id: '10146', name: '품질점검' }, { id: '10146' }, { id: 'bad' }])).toEqual([{ id: '10146', name: '품질점검' }]);
    expect(issueTypesOf({ issueTypes: [{ id: '10143', name: '작업', hierarchyLevel: 0 }, { id: '10144', name: '하위 작업', subtask: true, hierarchyLevel: -1 }, { id: '10000', name: '에픽', hierarchyLevel: 1 }] })).toEqual([{ id: '10143', name: '작업' }]);
  });
  it('상태도 id로만 · 프로젝트 상태 응답에서 고른 유형의 것만', () => {
    expect(ticketsJql(['SQA'], '2026-09-01', '2026-09-30', R(null), [], ['10214', 'x'])).toContain('AND status in (10214) AND assignee');
    const body = [
      { id: '10146', name: '품질점검', subtask: false, statuses: [{ id: '10214', name: '진행 중', statusCategory: { key: 'indeterminate' } }, { id: '10300', name: '품질점검 완료', statusCategory: { key: 'done' } }] },
      { id: '10143', name: '작업', subtask: false, statuses: [{ id: '10214', name: '진행 중', statusCategory: { key: 'indeterminate' } }, { id: '10213', name: '해야 할 일', statusCategory: { key: 'new' } }] },
      { id: '10144', name: '하위 작업', subtask: true, statuses: [{ id: '10999', name: '서브', statusCategory: { key: 'new' } }] },
    ];
    expect(statusesOf(body).map((x) => x.id)).toEqual(['10214', '10300', '10213']);
    expect(statusesOf(body, ['10146'])).toEqual([{ id: '10214', name: '진행 중', cat: 'doing' }, { id: '10300', name: '품질점검 완료', cat: 'done' }]);
  });
  it('달의 마지막 날 다음 날', () => {
    expect([nextDay('2026-12-31'), nextDay('2028-02-28')]).toEqual(['2027-01-01', '2028-02-29']);
  });
  it('모양이 틀린 입력은 JQL에 들어가지 않는다', () => {
    expect(ticketsJql(['pay) OR 1=1'], '2026-09-01', '2026-09-30', R(null))).toBeNull();
    expect(ticketsJql(['PAY'], '2026-9-1', '2026-09-30', R(null))).toBeNull();
    expect(ticketsJql(['PAY'], '2026-09-30', '2026-09-01', R(null))).toBeNull();
    expect(ticketsJql(['PAY', 'bad key'], '2026-09-01', '2026-09-30', coerceRule('cf) OR (', 'x) OR (', true))).toContain('project in (PAY)');
    expect(coerceRule('cf) OR (', 'summary', undefined)).toEqual({ start: null, end: 'duedate', fill: true, release: null });
    expect(coerceRule('created', 'resolutiondate', false)).toEqual({ start: 'created', end: 'resolutiondate', fill: false, release: null });
    expect(jqlField('summary')).toBeNull();
    expect(epicsJql(['PAY-1', 'x', 'PAY-1', 'SQA'])).toBe('key in (PAY-1)');
  });
});

describe('정리', () => {
  const issue = (f: Record<string, unknown>) => ({ key: 'PAY-101', fields: { summary: '결제', assignee: { accountId: 'a1', displayName: '이호율' }, status: { statusCategory: { key: 'indeterminate' } }, parent: { key: 'PAY-100', fields: { summary: '결제 개편', issuetype: { hierarchyLevel: 1 } } }, ...f } });
  it('시작일이 없으면 기한 하루로', () => {
    const t = normalizeTicket(issue({ duedate: '2026-09-10' }), R('customfield_10015'));
    expect(t).toMatchObject({ start: '2026-09-10', end: '2026-09-10', startMissing: true, endMissing: false, status: 'doing', epic: 'PAY-100' });
  });
  it('시작·기한이 뒤바뀐 입력은 순서를 바로잡는다', () => {
    const t = normalizeTicket(issue({ duedate: '2026-09-01', customfield_10015: '2026-09-05' }), R('customfield_10015'));
    expect([t?.start, t?.end]).toEqual(['2026-09-01', '2026-09-05']);
  });
  it('부모가 에픽이 아니면 티켓 자신이 묶음 — 담당자·날짜가 없거나 에픽 자신이면 뺀다', () => {
    expect(normalizeTicket(issue({ duedate: '2026-09-01', parent: { key: 'S-1', fields: { issuetype: { hierarchyLevel: 0 } } } }), R(null))?.epic).toBe('PAY-101');
    expect(normalizeTicket(issue({ duedate: '2026-09-01', parent: null }), R(null))?.epic).toBe('PAY-101');
    expect(epicFromParent(issue({ parent: null }))).toEqual({ key: 'PAY-101', name: '결제', start: null, end: null, status: 'doing', solo: true });
    expect(normalizeTicket(issue({ duedate: '2026-09-01', issuetype: { hierarchyLevel: 1 } }), R(null))).toBeNull();
    expect(normalizeTicket(issue({ duedate: '2026-09-01', assignee: null }), R(null))).toBeNull();
    expect(normalizeTicket(issue({}), R(null))).toBeNull();
  });
  it('배포 예정일은 고른 필드에서 — 막대는 그대로', () => {
    const t = normalizeTicket(issue({ customfield_10014: '2026-09-18', duedate: '2026-10-01', customfield_10464: '2026-10-07' }), { start: 'customfield_10014', end: 'duedate', fill: false, release: 'customfield_10464' });
    expect(t).toMatchObject({ start: '2026-09-18', end: '2026-10-01', release: '2026-10-07' });
    expect(normalizeTicket(issue({ duedate: '2026-10-01' }), R(null))?.release).toBeUndefined();
    expect(coerceRule(null, 'duedate', true, 'cf) OR (').release).toBeNull();
    expect(coerceRule(null, 'duedate', true, 'customfield_10464').release).toBe('customfield_10464');
  });
  it('날짜 채우기 — 만든 날 ~ 해결된 날, 아직이면 오늘까지', () => {
    const base = { created: '2026-09-16T14:57:53.804+0900' };
    expect(normalizeTicket(issue({ ...base, resolutiondate: '2026-09-30T09:45:07.687+0900' }), R('customfield_10014', 'duedate', true), '2026-10-01')).toMatchObject({ start: '2026-09-16', end: '2026-09-30', filled: true, startMissing: false, endMissing: false });
    expect(normalizeTicket(issue(base), R('customfield_10014', 'duedate', true), '2026-10-01')).toMatchObject({ start: '2026-09-16', end: '2026-10-01', filled: true });
    expect(normalizeTicket(issue(base), R('customfield_10014', 'duedate', false), '2026-10-01')).toBeNull();
    // 날짜가 하나라도 있으면 채우지 않는다
    expect(normalizeTicket(issue({ ...base, duedate: '2026-09-20' }), R('customfield_10014', 'duedate', true), '2026-10-01')).toMatchObject({ start: '2026-09-20', end: '2026-09-20', startMissing: true });
  });
  it('끝이 해결된 날이면 진행 중인 티켓은 오늘까지 — 끝난 티켓은 시작 하루', () => {
    const t = normalizeTicket(issue({ created: '2026-09-10T10:00:00.000+0900' }), R('created', 'resolutiondate'), '2026-09-25');
    expect(t).toMatchObject({ start: '2026-09-10', end: '2026-09-25', endMissing: false });
    const done = issue({ created: '2026-09-10T10:00:00.000+0900', status: { statusCategory: { key: 'done' } } });
    expect(normalizeTicket(done, R('created', 'resolutiondate'), '2026-09-25')).toMatchObject({ start: '2026-09-10', end: '2026-09-10', endMissing: true });
    expect(overlaps({ start: '2026-08-01', end: '2026-08-31' }, '2026-09-01', '2026-09-30')).toBe(false);
  });
  it('상태 분류', () => {
    expect([statusOf('new'), statusOf('indeterminate'), statusOf('done'), statusOf(undefined)]).toEqual(['todo', 'doing', 'done', 'todo']);
  });
  it('앱·비활성 계정은 사용자 검색에서 뺀다', () => {
    expect(normalizeUsers([{ accountId: 'a', displayName: 'A', accountType: 'atlassian' }, { accountId: 'b', accountType: 'app' }, { accountId: 'c', active: false }])).toEqual([{ id: 'a', name: 'A' }]);
  });
  it('프로젝트 목록은 모양을 확인하고 중복을 뺀다', () => {
    expect(coerceProjects([{ key: 'PAY', name: '결제' }, { key: 'PAY' }, { key: 'bad' }, null])).toEqual([{ key: 'PAY', name: '결제' }]);
  });
});

describe('시작일 필드 고르기', () => {
  const f = (id: string, name: string, custom = 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker', type = 'date') => ({ id, name, schema: { type, custom } });
  it('Jira 기본 Start date를 먼저', () => {
    expect(pickStartField([f('customfield_1', 'Kickoff start'), f('customfield_10015', 'Start date'), { id: 'duedate', name: 'Due date', schema: { type: 'date' } }])).toEqual({ id: 'customfield_10015', name: 'Start date' });
  });
  it('번역된 이름도 찾는다', () => {
    expect(pickStartField([f('customfield_2', '시작 날짜')])?.id).toBe('customfield_2');
  });
  it('Advanced Roadmaps의 Target start', () => {
    expect(pickStartField([f('customfield_3', 'Target start', 'com.atlassian.jpo:jpo-custom-field-baseline-start')])?.id).toBe('customfield_3');
  });
  it('날짜가 아닌 필드는 이름이 맞아도 고르지 않는다', () => {
    expect(pickStartField([f('customfield_4', 'Start date', 'x', 'string')])).toBeNull();
  });
  it('고를 수 있는 날짜 필드 — 커스텀 날짜·일시만, 이름순', () => {
    expect(dateFields([f('customfield_9', '배포예정일'), f('customfield_8', '시작 날짜'), f('customfield_7', 'x', 'x', 'string'), { id: 'duedate', name: '기한', schema: { type: 'date' } }])).toEqual([
      { id: 'customfield_9', name: '배포예정일' },
      { id: 'customfield_8', name: '시작 날짜' },
    ]);
  });
});

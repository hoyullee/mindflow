import { describe, expect, it } from 'vitest';
import { coerceProjects, epicsJql, jqlField, normalizeTicket, normalizeUsers, pickStartField, statusOf, ticketsJql } from '../../../../../../supabase/functions/_shared/jira';

// Edge Function(`supabase/functions/jira`)이 쓰는 순수한 부분 — JQL·정리·필드 고르기.

describe('JQL', () => {
  it('시작일 필드가 있으면 겹침 + 한쪽만 있는 경우', () => {
    const q = ticketsJql(['PAY', 'ONB'], '2026-09-01', '2026-09-30', 'customfield_10015');
    expect(q).toContain('project in (PAY, ONB)');
    expect(q).toContain('issuetype in standardIssueTypes()');
    expect(q).toContain('(duedate >= "2026-09-01" AND cf[10015] <= "2026-09-30")');
    expect(q).toContain('(cf[10015] is EMPTY AND (duedate >= "2026-09-01" AND duedate <= "2026-09-30"))');
    expect(q).toContain('(duedate is EMPTY AND (cf[10015] >= "2026-09-01" AND cf[10015] <= "2026-09-30"))');
  });
  it('시작일 필드가 없으면 기한이 그 기간 안인 것', () => {
    expect(ticketsJql(['PAY'], '2026-09-01', '2026-09-30', null)).toContain('AND (duedate >= "2026-09-01" AND duedate <= "2026-09-30") ORDER BY');
  });
  it('모양이 틀린 입력은 JQL에 들어가지 않는다', () => {
    expect(ticketsJql(['pay) OR 1=1'], '2026-09-01', '2026-09-30', null)).toBeNull();
    expect(ticketsJql(['PAY'], '2026-9-1', '2026-09-30', null)).toBeNull();
    expect(ticketsJql(['PAY'], '2026-09-30', '2026-09-01', null)).toBeNull();
    expect(ticketsJql(['PAY', 'bad key'], '2026-09-01', '2026-09-30', 'cf) OR (')).toContain('project in (PAY)');
    expect(jqlField('summary')).toBeNull();
    expect(epicsJql(['PAY-1', 'x', 'PAY-1'])).toBe('key in (PAY-1)');
  });
});

describe('정리', () => {
  const issue = (f: Record<string, unknown>) => ({ key: 'PAY-101', fields: { summary: '결제', assignee: { accountId: 'a1', displayName: '이호율' }, status: { statusCategory: { key: 'indeterminate' } }, parent: { key: 'PAY-100', fields: { summary: '결제 개편', issuetype: { hierarchyLevel: 1 } } }, ...f } });
  it('시작일이 없으면 기한 하루로', () => {
    const t = normalizeTicket(issue({ duedate: '2026-09-10' }), 'customfield_10015');
    expect(t).toMatchObject({ start: '2026-09-10', end: '2026-09-10', startMissing: true, endMissing: false, status: 'doing', epic: 'PAY-100' });
  });
  it('시작·기한이 뒤바뀐 입력은 순서를 바로잡는다', () => {
    const t = normalizeTicket(issue({ duedate: '2026-09-01', customfield_10015: '2026-09-05' }), 'customfield_10015');
    expect([t?.start, t?.end]).toEqual(['2026-09-01', '2026-09-05']);
  });
  it('부모가 에픽 계층이 아니거나 담당자·날짜가 없으면 뺀다', () => {
    expect(normalizeTicket(issue({ duedate: '2026-09-01', parent: { key: 'S-1', fields: { issuetype: { hierarchyLevel: 0 } } } }), null)).toBeNull();
    expect(normalizeTicket(issue({ duedate: '2026-09-01', assignee: null }), null)).toBeNull();
    expect(normalizeTicket(issue({}), null)).toBeNull();
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
});

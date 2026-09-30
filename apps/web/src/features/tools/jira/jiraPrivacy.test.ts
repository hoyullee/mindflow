import { describe, expect, it } from 'vitest';
import { applyReport, chunks, collectAccounts, parseReport, reportBody, REPORT_BATCH } from '../../../../../../supabase/functions/_shared/jiraPrivacy';

// Edge Function `jira-privacy`(Atlassian 개인정보 보고)의 순수한 부분.

const row = (owner: string, work: unknown, updated_at = '2026-09-01T00:00:00Z') => ({ owner, data: { jira: { show: true, label: null }, work }, updated_at });

describe('보고할 계정 모으기', () => {
  it('extra(받은 시각)와 hidden(행의 시각)을 모으고, 같은 사람은 가장 오래된 시각', () => {
    const m = collectAccounts([
      row('u1', { extra: [{ id: 'a', name: 'A', at: '2026-09-20T00:00:00Z' }, { id: 'b', name: 'B' }], hidden: ['c'] }, '2026-09-10T00:00:00Z'),
      row('u2', { extra: [{ id: 'a', name: 'A', at: '2026-09-05T00:00:00Z' }], hidden: [] }),
      row('u3', null),
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: '2026-09-05T00:00:00.000Z', b: '2026-09-10T00:00:00.000Z', c: '2026-09-10T00:00:00.000Z' });
  });

  it('연결을 해제한 사람의 설정도 모은다(행이 있으면 본다 — 자격 증명과 무관)', () => {
    expect(collectAccounts([row('gone', { extra: [{ id: 'x', name: 'X' }] })]).has('x')).toBe(true);
  });

  it('90개씩 나누고 본문은 accountId·updatedAt', () => {
    const list = Array.from({ length: 181 }, (_, i) => [`id${i}`, '2026-09-01T00:00:00.000Z'] as [string, string]);
    expect(chunks(list).map((c) => c.length)).toEqual([REPORT_BATCH, REPORT_BATCH, 1]);
    expect(reportBody(list.slice(0, 1))).toEqual({ accounts: [{ accountId: 'id0', updatedAt: '2026-09-01T00:00:00.000Z' }] });
  });
});

describe('보고 결과 반영', () => {
  it('응답을 closed·updated로 가른다(모르는 status는 무시)', () => {
    expect(parseReport({ accounts: [{ accountId: 'a', status: 'closed' }, { accountId: 'b', status: 'updated' }, { accountId: 'c', status: 'x' }] })).toEqual({ closed: ['a'], updated: ['b'] });
    expect(parseReport(null)).toEqual({ closed: [], updated: [] });
  });

  it('closed는 extra·hidden 모두에서 지우고, 새 이름은 이름과 시각을 고친다', () => {
    const data = row('u', { extra: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', at: '2026-01-01T00:00:00Z' }, { id: 'k', name: 'K' }], hidden: ['a', 'z'], country: 'KR' }).data;
    const next = applyReport(data, new Set(['a']), new Map([['b', 'B2']]), '2026-09-30T00:00:00.000Z');
    expect(next).toEqual({ jira: { show: true, label: null }, work: { extra: [{ id: 'b', name: 'B2', at: '2026-09-30T00:00:00.000Z' }, { id: 'k', name: 'K' }], hidden: ['z'], country: 'KR' } });
  });

  it('바뀐 것이 없으면 null(쓰지 않는다)', () => {
    expect(applyReport(row('u', { extra: [{ id: 'k', name: 'K' }], hidden: [] }).data, new Set(['a']), new Map(), 'now')).toBeNull();
    expect(applyReport({}, new Set(['a']), new Map(), 'now')).toBeNull();
  });
});

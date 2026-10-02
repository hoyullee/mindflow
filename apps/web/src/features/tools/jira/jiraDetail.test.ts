import { describe, expect, it } from 'vitest';
import { adfToText, fieldOf, normalizeChildren, normalizeComments, normalizeDetail, pruneAdf, stamp } from '../../../../../../supabase/functions/_shared/jiraDetail';
import { ago, dueLabel } from '../workstatus/WsIssueModal';

// 상세 팝업이 쓰는 순수한 부분 — Edge Function `jira`의 `issue` 동작이 같은 것을 쓴다.

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string) => ({ type: 'text', text });

describe('ADF → 줄글', () => {
  it('문단·목록(중첩)·멘션·표·첨부', () => {
    const d = doc(
      p(t('배경')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('기존 : 시작일 기준')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('하위'))] }] }] }, { type: 'listItem', content: [p(t('변경 '), { type: 'mention', attrs: { text: '@이호율' } })] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('하나'))] }, { type: 'listItem', content: [p(t('둘'))] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('A'))] }, { type: 'tableCell', content: [p(t('B'))] }] }] },
      { type: 'mediaSingle', content: [{ type: 'media' }] },
      p(t('끝'), { type: 'hardBreak' }, t('줄')),
    );
    expect(adfToText(d)).toBe('배경\n- 기존 : 시작일 기준\n  - 하위\n- 변경 @이호율\n1. 하나\n2. 둘\nA | B\n[첨부]\n끝\n줄');
  });
  it('문자열은 그대로 · 빈 문서는 빈 글', () => {
    expect(adfToText('그냥 글')).toBe('그냥 글');
    expect(adfToText(doc())).toBe('');
  });
});

describe('필드 한 줄', () => {
  it('사람·태그·날짜·숫자·링크·옵션', () => {
    expect(fieldOf('x', 'QA 담당', { type: 'user' }, { accountId: 'a1', displayName: '박지훈', emailAddress: 'x@y' })).toEqual({ label: 'QA 담당', kind: 'person', value: '박지훈', personId: 'a1' });
    expect(fieldOf('labels', '레이블', { type: 'array', items: 'string' }, ['backend', 'payment'])?.tags).toEqual(['backend', 'payment']);
    expect(fieldOf('components', '컴포넌트', { type: 'array', items: 'component' }, [{ name: '결제' }])?.tags).toEqual(['결제']);
    expect(fieldOf('c1', '배포예정일', { type: 'date' }, '2026-10-07')).toMatchObject({ kind: 'mono', value: '2026-10-07' });
    expect(fieldOf('c2', '스토리 포인트', { type: 'number' }, 5)).toMatchObject({ kind: 'mono', value: '5' });
    expect(fieldOf('c3', '디자인', { type: 'string' }, 'https://www.figma.com/file/aB3xZ/payment-v3')).toMatchObject({ kind: 'link', value: 'figma.com · payment-v3' });
    expect(fieldOf('c4', '서비스', { type: 'option' }, { value: '이벤트', id: '1' })).toMatchObject({ kind: 'text', value: '이벤트' });
    expect(fieldOf('c5', '빈 글', { type: 'string' }, '   ')).toBeNull();
    expect(stamp('2026-09-16T14:57:53.804+0900')).toBe('2026-09-16 14:57');
  });
});

describe('이슈 → 상세', () => {
  const issue = {
    key: 'SQA-346',
    names: { summary: '요약', customfield_10014: '시작 날짜', customfield_10464: '배포예정일', customfield_10234: '서비스', labels: '레이블', customfield_10019: '순위', customfield_10020: 'Sprint', customfield_10198: '디자인', created: '만듦', updated: '업데이트' },
    schema: { customfield_10014: { type: 'date' }, customfield_10464: { type: 'date' }, customfield_10234: { type: 'array', items: 'option' }, labels: { type: 'array', items: 'string' }, customfield_10019: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' }, customfield_10020: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' }, customfield_10198: { type: 'string' } },
    fields: {
      summary: '이벤트 플랫폼 - 구매일 기준 환불 가능일 설정',
      issuetype: { name: '품질점검', hierarchyLevel: 0 },
      status: { name: '진행 중', statusCategory: { key: 'indeterminate' } },
      priority: { id: '3', name: 'P3' },
      project: { key: 'SQA', name: '품질팀 업무' },
      assignee: { accountId: 'u1', displayName: '여은진', emailAddress: 'secret@x' },
      reporter: { accountId: 'u1', displayName: '여은진' },
      customfield_10014: '2026-09-18',
      duedate: '2026-10-01',
      customfield_10464: '2026-10-07',
      customfield_10234: [{ value: '이벤트' }],
      labels: [],
      customfield_10019: '2|i0b1or:',
      customfield_10020: [{ name: 'S18', state: 'closed' }, { name: 'S19', state: 'active' }],
      customfield_10198: null,
      description: doc(p(t('배경'))),
      comment: { comments: [] },
      watches: { watchCount: 2 },
      created: '2026-09-16T14:57:53.804+0900',
      updated: '2026-10-01T10:19:27.409+0900',
    },
  };
  it('머리·기간·스프린트·모든 필드(빈 것은 세기만, 기간 필드는 뺀다)', () => {
    const d = normalizeDetail(issue, { start: 'customfield_10014', end: 'duedate' })!;
    expect(d).toMatchObject({ key: 'SQA-346', type: { name: '품질점검', epic: false }, status: { name: '진행 중', cat: 'doing' }, epic: null, start: '2026-09-18', end: '2026-10-01', sprint: 'S19', priority: { id: '3', name: 'P3' }, project: { key: 'SQA', name: '품질팀 업무' }, description: '배경' });
    expect(d.assignee).toEqual({ id: 'u1', name: '여은진' }); // 이메일은 싣지 않는다
    expect(d.fields.map((f) => f.label)).toEqual(['배포예정일', '서비스', '만듦', '업데이트']);
    expect(d.hiddenEmpty).toBe(2); // 레이블 · 디자인
  });
  it('부모가 에픽이면 에픽 칩 · 자신이 에픽이면 epic 표시', () => {
    const withParent = { ...issue, fields: { ...issue.fields, parent: { key: 'PAY-100', fields: { summary: '결제 개편', issuetype: { hierarchyLevel: 1 } } } } };
    expect(normalizeDetail(withParent, { start: null, end: 'duedate' })?.epic).toEqual({ key: 'PAY-100', name: '결제 개편' });
    const epic = { ...issue, fields: { ...issue.fields, issuetype: { name: '에픽', hierarchyLevel: 1 } } };
    expect(normalizeDetail(epic, { start: null, end: 'duedate' })?.type.epic).toBe(true);
    expect(normalizeDetail({ key: 'bad', fields: {} }, { start: null, end: 'duedate' })).toBeNull();
  });
  it('댓글은 최근 셋을 오래된 것부터 · 하위 티켓', () => {
    const c = normalizeComments({ total: 5, comments: [3, 2, 1, 0].map((i) => ({ author: { accountId: `a${i}`, displayName: `사람${i}` }, created: `2026-09-2${i}T10:00:00.000+0900`, body: doc(p(t(`글${i}`))) })) });
    expect(c.total).toBe(5);
    expect(c.comments.map((x) => x.text)).toEqual(['글1', '글2', '글3']);
    expect(normalizeChildren([{ key: 'PAY-101', fields: { summary: 'a', status: { statusCategory: { key: 'done' } }, assignee: null, duedate: '2026-09-05' } }], { start: null, end: 'duedate' })).toEqual([{ key: 'PAY-101', summary: 'a', status: 'done', person: null, start: null, end: '2026-09-05' }]);
  });
});

describe('팝업 표기', () => {
  it('기간 알약', () => {
    expect(dueLabel('2026-09-21', '2026-10-02', false, '2026-09-30')?.text).toBe('2일 남음');
    expect(dueLabel('2026-09-21', '2026-10-20', false, '2026-09-30')).toMatchObject({ text: '20일 남음', fg: '#2F7D57' });
    expect(dueLabel('2026-10-05', '2026-10-20', false, '2026-09-30')?.text).toBe('5일 뒤 시작');
    expect(dueLabel('2026-09-01', '2026-09-20', false, '2026-09-30')?.text).toBe('10일 지남');
    expect(dueLabel(null, '2026-09-30', false, '2026-09-30')?.text).toBe('오늘 마감');
    expect(dueLabel(null, null, true, '2026-09-30')?.text).toBe('완료');
  });
  it('댓글 시각', () => {
    const now = new Date(2026, 8, 30, 14, 0).getTime();
    expect([ago('2026-09-30 10:00', now), ago('2026-09-29 10:00', now), ago('2026-09-26 10:00', now), ago('2026-09-01 10:00', now)]).toEqual(['4시간 전', '어제', '4일 전', '2026.09.01']);
  });
});

describe('ADF 줄이기(원본 서식으로 그릴 문서)', () => {
  it('종류·글·서식·필요한 속성만 — 미디어 id·사용자 id는 버린다', () => {
    const d = doc(
      { type: 'orderedList', attrs: { order: 3, localId: 'x' }, content: [{ type: 'listItem', content: [p({ type: 'text', text: '굵게', marks: [{ type: 'strong' }, { type: 'link', attrs: { href: 'https://a.b', __confluenceMetadata: { x: 1 } } }] })] }] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'secret-media-id', collection: 'c', type: 'file' } }] },
      p({ type: 'mention', attrs: { id: 'account-id', text: '@이호율', accessLevel: '' } }),
    );
    expect(pruneAdf(d)).toEqual({
      type: 'doc',
      content: [
        { type: 'orderedList', attrs: { order: 3, localId: 'x' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '굵게', marks: [{ type: 'strong' }, { type: 'link', attrs: { href: 'https://a.b' } }] }] }] }] },
        { type: 'mediaSingle', content: [{ type: 'media' }] },
        { type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@이호율' } }] },
      ],
    });
    expect(pruneAdf('글')).toBeNull();
    expect(pruneAdf(doc())).toBeNull();
    // 노드 수 상한
    const big = doc(...Array.from({ length: 50 }, (_, i) => p(t(String(i)))));
    expect(pruneAdf(big, 10)!.content!.length).toBeLessThan(10);
  });
});

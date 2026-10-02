import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AdfView } from './AdfView';
import type { AdfNode } from '../../../../../../supabase/functions/_shared/jiraDetail';

// 티켓 상세의 설명·댓글 — 원본 서식 그대로(목록 표식은 공책 규칙 `listMarkers`).

const p = (text: string): AdfNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const li = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content });

describe('AdfView', () => {
  it('번호·글머리 목록 — 단계마다 1. → a. → i. / • → ◦, 시작 번호를 지킨다', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        { type: 'orderedList', attrs: { order: 2 }, content: [li(p('둘'), { type: 'orderedList', content: [li(p('가'), { type: 'orderedList', content: [li(p('로마'))] }), li(p('나'))] }), li(p('셋'))] },
        { type: 'bulletList', content: [li(p('점'), { type: 'bulletList', content: [li(p('속'))] })] },
      ],
    };
    const { container } = render(<AdfView doc={doc} />);
    const marks = [...container.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent);
    expect(marks).toEqual(['2.', 'a.', 'i.', 'b.', '3.', '•', '◦']);
    expect(container.textContent).toContain('로마');
  });
  it('굵게·링크(안전한 주소만)·코드·표', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '굵게', marks: [{ type: 'strong' }] }, { type: 'text', text: '링크', marks: [{ type: 'link', attrs: { href: 'https://wantedlab.atlassian.net/browse/LIVE-1069' } }] }, { type: 'text', text: '나쁜', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'a = 1' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p('머리')] }, { type: 'tableCell', content: [p('칸')] }] }] },
      ],
    };
    const { container } = render(<AdfView doc={doc} />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://wantedlab.atlassian.net/browse/LIVE-1069']);
    expect(container.querySelector('pre')?.textContent).toBe('a = 1');
    expect(container.querySelector('th')?.textContent).toBe('머리');
    expect(container.textContent).toContain('나쁜');
  });
});

// 공책 — 네 번째 문서 종류(`kind: 'note'`). 캔버스가 아니라 **페이지의 글**이고,
// 저장·공유는 문서 기반이라 기존 경로를 그대로 탄다.
//
// 이 파일이 지키는 것: 캔버스 UI가 **하나도** 뜨지 않는다 · 글이 문서에 저장된다 ·
// 블록 종류를 바꿔도 글을 잃지 않는다 · **열 것이 없어지지 않는다**(마지막 페이지).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const NOTE = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'note',
  pages: [
    {
      id: 'p1',
      title: '9월 3주 회의록',
      blocks: [
        { id: 'b1', kind: 'p', runs: [{ t: '릴리즈 범위를 좁혔습니다.', b: false, c: null }] },
        { id: 'b2', kind: 'h2', runs: [{ t: '결정한 것', b: false, c: null }] },
        {
          id: 'b3',
          kind: 'ck',
          items: [
            { id: 'i1', runs: [{ t: '알림을 분리한다', b: false, c: null }], done: false },
            { id: 'i2', runs: [{ t: '위젯은 다음으로', b: false, c: null }], done: true },
          ],
        },
        { id: 'b4', kind: 'table', rows: [[[{ t: '할 일', b: false, c: null }], [{ t: '담당', b: false, c: null }]], [[{ t: '문구 검수', b: false, c: null }], [{ t: '나', b: false, c: null }]]] },
      ],
      updatedAt: '2026-09-16T00:00:00.000Z',
    },
    { id: 'p2', title: '주간 회고', blocks: [{ id: 'b9', kind: 'p', runs: [{ t: 'Keep', b: false, c: null }] }] },
  ],
  cover: { tag: '회의록' },
};

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');

/** 편집 박스에 글을 넣는다 — `contentEditable`이라 `input` 이벤트로 알린다. */
function type(el: Element, html: string): void {
  (el as HTMLElement).innerHTML = html;
  fireEvent.input(el);
}

/** 지금 상태를 저장한다 — 자동 저장은 디바운스라 테스트 시간 안에 오지 않는다
 *  (칸반 테스트와 같은 처방: ⌘/Ctrl+S로 확정한다). */
function saveNow(): void {
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

describe('공책 에디터', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('페이지 목록과 본문이 그려지고, **캔버스 UI는 하나도 없다**', async () => {
    localStorage.setItem('mindflow_doc_nb1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb1&title=x');

    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());
    // 페이지 목록 — 두 장.
    expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(2);
    // 본문 — 블록 넷.
    expect(container.querySelectorAll('[data-note-block]')).toHaveLength(4);
    expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('9월 3주 회의록');
    // 캔버스가 아니다 — 팬 레이어·줌·그리기가 없다.
    expect(container.querySelector('[data-pan-layer]')).toBeNull();
    expect(container.querySelector('[data-zoom-cluster]')).toBeNull();
  });

  it('블록마다 제 모양으로 그려진다 — 체크·표·제목', async () => {
    localStorage.setItem('mindflow_doc_nb2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-block="b3"]')).toBeTruthy());

    expect(container.querySelector('[data-note-block="b2"]')?.getAttribute('data-note-kind')).toBe('h2');
    // 체크리스트 — 항목 둘, 하나는 켜져 있다.
    const checks = container.querySelectorAll('[data-note-check]');
    expect(checks).toHaveLength(2);
    expect(checks[0]!.getAttribute('aria-checked')).toBe('false');
    expect(checks[1]!.getAttribute('aria-checked')).toBe('true');
    // 표 — 머리 행 + 본문 행.
    const rows = container.querySelectorAll('[data-note-block="b4"] tr');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('할 일')).toBeTruthy();
  });

  it('글을 쓰면 **그 페이지에** 저장된다', async () => {
    localStorage.setItem('mindflow_doc_nb3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    type(container.querySelector('[data-note-line="b1"]')!, '범위를 다시 좁혔습니다');
    saveNow();
    await waitFor(() => {
      const doc = saved('nb3');
      expect(doc?.pages?.[0]?.blocks?.[0]?.runs?.[0]?.t).toBe('범위를 다시 좁혔습니다');
    });
  });

  it('체크를 누르면 켜지고 저장된다', async () => {
    localStorage.setItem('mindflow_doc_nb4', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb4&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-check="i1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-check="i1"]')!);
    saveNow();
    await waitFor(() => expect(saved('nb4')?.pages?.[0]?.blocks?.[2]?.items?.[0]?.done).toBe(true));
  });

  it('페이지를 눌러 옮기고, 새 페이지를 만든다', async () => {
    localStorage.setItem('mindflow_doc_nb5', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb5&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-page-row="p2"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-page-row="p2"]')!);
    await waitFor(() => expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('주간 회고'));

    fireEvent.click(container.querySelector('[data-note-new-page]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(3));
    // 새 장은 **지금 장 바로 뒤**에 들어간다(글의 흐름).
    saveNow();
    await waitFor(() => expect(saved('nb5')?.pages?.length).toBe(3));
    expect(saved('nb5').pages[1].id).toBe('p2');
  });

  it('**마지막 페이지는 지울 수 없다** — 버튼이 꺼진다', async () => {
    const one = { ...NOTE, pages: [NOTE.pages[0]] };
    localStorage.setItem('mindflow_doc_nb6', JSON.stringify(one));
    const { container } = renderEditor('/editor?map=nb6&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-del-page]')).toBeTruthy());

    const del = container.querySelector('[data-note-del-page]') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toContain('한 장 이상');
  });

  it('두 장이면 지워지고 남은 장으로 옮겨 간다', async () => {
    localStorage.setItem('mindflow_doc_nb7', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb7&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-del-page]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-del-page]') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('[data-note-page-row]')).toHaveLength(1));
    expect((container.querySelector('[data-note-title]') as HTMLInputElement).value).toBe('주간 회고');
  });

  it('블록 종류를 바꿔도 **글을 잃지 않는다**', async () => {
    localStorage.setItem('mindflow_doc_nb8', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb8&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());

    // 툴바는 **포커스가 온 줄**을 기억한다(선택이 접혀 있어도 대상을 잃지 않게).
    fireEvent.focus(container.querySelector('[data-note-line="b1"]')!);
    fireEvent.mouseDown(container.querySelector('[data-note-blocktype]')!);
    fireEvent.click(container.querySelector('[data-note-blocktype]')!);
    fireEvent.click(await screen.findByText('글머리 목록'));
    saveNow();

    await waitFor(() => {
      const block = saved('nb8')?.pages?.[0]?.blocks?.[0];
      expect(block?.kind).toBe('ul');
      expect(block?.items?.[0]?.runs?.[0]?.t).toBe('릴리즈 범위를 좁혔습니다.');
    });
  });

  it('페이지 제목과 태그를 고친다', async () => {
    localStorage.setItem('mindflow_doc_nb9', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb9&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-title]')).toBeTruthy());

    fireEvent.change(container.querySelector('[data-note-title]')!, { target: { value: '9월 4주 회의록' } });
    saveNow();
    await waitFor(() => expect(saved('nb9')?.pages?.[0]?.title).toBe('9월 4주 회의록'));

    fireEvent.click(container.querySelector('[data-note-tag-pick]')!);
    fireEvent.click(await screen.findByText('리서치'));
    saveNow();
    await waitFor(() => expect(saved('nb9')?.pages?.[0]?.tag).toBe('리서치'));
  });

  it('표지 색을 고르면 문서에 남는다(홈 카드가 읽는 그 값)', async () => {
    localStorage.setItem('mindflow_doc_nb10', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb10&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-cover-btn]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-cover-btn]')!);
    fireEvent.click(await screen.findByLabelText('숲'));
    saveNow();
    await waitFor(() => expect(saved('nb10')?.cover?.color).toBe('#2F7D57'));
    // 태그는 그대로 — 표지 색은 태그를 덮지 않는다(둘은 따로 고르는 값이다).
    expect(saved('nb10').cover.tag).toBe('회의록');
  });

  it('표에 행·열을 더한다', async () => {
    localStorage.setItem('mindflow_doc_nb11', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=nb11&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-table-row]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-note-table-row]')!);
    saveNow();
    await waitFor(() => expect(saved('nb11')?.pages?.[0]?.blocks?.[3]?.rows?.length).toBe(3));
    fireEvent.click(container.querySelector('[data-note-table-col]')!);
    saveNow();
    await waitFor(() => expect(saved('nb11')?.pages?.[0]?.blocks?.[3]?.rows?.[0]?.length).toBe(3));
  });

  it('보기 전용이면 툴바가 없고 본문을 고칠 수 없다', async () => {
    localStorage.setItem('mindflow_doc_nb12', JSON.stringify(NOTE));
    // 보기 전용은 URL이 아니라 **공유 행**이 정한다(`ReadOnly.interactions`와 같은 처방).
    localStorage.setItem('mf_doc_shares', JSON.stringify([{ documentId: 'nb12', email: 'me@example.com', role: 'view', createdAt: new Date().toISOString() }]));
    const { container } = renderEditor('/editor?map=nb12&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-editor]')).toBeTruthy());

    await waitFor(() => expect(container.querySelector('[data-note-toolbar]')).toBeNull());
    expect(container.querySelector('[data-note-new-page]')).toBeNull();
    expect(container.querySelector('[data-note-line="b1"]')?.getAttribute('contenteditable')).toBe('false');
  });
});

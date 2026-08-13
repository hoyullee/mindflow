// 칸반 — 세 번째 문서 종류(`kind: 'kanban'`). 캔버스가 아니라 열·카드 화면이고,
// 저장·공유·협업은 문서 기반이라 기존 경로를 그대로 탄다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const KANBAN = {
  v: 1,
  nodes: {},
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'white',
  kind: 'kanban',
  columns: [
    { id: 'c1', title: '할 일' },
    { id: 'c2', title: '진행 중' },
  ],
  cards: [
    { id: 'k1', col: 'c1', pos: 0, text: '첫 카드' },
    { id: 'k2', col: 'c1', pos: 1024, text: '둘째 카드' },
  ],
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

describe('칸반 에디터', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('열과 카드가 그려지고, 캔버스 UI(팬 레이어)는 없다', async () => {
    localStorage.setItem('mindflow_doc_kb1', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb1&title=x');

    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(2));
    expect(container.querySelectorAll('[data-kanban-card]')).toHaveLength(2);
    // 열 안 순서는 pos — 첫 카드가 위.
    const texts = Array.from(container.querySelectorAll('[data-kanban-card]')).map((e) => e.textContent);
    expect(texts).toEqual(['첫 카드', '둘째 카드']);
    // 카드 수 배지.
    expect(container.querySelector('[data-column-count="c1"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-column-count="c2"]')?.textContent).toBe('0');
    // 캔버스가 아니다 — 팬 레이어·미니맵·그리기 도구가 없다.
    expect(container.querySelector('[data-pan-layer]')).toBeNull();
    expect(container.querySelector('[data-zoom-cluster]')).toBeNull();
    // 캔버스 전용 메뉴도 뜨지 않는다.
    expect(screen.queryByRole('button', { name: '삽입' })).toBeNull();
    expect(screen.queryByRole('button', { name: '스타일' })).toBeNull();
  });

  it('카드를 추가하고 글을 써서 확정하면 저장된다', async () => {
    localStorage.setItem('mindflow_doc_kb2', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb2&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c2"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c2"]')!);
    // 만들자마자 편집이 열린다.
    const edit = await waitFor(() => {
      const el = container.querySelector('[data-kanban-card-edit]') as HTMLTextAreaElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(edit, { target: { value: '새 할 일' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      const d = saved('kb2');
      expect(d.kind).toBe('kanban');
      const inC2 = d.cards.filter((c: { col: string }) => c.col === 'c2');
      expect(inC2).toHaveLength(1);
      expect(inC2[0].text).toBe('새 할 일');
    });
  });

  it('빈 카드는 확정할 때 사라진다 — 실수로 만든 카드가 남지 않는다', async () => {
    localStorage.setItem('mindflow_doc_kb3', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb3&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-card="c1"]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-card="c1"]')!);
    const edit = await waitFor(() => container.querySelector('[data-kanban-card-edit]') as HTMLTextAreaElement);
    fireEvent.blur(edit);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(saved('kb3').cards).toHaveLength(2));
  });

  it('카드를 두 번 눌러 글을 고치고, 열 제목도 두 번 눌러 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_kb4', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb4&title=x');
    const card = await waitFor(() => container.querySelector('[data-kanban-card="k1"]') as HTMLElement);

    fireEvent.doubleClick(card);
    const edit = await waitFor(() => container.querySelector('[data-kanban-card-edit="k1"]') as HTMLTextAreaElement);
    fireEvent.change(edit, { target: { value: '고친 카드' } });
    fireEvent.keyDown(edit, { key: 'Enter' });

    fireEvent.doubleClick(container.querySelector('[data-column-title="c1"]')!);
    const titleEdit = await waitFor(() => container.querySelector('[data-column-title-edit]') as HTMLInputElement);
    fireEvent.change(titleEdit, { target: { value: '백로그' } });
    fireEvent.keyDown(titleEdit, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      const d = saved('kb4');
      expect(d.cards.find((c: { id: string }) => c.id === 'k1').text).toBe('고친 카드');
      expect(d.columns[0].title).toBe('백로그');
    });
  });

  it('열을 추가·삭제한다 — 열을 지우면 그 안의 카드도 함께(undo 한 번으로 복구)', async () => {
    localStorage.setItem('mindflow_doc_kb5', JSON.stringify(KANBAN));
    const { container } = renderEditor('/editor?map=kb5&title=x');
    await waitFor(() => expect(container.querySelector('[data-add-column]')).toBeTruthy());

    fireEvent.click(container.querySelector('[data-add-column]')!);
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(3));

    fireEvent.click(container.querySelector('[data-delete-column="c1"]')!);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb5');
      expect(d.columns.map((c: { id: string }) => c.id)).not.toContain('c1');
      expect(d.cards).toHaveLength(0); // c1의 카드 둘이 함께 사라졌다
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb5');
      expect(d.columns.map((c: { id: string }) => c.id)).toContain('c1');
      expect(d.cards).toHaveLength(2);
    });
  });

  it('tpl=kanban으로 열면 열 셋짜리 새 보드가 시드된다', async () => {
    const { container } = renderEditor('/editor?map=kb6&title=%EC%B9%B8%EB%B0%98&tpl=kanban&new=1');
    await waitFor(() => expect(container.querySelectorAll('[data-kanban-column]')).toHaveLength(3));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const d = saved('kb6');
      expect(d.kind).toBe('kanban');
      expect(d.columns.map((c: { title: string }) => c.title)).toEqual(['할 일', '진행 중', '완료']);
      expect(d.nodes).toEqual({});
    });
  });
});

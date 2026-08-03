import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

// 단축키 도움말(#23) — `?` 키(비편집) 또는 보기/☰ 메뉴로 열리는 모달.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '루트', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '자식', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('단축키 도움말', () => {
  it('? 키로 열리고 Esc로 닫힌다', () => {
    localStorage.setItem('mindflow_doc_hk1', JSON.stringify(DOC));
    renderEditor('/editor?map=hk1&title=x');
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: '키보드 단축키' });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('맵에서 검색');
    expect(dialog.textContent).toContain('Shift+Enter');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '키보드 단축키' })).toBeNull();
  });

  it('편집 중의 ?는 그냥 물음표다 (도움말이 열리지 않는다)', () => {
    localStorage.setItem('mindflow_doc_hk2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=hk2&title=x');
    fireEvent.doubleClick(container.querySelector('[data-node-id="c1"]')!);
    const editor = container.querySelector('.mf-richedit') as HTMLElement;
    expect(editor).toBeTruthy();
    fireEvent.keyDown(editor, { key: '?' });
    expect(screen.queryByRole('dialog', { name: '키보드 단축키' })).toBeNull();
  });

  it('보기 메뉴의 "단축키 도움말" 항목으로도 열린다', () => {
    localStorage.setItem('mindflow_doc_hk3', JSON.stringify(DOC));
    renderEditor('/editor?map=hk3&title=x');
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    fireEvent.click(screen.getByText('단축키 도움말'));
    expect(screen.getByRole('dialog', { name: '키보드 단축키' })).toBeTruthy();
  });
});

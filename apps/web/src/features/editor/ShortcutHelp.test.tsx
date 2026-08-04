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

// 피드백 보내기 — 화면 좌측 하단 상시 버튼(예전 제스처 범례 자리, 사용자 선정)
// 으로 열리는 수집 모달. 데스크톱 진입점은 이 버튼 하나, 모바일은 ☰ 메뉴 유지.
describe('피드백 보내기 (에디터 진입점)', () => {
  it('좌측 하단 상시 버튼으로 모달이 열리고 제출까지 흐른다 (보기 메뉴에는 없다)', async () => {
    localStorage.setItem('mindflow_doc_fb1', JSON.stringify(DOC));
    renderEditor('/editor?map=fb1&title=x');
    // 보기 메뉴에서는 빠졌다 — 메뉴를 열어도 '피드백 보내기'는 좌측 하단 상시
    // 버튼 하나뿐이다. (제스처 범례도 이 자리를 내주고 사라졌다.)
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(screen.getAllByText('피드백 보내기')).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/좌드래그/)).toBeNull();
    // 좌측 하단 상시 버튼으로 연다.
    fireEvent.click(screen.getByRole('button', { name: '피드백 보내기' }));
    const dialog = screen.getByRole('dialog', { name: '피드백 보내기' });
    expect(dialog).toBeTruthy();
    // 로컬(데모) 백엔드 — 제출하면 localStorage `mf_feedback`에 쌓인다.
    fireEvent.change(screen.getByLabelText('피드백 내용'), { target: { value: '에디터에서 보냄' } });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('전달됐어요, 고마워요!')).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem('mf_feedback')!) as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({ page: 'editor', message: '에디터에서 보냄' });
  });
});

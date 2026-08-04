import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

// 맵 안 텍스트 검색(#20) — 툴바 🔍 버튼/Ctrl+F로 열리는 검색 바.
// 노드(트리 순서)·메모를 대소문자 무시 부분 일치로 찾고, 일치 전부에 앰버 링,
// Enter로 이동한 현재 항목은 실제 선택 + 뷰포트 중앙 이동.

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '프로젝트 계획', emoji: '', parent: null, children: ['a', 'b'], collapsed: false, color: null, x: 0, y: 0 },
    a: { id: 'a', text: '일정 검토', emoji: '', parent: 'root', children: ['a1'], collapsed: false, color: null, x: 0, y: 0 },
    a1: { id: 'a1', text: '검토 회의', emoji: '', parent: 'a', children: [], collapsed: false, color: null, x: 0, y: 0 },
    b: { id: 'b', text: '예산', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [{ id: 'f1', text: '검토 메모입니다', x: 100, y: 100, w: 180 }],
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

function openSearch(container: HTMLElement): HTMLInputElement {
  fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
  const input = container.querySelector('input[aria-label="맵에서 검색"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  return input;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('맵 안 검색', () => {
  it('Ctrl+F로 열리고 Esc로 닫힌다 (툴바 버튼도 있다)', () => {
    localStorage.setItem('mindflow_doc_sr1', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=sr1&title=x');
    expect(container.querySelector('button[aria-label="맵에서 검색"]')).toBeTruthy();
    const input = openSearch(container);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('input[aria-label="맵에서 검색"]')).toBeNull();
  });

  it('↑/↓ 이동 버튼은 좁은 폭으로 나란히 붙는다 (간격이 벌어져 보이던 제보)', () => {
    localStorage.setItem('mindflow_doc_srw', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=srw&title=x');
    openSearch(container);
    const prev = container.querySelector('button[aria-label="이전 (Shift+Enter)"]') as HTMLElement;
    const next = container.querySelector('button[aria-label="다음 (Enter)"]') as HTMLElement;
    const close = container.querySelector('button[aria-label="닫기 (Esc)"]') as HTMLElement;
    // 화살표 쌍은 닫기 버튼보다 좁다 — 글리프 사이 여백이 좁혀졌다는 구조 계약.
    expect(parseFloat(prev.style.width)).toBeLessThan(parseFloat(close.style.width));
    expect(prev.style.width).toBe(next.style.width);
    // 높이(클릭 타깃)는 그대로.
    expect(prev.style.height).toBe(close.style.height);
  });

  it('일치 개수를 세고, 일치 대상 전부에 앰버 링이 붙는다 (노드+메모)', () => {
    localStorage.setItem('mindflow_doc_sr2', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=sr2&title=x');
    const input = openSearch(container);
    fireEvent.change(input, { target: { value: '검토' } });
    // a(일정 검토), a1(검토 회의), f1(검토 메모입니다) = 3건
    expect(container.textContent).toContain('1/3');
    const ringed = ['a', 'a1'].map((id) => container.querySelector(`[data-node-id="${id}"]`) as HTMLElement);
    ringed.forEach((el) => expect(el.style.boxShadow).toContain('224,178,60')); // #e0b23c
    const memo = container.querySelector('[data-float-id="f1"]') as HTMLElement;
    expect(memo.style.boxShadow).toContain('224,178,60');
    // 일치하지 않는 노드는 링 없음
    const other = container.querySelector('[data-node-id="b"]') as HTMLElement;
    expect(other.style.boxShadow || '').not.toContain('224,178,60');
  });

  it('Enter가 트리 순서로 순환하며 현재 항목을 실제 선택한다', () => {
    localStorage.setItem('mindflow_doc_sr3', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=sr3&title=x');
    const input = openSearch(container);
    fireEvent.change(input, { target: { value: '검토' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 첫 Enter = **첫 번째 일치**(a, 트리 순서)로 — 다음으로 건너뛰지 않는다
    expect(container.textContent).toContain('1/3');
    const a = container.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(a.style.boxShadow).toContain('240,102,63'); // th.accent 선택 링
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.textContent).toContain('2/3');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.textContent).toContain('3/3');
    fireEvent.keyDown(input, { key: 'Enter' }); // 순환
    expect(container.textContent).toContain('1/3');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); // 역방향
    expect(container.textContent).toContain('3/3');
  });

  it('일치가 없으면 "없음", 닫으면 링이 사라진다', () => {
    localStorage.setItem('mindflow_doc_sr4', JSON.stringify(DOC));
    const { container } = renderEditor('/editor?map=sr4&title=x');
    const input = openSearch(container);
    fireEvent.change(input, { target: { value: '없는단어' } });
    expect(container.textContent).toContain('없음');
    fireEvent.change(input, { target: { value: '검토' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    const a = container.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(a.style.boxShadow || '').not.toContain('224,178,60');
  });

  it('접힌 가지 안의 노드는 결과에서 빠진다 (화면에 없는 것으로 이동하지 않게)', () => {
    localStorage.setItem('mindflow_doc_sr5', JSON.stringify({ ...DOC, nodes: { ...DOC.nodes, a: { ...DOC.nodes.a, collapsed: true } } }));
    const { container } = renderEditor('/editor?map=sr5&title=x');
    const input = openSearch(container);
    fireEvent.change(input, { target: { value: '검토' } });
    // a는 보이므로 일치, a1은 접힌 가지 안 → 제외, f1 메모 일치 = 2건
    expect(container.textContent).toContain('1/2');
  });
});

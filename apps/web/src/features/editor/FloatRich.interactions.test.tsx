import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { parseDoc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { domToRuns, setLinearSelection } from './richtextDom';

// 메모(플로트) 서식화 — 도형(노드)에 얹은 rich 모델·마크다운·하이퍼링크를
// 메모에 이식(사용자 계획). 편집 키 규칙도 도형과 동일: Enter=확정,
// Shift+Enter=줄바꿈. 편집 박스는 노드와 같은 contentEditable(`.mf-richedit`)
// 이고 서식 툴바(applyPartial)를 그대로 공유한다.

const FLOAT = { id: 'f1', text: '메모 본문', x: 100, y: 100, w: 200 };

function docWith(floatPatch: object = {}) {
  return {
    v: 1,
    nodes: {
      root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
    },
    floats: [{ ...FLOAT, ...floatPatch }],
    lines: [],
    zones: [],
    layoutMode: 'right',
    themeKey: 'coral',
  };
}

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function floatCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-float-id="f1"]');
  if (!card) throw new Error('float card not found');
  return card as HTMLElement;
}

function startEditFloat(container: HTMLElement): HTMLDivElement {
  fireEvent.doubleClick(floatCard(container));
  const editor = floatCard(container).querySelector('.mf-richedit') as HTMLDivElement;
  expect(editor).toBeTruthy();
  return editor;
}

function readSavedFloat(mapId: string) {
  const raw = localStorage.getItem(`mindflow_doc_${mapId}`);
  if (!raw) throw new Error('not saved yet');
  const parsed = parseDoc(JSON.parse(raw));
  if (!parsed) throw new Error('unparseable doc');
  return parsed.floats[0]!;
}

const save = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('메모 커밋 렌더 — rich 서식', () => {
  it('굵게·기울임·취소선·색 런이 그대로 그려진다', () => {
    localStorage.setItem(
      'mindflow_doc_fr1',
      JSON.stringify(
        docWith({
          rich: [
            { t: '굵게', b: true, c: null },
            { t: '기울임', b: false, c: null, i: true },
            { t: '취소', b: false, c: null, s: true },
            { t: '빨강', b: false, c: '#d92626' },
          ],
          text: '굵게기울임취소빨강',
        }),
      ),
    );
    const { container } = renderEditor('/editor?map=fr1&title=x');
    const card = floatCard(container);
    const spans = Array.from(card.querySelectorAll('span'));
    expect(spans.some((s) => s.style.fontWeight === '800' && s.textContent === '굵게')).toBe(true);
    expect(spans.some((s) => s.style.fontStyle === 'italic' && s.textContent === '기울임')).toBe(true);
    expect(spans.some((s) => s.style.textDecoration === 'line-through' && s.textContent === '취소')).toBe(true);
    expect(spans.some((s) => s.style.color === 'rgb(217, 38, 38)' && s.textContent === '빨강')).toBe(true);
  });

  it('링크 런은 파란 글자(.mf-link) + data-href로 그려지고 카드가 --mf-link를 내려 준다', () => {
    localStorage.setItem('mindflow_doc_fr2', JSON.stringify(docWith({ rich: [{ t: '문서', b: false, c: null, href: 'https://example.com/' }, { t: ' 참고', b: false, c: null }], text: '문서 참고' })));
    const { container } = renderEditor('/editor?map=fr2&title=x');
    const card = floatCard(container);
    const link = card.querySelector('[data-href]') as HTMLElement;
    expect(link).toBeTruthy();
    expect(link.className).toContain('mf-link');
    expect(card.style.getPropertyValue('--mf-link')).not.toBe('');
  });

  it('rich + 리스트가 함께 있어도 마커/내용 행으로 그려진다', () => {
    localStorage.setItem('mindflow_doc_fr3', JSON.stringify(docWith({ rich: [{ t: '- 굵은', b: true, c: null }, { t: ' 항목', b: false, c: null }], text: '- 굵은 항목' })));
    const { container } = renderEditor('/editor?map=fr3&title=x');
    const card = floatCard(container);
    expect(card.textContent).toContain('• 굵은 항목');
    expect(Array.from(card.querySelectorAll('span')).some((s) => s.style.fontWeight === '800')).toBe(true);
  });
});

describe('메모 편집 — 도형과 같은 키 규칙과 서식', () => {
  it('Enter가 편집을 확정하고 Shift+Enter가 줄을 바꾼다', async () => {
    localStorage.setItem('mindflow_doc_fe1', JSON.stringify(docWith()));
    const { container } = renderEditor('/editor?map=fe1&title=x');
    const editor = startEditFloat(container);
    setLinearSelection(editor, 5, 5);
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(domToRuns(editor, true).text).toBe('메모 본문\n');
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(floatCard(container).querySelector('.mf-richedit')).toBeNull(); // 확정 = 편집 종료
    save();
    await waitFor(() => {
      expect(readSavedFloat('fe1').text).toBe('메모 본문');
    });
  });

  it('마크다운 단축이 커밋 시 서식으로 바뀐다 (**굵게**)', async () => {
    localStorage.setItem('mindflow_doc_fe2', JSON.stringify(docWith({ text: '**굵은** 메모' })));
    const { container } = renderEditor('/editor?map=fe2&title=x');
    const editor = startEditFloat(container);
    fireEvent.keyDown(editor, { key: 'Enter' });
    save();
    await waitFor(() => {
      const f = readSavedFloat('fe2');
      expect(f.text).toBe('굵은 메모');
      expect(f.rich?.find((r) => r.b)?.t).toBe('굵은');
    });
  });

  it('타이핑한 URL이 커밋 시 자동 링크가 된다', async () => {
    localStorage.setItem('mindflow_doc_fe3', JSON.stringify(docWith({ text: '참고 https://example.com/a 끝' })));
    const { container } = renderEditor('/editor?map=fe3&title=x');
    const editor = startEditFloat(container);
    fireEvent.keyDown(editor, { key: 'Enter' });
    save();
    await waitFor(() => {
      const f = readSavedFloat('fe3');
      expect(f.rich?.find((r) => r.href)?.href).toBe('https://example.com/a');
    });
  });

  it('Ctrl+B가 선택 없이도 전체에 굵게를 적용한다 (툴바 공유 경로)', async () => {
    localStorage.setItem('mindflow_doc_fe4', JSON.stringify(docWith()));
    const { container } = renderEditor('/editor?map=fe4&title=x');
    const editor = startEditFloat(container);
    setLinearSelection(editor, 1, 1); // 선택 해제(캐럿만)
    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'Enter' });
    save();
    await waitFor(() => {
      const f = readSavedFloat('fe4');
      expect(f.rich?.[0]?.b).toBe(true);
      expect(f.rich?.[0]?.t).toBe('메모 본문');
    });
  });

  it('편집을 시작하면 서식 툴바가 뜬다 (노드와 동일한 상시 노출)', () => {
    localStorage.setItem('mindflow_doc_fe5', JSON.stringify(docWith()));
    const { container } = renderEditor('/editor?map=fe5&title=x');
    startEditFloat(container);
    expect(container.querySelector('.mf-tctx')).toBeTruthy();
  });

  it('편집 중 Ctrl/⌘+클릭으로 링크를 연다', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.setItem('mindflow_doc_fe6', JSON.stringify(docWith({ rich: [{ t: '문서', b: false, c: null, href: 'https://example.com/' }, { t: ' 참고', b: false, c: null }], text: '문서 참고' })));
    const { container } = renderEditor('/editor?map=fe6&title=x');
    const editor = startEditFloat(container);
    const link = editor.querySelector('[data-href]') as HTMLElement;
    expect(link).toBeTruthy();
    fireEvent.click(link, { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('Escape는 버리고 닫는다', async () => {
    localStorage.setItem('mindflow_doc_fe7', JSON.stringify(docWith()));
    const { container } = renderEditor('/editor?map=fe7&title=x');
    const editor = startEditFloat(container);
    editor.appendChild(document.createTextNode('추가'));
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(floatCard(container).querySelector('.mf-richedit')).toBeNull();
    save();
    await waitFor(() => {
      expect(readSavedFloat('fe7').text).toBe('메모 본문'); // 편집 전 그대로
    });
  });
});

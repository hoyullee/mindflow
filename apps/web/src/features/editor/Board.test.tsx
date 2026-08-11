// 화이트보드(M2) — 에디터 board 모드. board = `nodes: {}`인 Doc이고 에디터는
// `controller.isBoard`로 트리 관련 UI를 감춘다("할 수 없는 것은 보이지 않는다").
// 공유·협업·저장·undo는 문서(Doc) 기반이라 기존 경로 그대로다.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';

const BOARD = {
  v: 1,
  nodes: {},
  floats: [{ id: 'bf1', x: 40, y: 60, w: 180, text: '아이디어 하나' }],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
  kind: 'board',
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

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
});
afterEach(() => cleanup());

describe('화이트보드 에디터', () => {
  it('tpl=board로 열면 트리 없는 빈 보드가 시드되고, 메모를 추가·저장할 수 있다', async () => {
    const { container } = renderEditor('/editor?map=b1&title=%EB%B3%B4%EB%93%9C&tpl=board&new=1');
    // 커튼이 걷히고(빈 보드도 첫 센터링이 돈다) 캔버스가 뜬다 — 노드는 0개.
    await waitFor(() => expect(screen.getByRole('button', { name: '삽입' })).toBeTruthy());
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(0);

    // 삽입 → 메모 추가 → 플로트가 생기고 저장본이 board로 남는다.
    fireEvent.click(screen.getByRole('button', { name: '삽입' }));
    fireEvent.click(await screen.findByRole('button', { name: '메모 추가' }));
    await waitFor(() => expect(container.querySelector('[data-float-id]')).toBeTruthy());
    // 자동저장 디바운스(0.9s)를 기다리지 않고 지금 저장한다 — 검증 대상은 저장
    // 내용이지 디바운스가 아니다(오프라인 테스트와 같은 처방).
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b1') || 'null');
      expect(saved?.kind).toBe('board');
      expect(saved?.floats).toHaveLength(1);
      expect(Object.keys(saved?.nodes ?? { x: 1 })).toHaveLength(0);
    });
  });

  it('board에서는 주제/선/영역·레이아웃·아웃라인 UI가 없다 — 메모·이미지만', async () => {
    localStorage.setItem('mindflow_doc_b2', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b2&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());

    // 삽입 메뉴: 메모·이미지만.
    fireEvent.click(screen.getByRole('button', { name: '삽입' }));
    await screen.findByRole('button', { name: '메모 추가' });
    expect(screen.getByRole('button', { name: '이미지 추가' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '주제 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '선 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '영역 추가' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // 스타일 메뉴: 레이아웃/연결선 구획이 없고 테마는 남는다.
    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('테마')).toBeTruthy());
    expect(screen.queryByText('레이아웃')).toBeNull();
    expect(screen.queryByText('연결선')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // 보기 메뉴: 아웃라인(트리 목차)이 없다.
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    await screen.findByRole('button', { name: '맵' });
    expect(screen.queryByRole('button', { name: '아웃라인' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    // 배경 우클릭: 메모/이미지만.
    fireEvent.contextMenu(getViewport(container), { clientX: 300, clientY: 300 });
    await screen.findByText('메모 추가');
    expect(screen.getByText('이미지 추가')).toBeTruthy();
    expect(screen.queryByText('주제 추가')).toBeNull();
    expect(screen.queryByText('선 추가')).toBeNull();
    expect(screen.queryByText('영역 추가')).toBeNull();
  });

  it('board 제목은 메타가 정본 — 독칩에서 고치면 저장 메타에 반영된다(루트가 없어도)', async () => {
    localStorage.setItem('mindflow_doc_b3', JSON.stringify(BOARD));
    const { container } = renderEditor('/editor?map=b3&title=%EC%98%9B%20%EC%A0%9C%EB%AA%A9');
    await waitFor(() => expect(within(getViewport(container)).getByText('아이디어 하나')).toBeTruthy());
    // 표시 제목 = URL 메타.
    const title = await screen.findByText('옛 제목');
    fireEvent.doubleClick(title);
    const input = (await screen.findByDisplayValue('옛 제목')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '아이디어 보드' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const meta = JSON.parse(localStorage.getItem('mindflow_doc_meta_b3') || 'null');
      expect(meta?.title).toBe('아이디어 보드');
    });
    expect(screen.getByText('아이디어 보드')).toBeTruthy();
  });

  it('이미지 캡션 — 이미지 아래에 그려지고, 속성 패널에서 고치면 문서에 커밋된다', async () => {
    localStorage.setItem(
      'mindflow_doc_b4',
      JSON.stringify({ ...BOARD, floats: [{ id: 'img1', x: 100, y: 80, w: 200, h: 150, text: '', img: 'data:image/png;base64,iVBORw0KGgo=', caption: '회의 사진' }] }),
    );
    const { container } = renderEditor('/editor?map=b4&title=x');
    const floatEl = await waitFor(() => {
      const el = container.querySelector('[data-float-id="img1"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 캡션이 이미지 아래(박스 밖)에 그려진다.
    expect(floatEl.querySelector('[data-float-caption]')?.textContent).toBe('회의 사진');

    // 선택 → 속성 패널의 제목 입력 → blur 커밋 → 문서 갱신 + 렌더 갱신.
    fireEvent.pointerDown(floatEl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(floatEl, { button: 0, clientX: 10, clientY: 10 });
    const capInput = (await screen.findByLabelText('이미지 제목')) as HTMLInputElement;
    expect(capInput.value).toBe('회의 사진');
    fireEvent.change(capInput, { target: { value: '킥오프 화이트보드' } });
    fireEvent.blur(capInput);
    await waitFor(() => expect(floatEl.querySelector('[data-float-caption]')?.textContent).toBe('킥오프 화이트보드'));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true }); // 자동저장 디바운스 우회
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mindflow_doc_b4') || 'null');
      expect(saved?.floats?.[0]?.caption).toBe('킥오프 화이트보드');
    });
  });

  it('맵(무회귀): 삽입 메뉴 5종·스타일 레이아웃·보기 아웃라인이 그대로다', async () => {
    localStorage.setItem(
      'mindflow_doc_m1',
      JSON.stringify({ v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral' }),
    );
    const { container } = renderEditor('/editor?map=m1&title=x');
    await waitFor(() => expect(within(getViewport(container)).getByText('루트')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '삽입' }));
    await screen.findByRole('button', { name: '주제 추가' });
    expect(screen.getByRole('button', { name: '선 추가' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '영역 추가' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '스타일' }));
    await waitFor(() => expect(screen.getByText('레이아웃')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    await screen.findByRole('button', { name: '아웃라인' });
  });
});

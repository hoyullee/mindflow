import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { listVersions } from './versionHistory';

// 버전 기록 모달(#21) — 편집 메뉴에서 열고, 스냅샷을 골라 복원한다(undo 가능).

const DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '현재 상태', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'right',
  themeKey: 'coral',
};

function snapshotBody(text: string): string {
  return JSON.stringify({ ...DOC, nodes: { root: { ...DOC.nodes.root, text } } });
}

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

describe('버전 기록 모달', () => {
  it('편집 메뉴의 "버전 기록"으로 열리고, 이 기기의 스냅샷을 최신 먼저 나열한다', () => {
    localStorage.setItem('mindflow_doc_vh1', JSON.stringify(DOC));
    localStorage.setItem(
      'mindflow_hist_vh1',
      JSON.stringify([
        { at: 1_700_000_000_000, body: snapshotBody('옛 판'), nodes: 1 },
        { at: 1_700_000_500_000, body: snapshotBody('요즘 판'), nodes: 1 },
      ]),
    );
    renderEditor('/editor?map=vh1&title=x');
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(screen.getByText('버전 기록'));
    const dialog = screen.getByRole('dialog', { name: '버전 기록' });
    expect(dialog).toBeTruthy();
    const items = dialog.querySelectorAll('div[style*="overflow-y"] button, div[style*="overflowY"] button');
    expect(dialog.textContent).toContain('주제 1개');
    expect(items.length).toBeGreaterThanOrEqual(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '버전 기록' })).toBeNull();
  });

  it('기록이 없으면 빈 안내를 보여 준다', () => {
    localStorage.setItem('mindflow_doc_vh2', JSON.stringify(DOC));
    renderEditor('/editor?map=vh2&title=x');
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(screen.getByText('버전 기록'));
    expect(screen.getByRole('dialog', { name: '버전 기록' }).textContent).toContain('아직 기록이 없어요');
  });

  it('복원하면 문서가 그 판으로 바뀌고(undo 가능), 복원 직전 상태도 기록에 남는다', () => {
    localStorage.setItem('mindflow_doc_vh3', JSON.stringify(DOC));
    localStorage.setItem('mindflow_hist_vh3', JSON.stringify([{ at: 1_700_000_000_000, body: snapshotBody('스냅샷 판'), nodes: 1 }]));
    const { container } = renderEditor('/editor?map=vh3&title=x');
    expect(container.querySelector('[data-node-id="root"]')!.textContent).toContain('현재 상태');

    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(screen.getByText('버전 기록'));
    fireEvent.click(screen.getByText('이 버전으로 복원'));

    // 모달이 닫히고 본문이 스냅샷으로 교체됐다
    expect(screen.queryByRole('dialog', { name: '버전 기록' })).toBeNull();
    expect(container.querySelector('[data-node-id="root"]')!.textContent).toContain('스냅샷 판');
    // 복원 직전의 "현재 상태"가 강제 스냅샷으로 남았다(돌아올 길)
    const entries = listVersions('vh3');
    expect(entries.length).toBe(2);
    expect(entries[0]!.at).toBeGreaterThan(1_700_000_000_000);

    // undo 한 번이면 복원 전으로 돌아간다
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(container.querySelector('[data-node-id="root"]')!.textContent).toContain('현재 상태');
  });

  // 옛 판의 첨부 이미지 — 본문에는 참조(`mfimg:…`)만 있으므로 서명 URL로 바꿔야
  // 보인다. 예전에는 미리보기에 URL을 넘기지 않아 사진 자리가 늘 회색이었다.
  // 여기서는 이 기기의 URL 캐시가 채워진 경우(홈에서 이미 본 사진 = 왕복 0회)를 쓴다.
  it('옛 판의 첨부 이미지를 미리보기에 그린다', async () => {
    const REF = 'mfimg:vh4/pic.webp';
    const URL_ = 'https://signed.example/vh4-pic.webp?token=t';
    localStorage.setItem('mf_img_urls', JSON.stringify({ [REF]: { url: URL_, at: Date.now() } }));
    localStorage.setItem('mindflow_doc_vh4', JSON.stringify(DOC));
    const body = JSON.stringify({ ...DOC, floats: [{ id: 'f1', x: 40, y: 40, w: 120, h: 90, img: REF, text: '' }] });
    localStorage.setItem('mindflow_hist_vh4', JSON.stringify([{ at: 1_700_000_000_000, body, nodes: 1 }]));

    renderEditor('/editor?map=vh4&title=x');
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(screen.getByText('버전 기록'));
    const dialog = screen.getByRole('dialog', { name: '버전 기록' });
    await waitFor(() => {
      const img = dialog.querySelector('image');
      expect(img?.getAttribute('href')).toBe(URL_);
    });
  });
});

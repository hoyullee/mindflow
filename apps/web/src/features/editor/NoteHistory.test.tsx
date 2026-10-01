// 공책 「기록」 패널(기록 패널 스펙) — 저장마다 항목이 남고, 눌러 미리 보고, 되돌리고, 취소한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      ],
    },
  ],
  cover: { tag: '회의록' },
};

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
}

const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');
const hist = (id: string) => JSON.parse(localStorage.getItem(`mindflow_nhist_${id}`) || '[]') as { summary: string; kind: string }[];

function type(el: Element, text: string): void {
  const box = el as HTMLElement;
  box.textContent = text;
  box.focus();
  fireEvent.input(el);
  fireEvent.blur(el);
}

function saveNow(): void {
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

configure({ asyncUtilTimeout: 6000 });

describe('공책 — 기록 패널', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('저장마다 항목이 남고 · 미리보기 띠 · 이 시점으로 되돌리기 · 토스트의 취소', async () => {
    localStorage.setItem('mindflow_doc_h1', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=h1&title=x');
    const b1 = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;

    // ① 첫 문단을 고치고 저장 → 「본문 첫 문단 문구 수정」
    type(b1, '릴리즈 범위를 넓혔습니다.');
    saveNow();
    await waitFor(() => expect(hist('h1').map((e) => e.summary)).toEqual(['본문 첫 문단 문구 수정']));

    // ② 다른 블록(소제목)을 고치면 **새 항목**
    type(container.querySelector('[data-note-line="b2"]')!, '정한 것');
    saveNow();
    await waitFor(() => expect(hist('h1')).toHaveLength(2));

    // 기록 탭 → 400px 패널 · 최신이 위 · 첫 항목만 「지금 버전」
    fireEvent.click(screen.getByRole('button', { name: '기록' }));
    const panel = (await waitFor(() => container.querySelector('[data-note-history]'))) as HTMLElement;
    expect(panel.style.flex).toContain('400px');
    await waitFor(() => expect(panel.querySelectorAll('[data-hist-entry]')).toHaveLength(2));
    const rows = [...panel.querySelectorAll<HTMLElement>('[data-hist-entry]')];
    expect(rows[0]!.querySelector('[data-hist-summary]')?.textContent).toContain("'정한 것' 소제목 문구 수정");
    expect(rows[0]!.querySelector('[data-hist-now]')).toBeTruthy();
    expect(rows[1]!.querySelector('[data-hist-now]')).toBeNull();
    // 문구 diff — 지운 글/추가한 글
    expect(rows[1]!.querySelector('[data-hist-diff="del"]')?.textContent).toBe('좁');
    expect(rows[1]!.querySelector('[data-hist-diff="ins"]')?.textContent).toBe('넓');
    expect(panel.querySelector('[data-hist-group="오늘"]')).toBeTruthy();

    // 항목을 누르면 그때 모습 — 읽기 전용 미리보기 띠
    fireEvent.click(rows[1]!);
    const band = (await waitFor(() => container.querySelector('[data-hist-band]'))) as HTMLElement;
    expect(band.textContent).toContain('버전을 보는 중');
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')?.textContent).toBe('결정한 것'));
    expect(container.querySelector('[data-note-line="b1"]')?.getAttribute('contenteditable')).not.toBe('true');
    expect(panel.querySelector('[data-hist-picked]')).toBeTruthy();

    // Esc로 미리보기를 끝내면 지금 판으로
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-hist-band]')).toBeNull());
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')?.textContent).toBe('정한 것'));

    // 이 시점으로 되돌리기 — 확인 없이 곧바로 · 토스트 · 새 restore 항목 · 사이 항목은 그대로
    fireEvent.click(within(rows[1]!).getByRole('button', { name: '이 시점으로 되돌리기' }));
    await waitFor(() => expect(container.querySelector('[data-hist-toast]')?.textContent).toContain('시점으로 되돌렸어요'));
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')?.textContent).toBe('결정한 것'));
    saveNow();
    await waitFor(() => expect(hist('h1').map((e) => e.kind)).toEqual(['edit', 'edit', 'restore']));
    await waitFor(() => expect(panel.querySelectorAll('[data-hist-entry]')).toHaveLength(3));
    expect(panel.querySelector('[data-hist-entry] [data-hist-summary]')?.textContent).toMatch(/시점으로 되돌림$/);

    // 토스트의 취소 → 되돌리기 전으로(이것도 기록에 남는다)
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')?.textContent).toBe('정한 것'));
    saveNow();
    await waitFor(() => expect(saved('h1').pages[0].blocks[1].runs[0].t).toBe('정한 것'));
    await waitFor(() => expect(hist('h1').map((e) => e.summary).at(-1)).toBe('되돌리기를 취소함'));
  });

  it('기록을 열면 일정·댓글은 닫힌다 — 한 번에 하나', async () => {
    localStorage.setItem('mindflow_doc_h2', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=h2&title=x');
    await waitFor(() => container.querySelector('[data-note-line="b1"]'));
    fireEvent.click(screen.getByRole('button', { name: '일정' }));
    await waitFor(() => expect(container.querySelector('[data-note-agenda]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '기록' }));
    await waitFor(() => expect(container.querySelector('[data-note-history]')).toBeTruthy());
    expect(container.querySelector('[data-note-agenda]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '일정' }));
    await waitFor(() => expect(container.querySelector('[data-note-history]')).toBeNull());
  });

  it('미리보기 띠의 「이 버전으로 되돌리기」도 같은 길 · 지금 버전에는 띠에 되돌리기가 없다', async () => {
    localStorage.setItem('mindflow_doc_h3', JSON.stringify(NOTE));
    const { container } = renderEditor('/editor?map=h3&title=x');
    const b1 = (await waitFor(() => container.querySelector('[data-note-line="b1"]'))) as HTMLElement;
    type(b1, '하나');
    saveNow();
    await waitFor(() => expect(hist('h3')).toHaveLength(1));
    type(container.querySelector('[data-note-line="b2"]')!, '둘');
    saveNow();
    await waitFor(() => expect(hist('h3')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '기록' }));
    const panel = (await waitFor(() => container.querySelector('[data-note-history]'))) as HTMLElement;
    await waitFor(() => expect(panel.querySelectorAll('[data-hist-entry]')).toHaveLength(2));
    const rows = [...panel.querySelectorAll<HTMLElement>('[data-hist-entry]')];

    fireEvent.click(rows[0]!); // 지금 버전
    await waitFor(() => expect(container.querySelector('[data-hist-band]')).toBeTruthy());
    expect(container.querySelector('[data-hist-band-restore]')).toBeNull();

    fireEvent.click(rows[1]!);
    const restore = (await waitFor(() => container.querySelector('[data-hist-band-restore]'))) as HTMLElement;
    fireEvent.click(restore);
    await waitFor(() => expect(container.querySelector('[data-hist-toast]')).toBeTruthy());
    expect(container.querySelector('[data-hist-band]')).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-note-line="b2"]')?.textContent).toBe('결정한 것'));
  });
});

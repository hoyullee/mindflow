// 공책 본문의 **동영상 블록** — 주소를 붙이면 썸네일 판, 누르면 그 자리에서 재생.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const base = { v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' };
const noteWith = (blocks: unknown[]) => ({ ...base, kind: 'note', pages: [{ id: 'p1', title: '회의록', blocks }] });
const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');
const saveNow = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });
const paste = (el: Element, text: string) =>
  fireEvent.paste(el, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : ''), types: ['text/plain'] } });

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('공책 본문 · 동영상 블록', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('빈 문단에 YouTube 주소를 붙이면 썸네일 판 — iframe은 누른 뒤에야 붙는다', async () => {
    localStorage.setItem('mindflow_doc_nv1', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [] }])));
    const { container } = renderEditor('/editor?map=nv1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    line.focus();
    paste(line, 'https://youtu.be/dQw4w9WgXcQ');

    await waitFor(() => expect(container.querySelector('[data-video-play]')).toBeTruthy());
    expect(container.querySelector('[data-video-block] img')?.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(container.querySelector('[data-video-play]')!);
    const frame = container.querySelector('iframe[data-video-player]');
    expect(frame?.getAttribute('src')).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

    saveNow();
    await waitFor(() => expect(saved('nv1')?.pages?.[0]?.blocks?.[0]).toMatchObject({ id: 'b1', kind: 'video', src: 'https://youtu.be/dQw4w9WgXcQ' }));
  });

  it('쓰던 문장에 붙인 주소는 동영상이 되지 않는다(링크로 남는다)', async () => {
    localStorage.setItem('mindflow_doc_nv2', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [{ t: '참고: ', b: false, c: null }] }])));
    const { container } = renderEditor('/editor?map=nv2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    line.focus();
    paste(line, 'https://youtu.be/dQw4w9WgXcQ');
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('[data-video-block]')).toBeNull();
  });

  it('파일 주소는 <video>로 바로, 빈 블록은 주소 칸 — 동영상이 아닌 주소는 그 자리에서 알린다', async () => {
    localStorage.setItem(
      'mindflow_doc_nv3',
      JSON.stringify(noteWith([{ id: 'v1', kind: 'video', src: 'https://cdn.example.com/demo.mp4' }, { id: 'v2', kind: 'video' }])),
    );
    const { container } = renderEditor('/editor?map=nv3&title=x');
    await waitFor(() => expect(container.querySelector('video[data-video-player]')).toBeTruthy());
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/demo.mp4');

    const input = container.querySelector('[data-video-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/page' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('[data-video-block="v2"]')?.textContent).toContain('동영상으로 열 수 없어요');

    fireEvent.change(input, { target: { value: 'https://vimeo.com/76979871' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-video-block="v2"][data-video-provider="vimeo"]')).toBeTruthy());
    saveNow();
    await waitFor(() => expect(saved('nv3')?.pages?.[0]?.blocks?.[1]).toMatchObject({ kind: 'video', src: 'https://vimeo.com/76979871' }));
  });
});

// 공책 본문의 **첨부 파일 블록**(0049) — 붙여넣기·끌어 놓기로 넣고, 올리기가 끝나면 `fileId`가 붙는다.
// 서버 없이 도는 로컬 판(`LocalFileStore`)으로 본다 — R2와 주고받는 모양은 `supabaseFileStore.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { mockMatchMedia } from '../../test/matchMedia';

const base = { v: 1, nodes: {}, floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'white' };
const noteWith = (blocks: unknown[]) => ({ ...base, kind: 'note', pages: [{ id: 'p1', title: '회의록', blocks }] });
const saved = (id: string) => JSON.parse(localStorage.getItem(`mindflow_doc_${id}`) || 'null');
const saveNow = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pdf = (bytes = 'hello world') => new File([bytes], '분기 보고서.pdf', { type: 'application/pdf' });

describe('공책 본문 · 첨부 파일', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@example.com' } }));
  });
  afterEach(cleanup);

  it('빈 문단에 파일을 붙여넣으면 그 자리가 파일 카드 — 올리기가 끝나면 fileId가 저장된다', async () => {
    localStorage.setItem('mindflow_doc_nf1', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [] }])));
    const { container } = renderEditor('/editor?map=nf1&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    line.focus();
    const file = pdf();
    fireEvent.paste(line, { clipboardData: { getData: () => '', types: ['Files'], items: [], files: [file] } });

    await waitFor(() => expect(container.querySelector('[data-file-block="b1"][data-file-state="ready"]')).toBeTruthy());
    const card = container.querySelector('[data-file-block="b1"]')!;
    expect(card.querySelector('[data-file-name]')?.textContent).toBe('분기 보고서.pdf');
    expect(card.querySelector('[data-file-sub]')?.textContent).toBe('11B · PDF 문서');
    expect(card.querySelector('[data-file-download]')).toBeTruthy();

    saveNow();
    await waitFor(() => expect(saved('nf1')?.pages?.[0]?.blocks?.[0]).toMatchObject({ id: 'b1', kind: 'file', fileName: '분기 보고서.pdf', fileSize: 11, fileMime: 'application/pdf' }));
    expect(saved('nf1').pages[0].blocks[0].fileId).toMatch(/^local-/);
  });

  it('바탕화면에서 끌어 놓으면 놓은 블록 다음에 — 여러 개면 순서대로', async () => {
    localStorage.setItem('mindflow_doc_nf2', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [{ t: '첨부', b: false, c: null }] }, { id: 'b2', kind: 'p', runs: [{ t: '끝', b: false, c: null }] }])));
    const { container } = renderEditor('/editor?map=nf2&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    const a = new File(['a'], 'a.zip', { type: 'application/zip' });
    const b = new File(['bb'], 'b.hwp');
    fireEvent.drop(container.querySelector('[data-note-line="b1"]')!, { dataTransfer: { files: [a, b], types: ['Files'] } });

    await waitFor(() => expect(container.querySelectorAll('[data-file-block][data-file-state="ready"]').length).toBe(2));
    const order = [...container.querySelectorAll('[data-note-block]')].map((el) => el.querySelector('[data-file-name]')?.textContent ?? el.getAttribute('data-note-block'));
    expect(order).toEqual(['b1', 'a.zip', 'b.hwp', 'b2']);
  });

  it('파일 하나의 한도를 넘으면 카드에 까닭 — 다시 시도 단추는 없다(다시 해도 같다)', async () => {
    localStorage.setItem('mindflow_doc_nf3', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [] }])));
    const { container } = renderEditor('/editor?map=nf3&title=x');
    await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
    const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
    line.focus();
    const big = pdf();
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    fireEvent.paste(line, { clipboardData: { getData: () => '', types: ['Files'], items: [], files: [big] } });

    await waitFor(() => expect(container.querySelector('[data-file-block="b1"][data-file-state="error"]')).toBeTruthy());
    expect(container.querySelector('[data-file-sub]')?.textContent).toBe('파일 하나는 20MB까지 올릴 수 있어요');
    expect(container.querySelector('[data-file-retry]')).toBeNull();
  });

  it('다른 기기에서 올리다 멈춘 블록(fileId 없음)은 「끝나지 않았어요」', async () => {
    localStorage.setItem('mindflow_doc_nf4', JSON.stringify(noteWith([{ id: 'f1', kind: 'file', fileName: 'x.pdf', fileSize: 10 }])));
    const { container } = renderEditor('/editor?map=nf4&title=x');
    await waitFor(() => expect(container.querySelector('[data-file-block="f1"][data-file-state="unfinished"]')).toBeTruthy());
    expect(container.querySelector('[data-file-sub]')?.textContent).toContain('올리기가 끝나지 않았어요');
  });

  it('서버가 크기를 0으로 돌려줘도(옛 함수) 고른 파일에 내용이 있으면 그 크기를 보인다', async () => {
    const { LocalFileStore } = await import('../../adapters/local/localFileStore');
    const orig = LocalFileStore.prototype.upload;
    LocalFileStore.prototype.upload = async function (this: InstanceType<typeof LocalFileStore>, ...args: Parameters<typeof orig>) {
      const meta = await orig.apply(this, args);
      return { ...meta, size: 0 };
    };
    try {
      localStorage.setItem('mindflow_doc_nf5', JSON.stringify(noteWith([{ id: 'b1', kind: 'p', runs: [] }])));
      const { container } = renderEditor('/editor?map=nf5&title=x');
      await waitFor(() => expect(container.querySelector('[data-note-line="b1"]')).toBeTruthy());
      const line = container.querySelector('[data-note-line="b1"]') as HTMLElement;
      line.focus();
      fireEvent.paste(line, { clipboardData: { getData: () => '', types: ['Files'], items: [], files: [new File(['# 스펙\n본문'], '스펙.md', { type: 'text/markdown' })] } });
      await waitFor(() => expect(container.querySelector('[data-file-block="b1"][data-file-state="ready"]')).toBeTruthy());
      expect(container.querySelector('[data-file-sub]')?.textContent).not.toContain('0B');
    } finally {
      LocalFileStore.prototype.upload = orig;
    }
  });
});

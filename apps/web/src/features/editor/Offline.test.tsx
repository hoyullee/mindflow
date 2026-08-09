// 오프라인 동작(모바일웹 ⑤) — 표시 · 재연결 재시도 · 못 올린 편집 보존.
//
// 핵심 규칙: 저장이 실패하면 이 기기에는 남기고 '아직 못 올림' 표시를 붙인다.
// 다음에 열 때 그 표시가 있으면 서버 판(더 옛것)을 채택하지 않고 로컬을 올린다 —
// 없으면 오프라인에서 쓴 내용이 조용히 사라진다.
//
// 저장을 **Ctrl+S로 직접** 부르는 이유: 자동저장(0.9초 디바운스)에 기대면 전체 스위트를
// 함께 돌리는 부하 상황에서 간헐적으로 창을 넘겨 깨졌다. 여기서 검증할 규칙은 "저장이
// 실패했을 때"이지 디바운스가 아니므로, 타이밍을 테스트에서 걷어낸다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import { LocalCommentStore } from '../../adapters/local/localCommentStore';
import { LocalNotificationStore } from '../../adapters/local/localNotificationStore';
import { LocalImageStore } from '../../adapters/local/localImageStore';
import type { Backend, DocStore, SaveResult } from '../../adapters/ports';
import { hasPendingDoc } from './storage';

const DOC: Doc = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

function makeBackend(results: SaveResult[] = [], load: () => Promise<{ doc: Doc; version: number; title: string } | null> = async () => ({ doc: DOC, version: 1, title: '제품 로드맵' })) {
  let i = 0;
  const save = vi.fn(async (): Promise<SaveResult> => results[i++] ?? { ok: true, version: 1 });
  const docStore = {
    list: async () => [],
    load,
    loadPreview: async () => null,
    listEditorNames: async () => ({}),
    setFavorite: async () => undefined,
    remove: async () => undefined,
    restore: async () => undefined,
    purge: async () => undefined,
    rename: async () => undefined,
    save,
  } as unknown as DocStore;
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), notificationStore: new LocalNotificationStore(), mode: 'local' };
  return { backend, save };
}

function renderEditor(backend: Backend, docId: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor?map=${docId}&title=x`]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

/** 노드 하나를 골라 자식을 붙인다(= 문서 변경). */
function edit(container: HTMLElement): void {
  const vp = getViewport(container);
  const label = within(vp).getByText('리서치');
  fireEvent.pointerDown(label, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(label, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.keyDown(window, { key: 'Tab' }); // 자식 추가 = 내 편집
}

/** 자동저장을 기다리지 않고 지금 저장한다(Ctrl+S) — 타이밍 의존 제거. */
function saveNow(): void {
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('오프라인', () => {
  it('연결이 끊기면 문서 칩이 저장 상태 대신 오프라인을 말한다', async () => {
    const { backend } = makeBackend();
    renderEditor(backend, 'off1');
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy(), { timeout: 5000 });

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('오프라인')).toBeTruthy();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('오프라인')).toBeNull();
  });

  it('저장이 실패하면 이 기기에 남기고 "못 올림"으로 표시한다', async () => {
    const { backend, save } = makeBackend([{ ok: false, reason: 'error' } as SaveResult]);
    const { container } = renderEditor(backend, 'off2');
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy(), { timeout: 5000 });

    edit(container);
    saveNow();
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 10000 });

    await waitFor(() => expect(hasPendingDoc('off2')).toBe(true), { timeout: 5000 });
    expect(localStorage.getItem('mindflow_doc_off2')).toContain('리서치');
  });

  it('다시 연결되면 못 올린 편집을 바로 올린다(다음 편집을 기다리지 않는다)', async () => {
    const { backend, save } = makeBackend([{ ok: false, reason: 'error' } as SaveResult]);
    const { container } = renderEditor(backend, 'off3');
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy(), { timeout: 5000 });

    edit(container);
    saveNow();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 10000 });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(() => expect(hasPendingDoc('off3')).toBe(false), { timeout: 5000 });
  });

  it('못 올린 사본이 있으면 다음에 열 때 서버의 옛 판으로 덮지 않고 그것을 올린다', async () => {
    // 이 기기에는 오프라인에서 쓴(=서버보다 새) 사본이 남아 있다.
    const local: Doc = { ...DOC, nodes: { ...DOC.nodes, c2: { id: 'c2', text: '오프라인에서 쓴 것', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 }, root: { ...DOC.nodes.root!, children: ['c1', 'c2'] } } };
    localStorage.setItem('mindflow_doc_off4', JSON.stringify(local));
    localStorage.setItem('mindflow_doc_off4__pending', '1');

    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, 'off4');

    // 서버 판(c2 없음)이 화면을 덮지 않는다
    await waitFor(() => expect(within(getViewport(container)).getByText('오프라인에서 쓴 것')).toBeTruthy());
    // 그리고 곧바로 올라간다 → 표시가 지워진다
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 5000 });
    await waitFor(() => expect(hasPendingDoc('off4')).toBe(false), { timeout: 5000 });
  });

  it('표시가 없으면 예전처럼 서버 판을 채택한다(무회귀)', async () => {
    const stale: Doc = { ...DOC, nodes: { root: { ...DOC.nodes.root!, children: [] } } };
    localStorage.setItem('mindflow_doc_off5', JSON.stringify(stale));

    const { backend } = makeBackend();
    const { container } = renderEditor(backend, 'off5');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
  });
});

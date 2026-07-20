import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import type { Backend, DocStore, LoadedDoc } from '../../adapters/ports';
import { Editor } from './Editor';

// Entering the editor used to flash the empty placeholder seed ("새 마인드맵")
// before the real tree arrived, because the mount seed is synchronous but the
// backend `docStore.load` is async. In backend (supabase) mode the canvas now
// holds until that load resolves; local mode still paints instantly.

afterEach(cleanup);

const REAL_DOC = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '실제 루트', emoji: '🎯', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '실제 자식', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

function makeBackend(load: DocStore['load'], mode: Backend['mode']) {
  const save = vi.fn(async () => ({ ok: true, version: 2 }));
  const docStore = {
    list: async () => [],
    load,
    setFavorite: async () => undefined,
    remove: async () => undefined,
    restore: async () => undefined,
    rename: async () => undefined,
    save,
  } as unknown as DocStore;
  return { backend: { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), mode } as Backend, save };
}

function renderEditor(backend: Backend, entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe('Editor initial hydration', () => {
  it('supabase mode: holds the canvas (spinner) until the doc loads — no placeholder flash', async () => {
    localStorage.clear();
    let resolveLoad!: (v: LoadedDoc | null) => void;
    const gate = new Promise<LoadedDoc | null>((r) => {
      resolveLoad = r;
    });
    const { backend } = makeBackend(vi.fn(async () => gate), 'supabase');
    const { container } = renderEditor(backend, '/editor?map=m1&title=제목');

    // still loading: a spinner, and NO canvas nodes (the empty seed root must
    // NOT be painted — that was the flash).
    expect(screen.getByLabelText('불러오는 중')).toBeTruthy();
    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    expect(vp.querySelector('[data-node-id]')).toBeNull();
    expect(within(vp).queryByText('새 마인드맵')).toBeNull();
    expect(within(vp).queryByText('제목')).toBeNull();

    // body arrives → the real tree renders, spinner gone
    await act(async () => {
      resolveLoad({ doc: REAL_DOC as unknown as LoadedDoc['doc'], version: 3, title: '실제 루트' });
      await gate;
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('불러오는 중')).toBeNull();
      expect(within(vp).getByText('실제 루트')).toBeTruthy();
      expect(within(vp).getByText('실제 자식')).toBeTruthy();
    });
  });

  it('local mode: paints the seed immediately with no loading spinner', async () => {
    localStorage.clear();
    const { backend } = makeBackend(async () => null, 'local');
    const { container } = renderEditor(backend, '/editor?map=m2&title=제목');
    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    // no spinner at all; the seed root shows straight away
    expect(screen.queryByLabelText('불러오는 중')).toBeNull();
    expect(within(vp).getByText('제목')).toBeTruthy();
  });

  // ---- DATA-LOSS GUARDS ----

  it('never saves before the initial load resolves (the empty seed must not overwrite the real doc)', async () => {
    localStorage.clear();
    let resolveLoad!: (v: LoadedDoc | null) => void;
    const gate = new Promise<LoadedDoc | null>((r) => {
      resolveLoad = r;
    });
    const { backend, save } = makeBackend(vi.fn(async () => gate), 'supabase');
    renderEditor(backend, '/editor?map=dl1&title=제목');

    // load still in flight → no write may have happened
    expect(save).not.toHaveBeenCalled();

    // real doc arrives → adopted, cached to localStorage, and NOT re-saved
    await act(async () => {
      resolveLoad({ doc: REAL_DOC as unknown as LoadedDoc['doc'], version: 3, title: '실제 루트' });
      await gate;
    });
    await waitFor(() => {
      const cached = JSON.parse(localStorage.getItem('mindflow_doc_dl1') || 'null');
      expect(cached?.nodes?.root?.text).toBe('실제 루트'); // real doc cached (recovery copy + no future empty-seed race)
    });
    expect(save).not.toHaveBeenCalled(); // adopting the loaded doc must not trigger a (redundant/empty) save
  });

  it('on load FAILURE: shows an error+retry, never the seed, and never saves', async () => {
    localStorage.clear();
    const { backend, save } = makeBackend(vi.fn(async () => Promise.reject(new Error('network'))), 'supabase');
    const { container } = renderEditor(backend, '/editor?map=dl2&title=제목');

    const vp = container.querySelector('.mf-ed-vp') as HTMLElement;
    await waitFor(() => expect(within(vp).getByText('맵을 불러오지 못했어요')).toBeTruthy());
    // the empty seed is NOT shown as an editable canvas, and no node boxes rendered
    expect(vp.querySelector('[data-node-id]')).toBeNull();
    expect(within(vp).queryByText('제목')).toBeNull();
    // and crucially: nothing was written to the backend (can't overwrite the real doc)
    expect(save).not.toHaveBeenCalled();
  });
});

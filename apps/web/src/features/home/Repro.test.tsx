import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult, SpaceStore, WorkspaceData } from '../../adapters/ports';

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

/** Supabase처럼: 문서 목록은 백엔드에만 있고 localStorage를 훑지 않는다. */
class BackendDocStore implements DocStore {
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  purge = vi.fn(async (): Promise<void> => undefined);
  rename = vi.fn(async (): Promise<void> => undefined);
  save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 }));
  load = vi.fn(async (): Promise<LoadedDoc | null> => null);
  constructor(private metas: DocMeta[] = []) {}
  async list(): Promise<DocMeta[]> { return this.metas; }
}

/** 저장 페이로드를 잡아 두는 SpaceStore(= Supabase workspaces 테이블 대역). */
class CapturingSpaceStore implements SpaceStore {
  saves: WorkspaceData[] = [];
  constructor(public data: WorkspaceData | null) {}
  async load(): Promise<WorkspaceData | null> { return this.data ? JSON.parse(JSON.stringify(this.data)) : null; }
  async save(d: WorkspaceData): Promise<void> { this.saves.push(JSON.parse(JSON.stringify(d))); this.data = JSON.parse(JSON.stringify(d)); }
}

const IMPORT_JSON = JSON.stringify({
  v: 1,
  nodes: { root: { id: 'root', text: '가져온 맵', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
  floats: [], lines: [], zones: [], layoutMode: 'right', themeKey: 'coral',
});

function renderWith(spaceStore: SpaceStore, docStore: DocStore) {
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore, mode: 'supabase' };
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe('repro: 폴더 안 가져오기 (백엔드 모드)', () => {
  it('가져온 맵이 폴더에 남는다 — 저장 페이로드와 리로드 후까지', async () => {
    const user = userEvent.setup();
    const ws: WorkspaceData = {
      spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', home: true, maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
      mapFolders: {},
    };
    const store = new CapturingSpaceStore(ws);
    const first = renderWith(store, new BackendDocStore([]));

    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    await user.click(screen.getByText('내폴더'));
    await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

    const input = first.container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([IMPORT_JSON], '가져온 맵.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByText(/추가했어요/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '확인' }));

    // 즉시: 폴더 뷰에 보인다
    await waitFor(() => expect(first.container.querySelector('a[data-title="가져온 맵"]')).toBeTruthy());

    // 저장된 블롭에 폴더 배정이 들어 있는가?
    await waitFor(() => expect(store.saves.length).toBeGreaterThan(0));
    const last = store.saves[store.saves.length - 1]!;
    console.log('SAVED mapFolders =', JSON.stringify(last.mapFolders));
    console.log('SAVED maps =', JSON.stringify((last.spaces[0] as { maps: unknown[] }).maps));
    expect(last.mapFolders).toEqual({ '가져온 맵': 'f1' });

    // 리로드: 같은 블롭으로 다시 마운트하면 폴더 안에 그대로 있어야 한다
    first.unmount();
    const second = renderWith(store, new BackendDocStore([]));
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    await user.click(screen.getByText('내폴더'));
    await waitFor(() => expect(second.container.querySelector('h2')).toBeTruthy());
    expect(second.container.querySelector('a[data-title="가져온 맵"]')).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult, SpaceStore, WorkspaceData } from '../../adapters/ports';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Minimal `DocStore` test double — `list()` resolves to whatever metas the
 * test seeds it with; the mutating methods are spies so tests can assert
 * they were (or weren't) called, without touching real storage. */
class MockDocStore implements DocStore {
  setFavorite = vi.fn(async (): Promise<void> => undefined);
  remove = vi.fn(async (): Promise<void> => undefined);
  restore = vi.fn(async (): Promise<void> => undefined);
  rename = vi.fn(async (): Promise<void> => undefined);
  save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 }));
  // Bodies live behind `load()` only (like a real backend) — `list()` never
  // carries them, and nothing is written to localStorage.
  load = vi.fn(async (id: string): Promise<LoadedDoc | null> => this.bodies[id] ?? null);

  constructor(
    private metas: DocMeta[] = [],
    private bodies: Record<string, LoadedDoc> = {},
  ) {}

  async list(): Promise<DocMeta[]> {
    return this.metas;
  }
}

function renderHomeWithDocStore(metas: DocMeta[] = [], bodies: Record<string, LoadedDoc> = {}) {
  const docStore = new MockDocStore(metas, bodies);
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), mode: 'local' };
  const utils = render(
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
  return { ...utils, docStore };
}

describe('Home', () => {
  it('renders the sidebar and the main map sections', async () => {
    const { container } = renderHome();
    const sidebar = within(container.querySelector('aside') as HTMLElement);

    // sidebar
    expect(sidebar.getByText('스페이스')).toBeTruthy();
    expect(sidebar.getByText('Google Drive')).toBeTruthy();
    expect(sidebar.getByText('즐겨찾기')).toBeTruthy();
    expect(sidebar.getByText('휴지통')).toBeTruthy();
    // the space list is a skeleton until the workspace load settles, then 일반 공간 appears
    await waitFor(() => expect(sidebar.getByText('일반 공간')).toBeTruthy());

    // toolbar / main. With no saved maps the grid shows its empty state (after
    // the initial DocStore.list() settles — until then it shows a skeleton), so
    // "＋ 새로 만들기" appears both in the toolbar and the empty-state CTA.
    expect(screen.getByPlaceholderText('파일 검색')).toBeTruthy();
    expect(screen.getAllByText('＋ 새로 만들기').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
  });

  it('shows the signed-in email in the LNB profile and derives the name from it', async () => {
    // LocalAuth reads its session from `mf_demo_session`; seed a real login email.
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    const { container } = renderHomeWithDocStore([]);
    const aside = within(container.querySelector('aside') as HTMLElement);

    // the real email is shown (popover content is always in the DOM), and the
    // name defaults to its local part — not the hardcoded "mine" placeholder.
    await waitFor(() => expect(aside.getByText('hoyul.lee@wantedlab.com')).toBeTruthy());
    expect(aside.getAllByText('hoyul.lee').length).toBeGreaterThan(0);
    expect(aside.queryByText('mine@wantedlab.com')).toBeNull();
    expect(aside.queryByText('mine')).toBeNull();
  });

  it('renders saved documents from DocStore.list() as map cards', async () => {
    const { container } = renderHomeWithDocStore([
      { id: 'doc-a', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'doc-b', title: '무상 비즈머니 지급', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
    expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeTruthy();
  });

  it('shows the loading overlay then navigates to /editor after clicking "새로 만들기"', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);

    expect(screen.getByText('새 마인드맵을 준비하고 있어요')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 2000 });
  });

  it('filters the map grid as the search box is typed into', async () => {
    const user = userEvent.setup();
    const { container } = renderHomeWithDocStore([
      { id: 'doc-a', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      { id: 'doc-b', title: '무상 비즈머니 지급', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
    expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('파일 검색'), '따라잡기');

    expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy();
    expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeNull();
  });

  it('renders a real-map thumbnail for a backend-stored map (body via DocStore.load, not localStorage)', async () => {
    // A map whose body lives ONLY behind DocStore.load() (a real backend like
    // Supabase — nothing in localStorage). The preview must prefetch the body
    // and draw the actual nodes, not fall back to the generic miniPreview.
    const doc = {
      v: 1,
      nodes: {
        root: { id: 'root', text: '분기목표', emoji: '🎯', parent: null, children: ['n1', 'n2'], collapsed: false, color: null, x: 0, y: 0 },
        n1: { id: 'n1', text: '매출확대', emoji: '', parent: 'root', children: [], collapsed: false, color: '#3f8fd0', x: 0, y: 0 },
        n2: { id: 'n2', text: '신규채용', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
      },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    const { container } = renderHomeWithDocStore(
      [{ id: 'doc-remote', title: '분기목표', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
      { 'doc-remote': { doc: doc as unknown as LoadedDoc['doc'], version: 1, title: '분기목표' } },
    );

    const card = await waitFor(() => {
      const c = container.querySelector('a[data-title="분기목표"]');
      if (!c) throw new Error('card not rendered yet');
      return c as HTMLElement;
    });
    // Once the body is prefetched, the thumbnail is a realPreview SVG that
    // includes the node labels (miniPreview draws no text at all).
    await waitFor(() => {
      const thumb = card.querySelector('.map-thumb') as HTMLElement;
      const labels = Array.from(thumb.querySelectorAll('svg text')).map((t) => t.textContent);
      expect(labels).toEqual(expect.arrayContaining(['🎯 분기목표', '매출확대', '신규채용']));
    });
  });

  it('shows a skeleton while a backend map body loads (no generic-sketch flash), then the real nodes', async () => {
    // Gate DocStore.load() so we can observe the card WHILE its body is still
    // loading: it must show a neutral skeleton, never the generic miniPreview
    // SVG (which would flash and then be replaced by the real nodes).
    let resolveLoad!: (v: LoadedDoc | null) => void;
    const gate = new Promise<LoadedDoc | null>((r) => {
      resolveLoad = r;
    });
    const doc = {
      v: 1,
      nodes: { root: { id: 'root', text: '실제루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
      floats: [],
      lines: [],
      zones: [],
      layoutMode: 'radial',
      themeKey: 'coral',
    };
    const docStore: DocStore = {
      list: async () => [{ id: 'd1', title: '실제루트', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }],
      load: vi.fn(async () => gate),
      setFavorite: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, version: 1 })),
    };
    const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), mode: 'local' };
    const { container } = render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/editor" element={<div>EDITOR_PLACEHOLDER</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    const thumb = await waitFor(() => {
      const t = container.querySelector('a[data-title="실제루트"] .map-thumb');
      if (!t) throw new Error('card not rendered yet');
      return t as HTMLElement;
    });
    // still loading: a shimmer skeleton, NOT a preview SVG (no generic flash)
    expect(thumb.querySelector('.mf-skel')).toBeTruthy();
    expect(thumb.querySelector('svg')).toBeNull();

    // body arrives → the real nodes render (and the skeleton is gone)
    resolveLoad({ doc: doc as unknown as LoadedDoc['doc'], version: 1, title: '실제루트' });
    await waitFor(() => expect(Array.from(thumb.querySelectorAll('svg text')).map((t) => t.textContent)).toContain('실제루트'));
    expect(thumb.querySelector('.mf-skel')).toBeNull();
  });

  it('hides the "아직 만든 맵이 없어요" prompt when the space has folders but no loose maps', async () => {
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: {},
      }),
    );
    renderHomeWithDocStore([]);

    // the folder section renders …
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    expect(screen.getByText('폴더')).toBeTruthy();
    // … but NOT the empty-space prompt, and the empty-state "＋ 새로 만들기" CTA is
    // gone (only the always-present toolbar button remains).
    expect(screen.queryByText('아직 만든 맵이 없어요')).toBeNull();
    expect(screen.getAllByText('＋ 새로 만들기').length).toBe(1);
  });

  it('still shows the "아직 만든 맵이 없어요" prompt for a space with neither maps nor folders', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'se', name: '빈공간', color: '#3f8fd0', maps: [], folders: [] }], mapFolders: {} }));
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    // both the toolbar button and the empty-state CTA are present
    expect(screen.getAllByText('＋ 새로 만들기').length).toBe(2);
  });

  it('keeps a folder-filed map in its folder when the merge renames it to its backend title', async () => {
    const user = userEvent.setup();
    // A map filed in a folder under its old title, whose backend doc has since
    // been renamed (e.g. created in a folder, then its root text edited in the
    // editor). On load the merge renames the card to the backend title — the
    // folder assignment must follow, not orphan (folder counts it while the
    // card drops to the space top level).
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [{ title: '옛이름', when: '내 맵', hue: '#f0663f', docId: 'd1' }], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: { 옛이름: 'f1' },
      }),
    );
    const { container } = renderHomeWithDocStore([{ id: 'd1', title: '새이름', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null }]);

    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    // the renamed card must NOT appear at the space top level (it belongs to the folder)
    expect(container.querySelector('a[data-title="새이름"]')).toBeNull();
    expect(container.querySelector('a[data-title="옛이름"]')).toBeNull();
    // entering the folder shows the renamed card
    await user.click(screen.getByText('내폴더'));
    await waitFor(() => expect(container.querySelector('a[data-title="새이름"]')).toBeTruthy());
  });

  it('files a new map into the folder you are currently inside', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [{ id: 'sf', name: '폴더공간', color: '#3f8fd0', maps: [], folders: [{ id: 'f1', name: '내폴더' }] }],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([]);

    // enter the folder
    await waitFor(() => expect(screen.getByText('내폴더')).toBeTruthy());
    await user.click(screen.getByText('내폴더'));
    await waitFor(() => expect(screen.getByText('이 폴더는 비어 있어요')).toBeTruthy());

    // create a new map from inside the folder (toolbar CTA)
    await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);

    // the folder view only renders cards filed to THIS folder, so the new map
    // appearing here proves it was filed into the folder (not the space top level).
    await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵"]')).toBeTruthy());
  });

  it('restores the space you were viewing when Home remounts (editor round-trip)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 'sa', name: '공간에이', color: '#3f8fd0', maps: [] },
          { id: 'sb', name: '공간비이', color: '#8a6bd1', maps: [] },
        ],
        mapFolders: {},
      }),
    );

    // First visit: active space defaults to the first space.
    const first = renderHomeWithDocStore([]);
    await waitFor(() => expect(first.container.querySelector('h2')?.textContent).toBe('공간에이'));

    // Switch to the second space (as the user would before opening a map).
    const aside = first.container.querySelector('aside') as HTMLElement;
    await user.click(within(aside).getByText('공간비이'));
    await waitFor(() => expect(first.container.querySelector('h2')?.textContent).toBe('공간비이'));

    // Open a map → editor → back to Home: Home unmounts and remounts fresh. It
    // should land back on the space we left from, not reset to the first space.
    first.unmount();
    const second = renderHomeWithDocStore([]);
    await waitFor(() => expect(second.container.querySelector('h2')?.textContent).toBe('공간비이'));
  });

  it('never overwrites the workspace when the space load fails (re-login data loss)', async () => {
    // A backend whose workspace load REJECTS (transient error / RLS / not-ready).
    // The app falls back to the default seed, but it must NOT persist that seed —
    // doing so would wipe the user's real spaces/folders (the reported bug).
    const save = vi.fn(async (): Promise<void> => undefined);
    const spaceStore: SpaceStore = {
      load: vi.fn(async (): Promise<WorkspaceData | null> => {
        throw new Error('transient load failure');
      }),
      save,
    };
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, mode: 'local' };
    render(
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
    // the home settles on the default seed after the failed load…
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
    // …but the workspace is NEVER written back — the failed load must not clobber it.
    expect(save).not.toHaveBeenCalled();
  });

  it('does not re-save the workspace merely from loading it (hydration is a no-op)', async () => {
    const save = vi.fn(async (): Promise<void> => undefined);
    const spaceStore: SpaceStore = {
      load: vi.fn(async (): Promise<WorkspaceData | null> => ({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} })),
      save,
    };
    const backend: Backend = { auth: new LocalAuth(), docStore: new MockDocStore([]), spaceStore, mode: 'local' };
    const { container } = render(
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
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('작업 공간')).toBeTruthy());
    // loading real data and rendering it must not trigger a write-back
    expect(save).not.toHaveBeenCalled();
  });

  it('moves a map to another space via the card ☰ menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mf_spaces',
      JSON.stringify({
        spaces: [
          { id: 'sa', name: '공간에이', color: '#3f8fd0', maps: [{ title: '내 맵', when: '방금', hue: '#f0663f', docId: 'd1' }], folders: [] },
          { id: 'sb', name: '공간비이', color: '#8a6bd1', maps: [], folders: [] },
        ],
        mapFolders: {},
      }),
    );
    const { container } = renderHomeWithDocStore([]);

    const card = (await waitFor(() => {
      const c = container.querySelector('a[data-title="내 맵"]');
      if (!c) throw new Error('card not rendered');
      return c;
    })) as HTMLElement;

    // open ☰ → 스페이스로 이동 → 공간비이 (scope name lookups to the card's menu,
    // since the space name also appears in the sidebar)
    await user.click(within(card).getByLabelText('메뉴'));
    await user.click(within(card).getByText('스페이스로 이동'));
    await user.click(within(card).getByText('공간비이'));

    // the move toast labels itself "이동 완료" (not the old hardcoded "복원 완료")
    await waitFor(() => expect(screen.getByText('이동 완료')).toBeTruthy());
    expect(screen.getByText(/공간비이.*공간으로 옮겼어요/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' })); // dismiss toast

    // the map leaves the current (공간에이) view…
    await waitFor(() => expect(container.querySelector('a[data-title="내 맵"]')).toBeNull());
    // …and shows up when we switch to 공간비이
    const aside = within(container.querySelector('aside') as HTMLElement);
    await user.click(aside.getByText('공간비이'));
    await waitFor(() => expect(container.querySelector('a[data-title="내 맵"]')).toBeTruthy());
  });

  it('a user-created space persists across a reload (localStorage)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /새 공간/ })).toBeTruthy());

    // open "새 공간" → type a name → Enter (onNewSpaceKey → createSpace)
    await user.click(screen.getByRole('button', { name: /새 공간/ }));
    await user.type(screen.getByLabelText('공간 이름'), '내 스페이스{Enter}');
    await waitFor(() => expect(screen.getByText('내 스페이스')).toBeTruthy());

    // "reload": unmount and mount a fresh Home sharing the same localStorage
    unmount();
    cleanup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByText('내 스페이스')).toBeTruthy());
  });

  it('renames a space (name + color) via the shared new-space popup', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'sx', name: '옛이름', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('옛이름')).toBeTruthy());

    // ⋮ menu → 이름 변경 opens the SAME popup as "새 공간", but in edit mode
    await user.click(aside.getByLabelText('공간 메뉴'));
    await user.click(aside.getByText('이름 변경'));

    expect(screen.getByText('공간 이름 변경')).toBeTruthy();
    const input = screen.getByLabelText('공간 이름') as HTMLInputElement;
    expect(input.value).toBe('옛이름'); // pre-filled

    // change the name, pick a different tag color, then 변경
    await user.clear(input);
    await user.type(input, '새이름');
    await user.click(screen.getByRole('button', { name: '색상 #d0568f' }));
    await user.click(screen.getByRole('button', { name: '변경' }));

    await waitFor(() => expect(aside.getByText('새이름')).toBeTruthy());
    expect(aside.queryByText('옛이름')).toBeNull();
    // both name AND color persisted to the workspace
    await waitFor(() => {
      const sp = JSON.parse(localStorage.getItem('mf_spaces') as string).spaces.find((s: { id: string }) => s.id === 'sx');
      expect(sp.name).toBe('새이름');
      expect(sp.color).toBe('#d0568f');
    });
  });

  it('shows a spaces skeleton in the LNB until the workspace loads (no seed-space flash)', async () => {
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    const { container } = renderHomeWithDocStore([]);
    const aside = container.querySelector('aside') as HTMLElement;

    // before the workspace load resolves: the sidebar shows a skeleton, not the
    // seed 일반 공간 SpaceRow; the title is a skeleton too (no <h2> yet)
    expect(within(aside).getByLabelText('스페이스를 불러오는 중')).toBeTruthy();
    expect(aside.querySelector('.space-row')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();

    // after load: real spaces render, the skeletons are gone, and the title shows
    await waitFor(() => expect(within(aside).getByText('작업 공간')).toBeTruthy());
    expect(within(aside).queryByLabelText('스페이스를 불러오는 중')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('작업 공간');
  });

  it('does not resurrect a deleted 일반 공간 on reload (respects a persisted spaces list with no home space)', async () => {
    // simulate the state persisted after the user deleted the home space: only a
    // custom space remains, none flagged `home`.
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'work', name: '작업 공간', color: '#3f8fd0', maps: [] }], mapFolders: {} }));
    renderHomeWithDocStore([]);

    // after the workspace load settles, the custom space shows and 일반 공간 is NOT re-created
    await waitFor(() => expect(screen.getAllByText('작업 공간').length).toBeGreaterThan(0));
    expect(screen.queryByText('일반 공간')).toBeNull();
  });

  it('creating a map while a custom space is active assigns it to that space (not the home space)', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /새 공간/ })).toBeTruthy());

    // create a custom space, then activate it (click its sidebar row)
    await user.click(screen.getByRole('button', { name: /새 공간/ }));
    await user.type(screen.getByLabelText('공간 이름'), '작업 공간{Enter}');
    await waitFor(() => expect(screen.getByText('작업 공간')).toBeTruthy());
    await user.click(screen.getByText('작업 공간'));

    // create a new map from the toolbar CTA
    await user.click(screen.getAllByText('＋ 새로 만들기')[0]!);

    // the new map's card is registered under "작업 공간", not "일반 공간"
    const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces: { name: string; maps?: unknown[] }[] };
    const mine = ws.spaces.find((s) => s.name === '작업 공간');
    const general = ws.spaces.find((s) => s.name === '일반 공간');
    expect(mine?.maps?.length).toBe(1);
    expect(general?.maps?.length ?? 0).toBe(0);
  });

  it('logs out (via the confirm dialog) and navigates to /login', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: /로그아웃/ }));
    expect(screen.getByText('로그아웃하시겠습니까?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
  });

  it('renames the profile via the "프로필명 변경" popup from the profile menu', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    // profile popover → 프로필명 변경 opens a popup (like 공간 이름 변경)
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));

    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    const input = within(dialog).getByLabelText('프로필명') as HTMLInputElement;
    expect(input.value).toBe('hoyul.lee'); // pre-filled from the current name
    await user.clear(input);
    await user.type(input, '홍길동');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));

    // committed: the LNB profile shows the new name; the popup is gone
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog', { name: '프로필명 변경' })).toBeNull();
  });

  it('cancelling the "프로필명 변경" popup keeps the old name', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '버릴이름');
    await user.click(within(dialog).getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('dialog', { name: '프로필명 변경' })).toBeNull();
    expect(screen.queryByText('버릴이름')).toBeNull();
    expect(screen.getAllByText('hoyul.lee').length).toBeGreaterThan(0);
  });

  it('does not close the "프로필명 변경" popup when the dim backdrop is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    renderHomeWithDocStore([]);

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });

    // click the dim overlay (the dialog's backdrop parent) — must NOT dismiss
    await user.click(dialog.parentElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: '프로필명 변경' })).toBeTruthy();
  });

  it('persists the renamed profile across a reload', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    const { unmount } = renderHomeWithDocStore([]);

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '홍길동');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));

    // "reload": remount a fresh Home sharing the same localStorage + session
    unmount();
    cleanup();
    renderHomeWithDocStore([]);
    await waitFor(() => expect(screen.getAllByText('홍길동').length).toBeGreaterThan(0));
    expect(screen.queryByText('hoyul.lee')).toBeNull(); // did NOT revert to the email default
  });

  it('loads the profile name from the backend (survives a cache clear) and saves renames to it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    // no localStorage cache (mf_profile_names absent) — as after clearing browser cache
    const setProfileName = vi.fn(async (): Promise<{ error?: string }> => ({}));
    class BackendAuth extends LocalAuth {
      override getProfileName = async (): Promise<string | null> => '서버닉네임';
      override setProfileName = setProfileName;
    }
    const backend: Backend = { auth: new BackendAuth(), docStore: new MockDocStore([]), spaceStore: new LocalSpaceStore(), mode: 'local' };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <BackendProvider backend={backend}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </BackendProvider>
      </MemoryRouter>,
    );

    // reconciled from the backend even with an empty local cache
    await waitFor(() => expect(screen.getAllByText('서버닉네임').length).toBeGreaterThan(0));

    // renaming writes through to the backend
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '프로필명 변경' }));
    const dialog = screen.getByRole('dialog', { name: '프로필명 변경' });
    await user.clear(within(dialog).getByLabelText('프로필명'));
    await user.type(within(dialog).getByLabelText('프로필명'), '새닉네임');
    await user.click(within(dialog).getByRole('button', { name: '변경' }));

    await waitFor(() => expect(setProfileName).toHaveBeenCalledWith('새닉네임'));
  });

  it('opens 설정 → 회원 탈퇴 and gates the destructive button on typing "탈퇴"', async () => {
    const user = userEvent.setup();
    renderHomeWithDocStore([]);

    // profile popover → 설정 → account-settings modal → 회원 탈퇴 row
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    const settingsDialog = screen.getByRole('dialog', { name: '설정' });
    await user.click(within(settingsDialog).getByText('회원 탈퇴'));

    // the confirm dialog's destructive button starts disabled…
    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    const delBtn = within(confirmDialog).getByRole('button', { name: '회원 탈퇴' }) as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);

    // …and arms only once the exact phrase is typed
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '탈퇴');
    expect(delBtn.disabled).toBe(false);
  });

  it('deletes the account: wipes MindFlow storage and lands on /login', async () => {
    const user = userEvent.setup();
    // seed a signed-in demo session + some MindFlow data to prove it's wiped
    localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u1', email: 'hoyul.lee@wantedlab.com' } }));
    localStorage.setItem('mf_spaces', JSON.stringify({ spaces: [{ id: 'general', name: '일반 공간', home: true, maps: [] }], mapFolders: {} }));
    localStorage.setItem('mindflow_doc_d1', JSON.stringify({ v: 1 }));
    renderHomeWithDocStore([]);

    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(within(screen.getByRole('dialog', { name: '설정' })).getByText('회원 탈퇴'));

    const confirmDialog = screen.getByRole('dialog', { name: '회원 탈퇴' });
    await user.type(within(confirmDialog).getByLabelText('탈퇴 확인 입력'), '탈퇴');
    await user.click(within(confirmDialog).getByRole('button', { name: '회원 탈퇴' }));

    await waitFor(() => expect(screen.getByText('LOGIN_PAGE')).toBeTruthy(), { timeout: 2000 });
    // every MindFlow-namespaced key is gone
    expect(localStorage.getItem('mf_demo_session')).toBeNull();
    expect(localStorage.getItem('mf_spaces')).toBeNull();
    expect(localStorage.getItem('mindflow_doc_d1')).toBeNull();
  });

  it('a live map is NOT hidden by a trashed map sharing its title (trash/space names do not interfere)', async () => {
    // Repro of the reported bug: "새 마인드맵_1" sits in the trash; a NEW map
    // with the same title is created and saved — the title-keyed deleted flag
    // used to hide the new (live) map from the grid entirely.
    const { container } = renderHomeWithDocStore([
      { id: 'doc-old', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'doc-new', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-03T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);

    // the LIVE doc renders as a grid card…
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵_1"]')).toBeTruthy());
    // …while the trashed one is ONLY in the trash list (one grid card, not two)
    expect(container.querySelectorAll('.mf-map-grid a[data-title="새 마인드맵_1"]').length).toBe(1);
    const aside = within(container.querySelector('aside') as HTMLElement);
    expect(aside.getByText('새 마인드맵_1')).toBeTruthy(); // trash row
  });

  it('restoring into a space that already has the title renames the restored map to "제목_복원1"', async () => {
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-old', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'doc-new', title: '새 마인드맵_1', version: 1, updatedAt: '2026-01-03T00:00:00.000Z', isFavorite: false, deletedAt: null },
    ]);
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵_1"]')).toBeTruthy());

    // restore the trashed doc from the LNB trash list
    await user.click(container.querySelector('.restore-link') as HTMLElement);
    const confirmBtn = screen.getAllByRole('button', { name: '복원' }).find((el) => el.tagName === 'BUTTON');
    await user.click(confirmBtn!);

    // both maps coexist: the live original + the renamed restored copy
    await waitFor(() => expect(container.querySelector('.mf-map-grid a[data-title="새 마인드맵_1_복원1"]')).toBeTruthy());
    expect(container.querySelectorAll('.mf-map-grid a[data-title="새 마인드맵_1"]').length).toBe(1);
    // the rename is persisted (meta title now matches what the grid shows)
    expect(docStore.restore).toHaveBeenCalledWith('doc-old');
    await waitFor(() => expect(docStore.rename).toHaveBeenCalledWith('doc-old', '새 마인드맵_1_복원1'));
  });

  it('unfavorites from the LNB favorites list via the leading star button', async () => {
    const user = userEvent.setup();
    const { container, docStore } = renderHomeWithDocStore([
      { id: 'doc-f', title: '즐겨찾는 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
    ]);
    const aside = within(container.querySelector('aside') as HTMLElement);
    await waitFor(() => expect(aside.getByText('즐겨찾는 맵')).toBeTruthy());

    // The star strips the favorite (row disappears, backend persisted)…
    await user.click(aside.getByRole('button', { name: "'즐겨찾는 맵' 즐겨찾기 해제" }));
    await waitFor(() => expect(aside.queryByText('즐겨찾는 맵')).toBeNull());
    expect(docStore.setFavorite).toHaveBeenCalledWith('doc-f', false);
    // …without opening the map (the row's click handler must not fire).
    expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();
    // The map itself is untouched — still in the grid.
    expect(container.querySelector('.mf-map-grid a[data-title="즐겨찾는 맵"]')).toBeTruthy();
  });

  describe('mobile (M6)', () => {
    it('collapses the toolbar actions into icon-only buttons on one row (no stray action line)', async () => {
      // On mobile the labeled 가져오기/새 폴더 pair used to wrap onto a lonely line
      // of its own; they now render as 44px icon-only buttons inside the search
      // row, and the primary CTA becomes an icon-only "+" — labels live on
      // aria-label/title so they stay accessible.
      const restore = mockMatchMedia(true);
      try {
        renderHome();
        await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeTruthy());
        const importBtn = screen.getByRole('button', { name: '가져오기' });
        const folderBtn = screen.getByRole('button', { name: '새 폴더' });
        const newBtn = screen.getByRole('link', { name: '새로 만들기' });
        // icon-only: the visible label text is gone…
        expect(importBtn.textContent).toBe('');
        expect(folderBtn.textContent).toBe('');
        expect(newBtn.textContent).toBe(''); // toolbar CTA is icon-only (the empty-state CTA keeps its label)
        // …and every action keeps the 44px touch target (§7)
        expect(importBtn.style.width).toBe('44px');
        expect(folderBtn.style.width).toBe('44px');
        expect(newBtn.style.width).toBe('44px');
        // all three live in the SAME row container as the search field
        const row = screen.getByPlaceholderText('파일 검색').closest('div')!.parentElement!;
        expect(row.contains(importBtn)).toBe(true);
        expect(row.contains(folderBtn)).toBe(true);
        expect(row.contains(newBtn)).toBe(true);
      } finally {
        restore();
      }
    });

    it('opens the drawer on a left-edge swipe right, and closes it on a swipe left', async () => {
      const restore = mockMatchMedia(true);
      try {
        const { container } = renderHome();
        expect(container.querySelector('aside')).toBeNull();

        // A swipe that does NOT start at the left edge must not open the drawer…
        fireEvent.touchStart(document, { touches: [{ clientX: 120, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 260, clientY: 300 }] });
        fireEvent.touchEnd(document);
        expect(container.querySelector('aside')).toBeNull();

        // …and neither must a vertical (scroll) gesture that begins at the edge.
        fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 200 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 16, clientY: 320 }] });
        fireEvent.touchEnd(document);
        expect(container.querySelector('aside')).toBeNull();

        // Left-edge swipe right → drawer opens.
        fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 90, clientY: 306 }] });
        fireEvent.touchEnd(document);
        await waitFor(() => expect(container.querySelector('aside')).toBeTruthy());

        // Swipe left anywhere while open → drawer closes.
        fireEvent.touchStart(document, { touches: [{ clientX: 220, clientY: 300 }] });
        fireEvent.touchMove(document, { touches: [{ clientX: 120, clientY: 296 }] });
        fireEvent.touchEnd(document);
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });

    it('opens a map with a SINGLE tap (real mobile browsers do not reliably emit dblclick)', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHomeWithDocStore([
          { id: 'doc-m', title: '모바일 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        ]);
        await waitFor(() => expect(container.querySelector('a[data-title="모바일 맵"]')).toBeTruthy());

        // …but a tap on the always-visible ☰ menu must NOT navigate.
        const card = container.querySelector('a[data-title="모바일 맵"]') as HTMLElement;
        await user.click(within(card).getByRole('button', { name: '메뉴' }));
        expect(screen.queryByText('EDITOR_PLACEHOLDER')).toBeNull();

        // A single tap on the card body navigates to the editor (after the
        // 900ms loader delay), instead of merely selecting the card.
        await user.click(card);
        await waitFor(() => expect(screen.getByText('EDITOR_PLACEHOLDER')).toBeTruthy(), { timeout: 3000 });
      } finally {
        restore();
      }
    });

    it('hides the sidebar behind a hamburger drawer and opens/closes it, crash-free', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHome();

        // Drawer starts closed: no <aside> in the document at all (not just hidden).
        expect(container.querySelector('aside')).toBeNull();
        expect(screen.getByPlaceholderText('파일 검색')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));

        const sidebar = within(container.querySelector('aside') as HTMLElement);
        expect(sidebar.getByText('스페이스')).toBeTruthy();
        // No ✕ button — the drawer closes via backdrop tap, left swipe, or Esc.
        expect(screen.queryByRole('button', { name: '메뉴 닫기' })).toBeNull();

        // Backdrop tap closes. The drawer plays its exit slide before unmounting
        // (Sidebar keeps the aside mounted for DRAWER_EXIT_MS), so closing is
        // observed via waitFor.
        fireEvent.click(container.parentElement!.querySelector('.mf-drawer-backdrop')!);
        expect(container.querySelector('aside')).toBeTruthy(); // still mounted, sliding out…
        await waitFor(() => expect(container.querySelector('aside')).toBeNull()); // …then gone

        // Escape closes too — the keyboard-accessible path now that ✕ is gone.
        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));
        expect(container.querySelector('aside')).toBeTruthy();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });

    it('animates the drawer: mounts off-screen, slides in, and slides out before unmounting', async () => {
      const restore = mockMatchMedia(true);
      try {
        const user = userEvent.setup();
        const { container } = renderHome();

        await user.click(screen.getByRole('button', { name: '메뉴 열기' }));
        const aside = container.querySelector('aside') as HTMLElement;
        expect(aside.className).toContain('mf-drawer'); // transition class attached
        // Mounts at the off-screen position; the next frames flip it on-screen
        // (double rAF), which is what makes the enter transition actually play.
        expect(aside.style.transform).toBe('translateX(-105%)');
        await waitFor(() => expect(aside.style.transform).toBe('translateX(0)'));

        await user.keyboard('{Escape}');
        // Exit phase: still mounted but translated back off-screen (sliding)…
        expect(container.querySelector('aside')).toBeTruthy();
        expect((container.querySelector('aside') as HTMLElement).style.transform).toBe('translateX(-105%)');
        // …and only unmounts after the slide finishes.
        await waitFor(() => expect(container.querySelector('aside')).toBeNull());
      } finally {
        restore();
      }
    });
  });

  describe('favorites/trash persistence (DocStore-wired)', () => {
    it('favoriting a doc-backed card calls docStore.setFavorite(docId, true)', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([
        { id: 'doc1', title: '새 맵 하나', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('새 맵 하나')).toBeTruthy());
      const card = container.querySelector('a[data-title="새 맵 하나"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '즐겨찾기' }));

      expect(docStore.setFavorite).toHaveBeenCalledWith('doc1', true);
    });

    it('reveals the ☰ menu button when its card is selected (so it is reachable without hover, e.g. on touch)', async () => {
      const user = userEvent.setup();
      const { container } = renderHomeWithDocStore([
        { id: 'doc-sel', title: '선택할 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('선택할 맵')).toBeTruthy());
      const card = container.querySelector('a[data-title="선택할 맵"]') as HTMLElement;
      const menuBtn = within(card).getByRole('button', { name: '메뉴' }) as HTMLElement;

      // hidden by default (only the hover CSS would show it — absent on touch)
      expect(menuBtn.style.opacity).toBe('0');

      await user.click(card); // a single click selects the card
      expect(menuBtn.style.opacity).toBe('1'); // …which now exposes the ☰ menu
    });

    it('renders 최근 항목 (recent) cards as a compact variant with no ☰ menu button', async () => {
      localStorage.setItem('mf_recent', JSON.stringify(['최근 맵']));
      const { container } = renderHomeWithDocStore([
        { id: 'doc-rec', title: '최근 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      // the recent card is the first card with this title (recent section renders above 맵)
      const recentCard = container.querySelectorAll('a[data-title="최근 맵"]')[0] as HTMLElement;
      // no ☰ menu button on a recent card…
      expect(within(recentCard).queryByRole('button', { name: '메뉴' })).toBeNull();
      // …and it's the compact thumbnail (72px), not the full 150px one
      const thumb = recentCard.querySelector('.map-thumb') as HTMLElement;
      expect(thumb.style.height).toBe('72px');

      // the main-grid copy of the same map keeps its full card + ☰ menu
      const mainCard = container.querySelectorAll('a[data-title="최근 맵"]')[1] as HTMLElement;
      expect(within(mainCard).getByRole('button', { name: '메뉴' })).toBeTruthy();
      expect((mainCard.querySelector('.map-thumb') as HTMLElement).style.height).toBe('150px');
    });

    it('renders the 최근 항목 (recent) section as a fixed-card horizontal tray (design-system §8.1)', async () => {
      const titles = ['맵 A', '맵 B', '맵 C', '맵 D', '맵 E', '맵 F'];
      localStorage.setItem('mf_recent', JSON.stringify(titles));
      const { container } = renderHomeWithDocStore(
        titles.map((title, i) => ({
          id: `doc-${i}`,
          title,
          version: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          isFavorite: false,
          deletedAt: null,
        })),
      );

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      // recent cards are the compact variant (72px thumbnail)
      const recent = [...container.querySelectorAll('a[data-title]')].filter((c) => {
        const th = c.querySelector('.map-thumb') as HTMLElement | null;
        return th?.style.height === '72px';
      });
      // Desktop exposes only as many cards as FIT the measured width — jsdom has
      // no layout (clientWidth 0), so the strip keeps its pre-measurement default
      // (3). The point: a long history collapses to one width-fitted row, it does
      // not all mount.
      expect(recent.length).toBe(3);
      expect(recent.length).toBeLessThan(titles.length);

      // Defensive (design-system §8.1): each card sits in a FIXED-width,
      // NON-STRETCHING slot — `flex: 0 0 auto`, never `flex: 1` (the flex analogue
      // of `1fr`, which is what previously made cards balloon "wide").
      const scroll = container.querySelector('.mf-recent-scroll') as HTMLElement;
      expect(scroll.style.overflowX).toBe('auto');
      recent.forEach((card) => {
        const slot = card.parentElement as HTMLElement;
        expect(slot.style.width).toBe('128px');
        expect(slot.style.flex).toContain('0 0 auto');
      });
    });

    it('mobile: the recent tray swipes through the history instead of cutting to the fit count', async () => {
      // Width-fit on a phone would strand everything past the ~2 cards that fit —
      // mobile keeps the swipeable overflow row (bounded by MOBILE_SWIPE_MAX).
      const restore = mockMatchMedia(true);
      try {
        const titles = ['맵 A', '맵 B', '맵 C', '맵 D', '맵 E', '맵 F'];
        localStorage.setItem('mf_recent', JSON.stringify(titles));
        const { container } = renderHomeWithDocStore(
          titles.map((title, i) => ({
            id: `doc-${i}`,
            title,
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            isFavorite: false,
            deletedAt: null,
          })),
        );
        await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
        const recent = [...container.querySelectorAll('a[data-title]')].filter((c) => {
          const th = c.querySelector('.map-thumb') as HTMLElement | null;
          return th?.style.height === '72px';
        });
        expect(recent.length).toBe(titles.length); // all reachable by swiping
      } finally {
        restore();
      }
    });

    it('migrates recent entries when a map was renamed, instead of silently dropping them', async () => {
      // Recents are title-keyed (like mapFolders): editing a map's root text in
      // the editor renames it, and before the migration the old-title entry
      // matched nothing — every rename permanently killed that recent card, so
      // the tray showed fewer cards than the screen fits.
      localStorage.setItem('mf_recent', JSON.stringify(['옛 이름']));
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          v: 1,
          spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '옛 이름', when: '내 맵', hue: '#f0663f', docId: 'doc-r' }] }],
          mapFolders: {},
          recent: ['옛 이름'],
        }),
      );
      // The backend meta carries the map's post-rename title.
      const { container } = renderHomeWithDocStore([
        { id: 'doc-r', title: '새 이름', version: 2, updatedAt: '2026-01-02T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('최근 항목')).toBeTruthy());
      const tray = container.querySelector('.mf-recent-tray') as HTMLElement;
      expect(tray.querySelector('a[data-title="새 이름"]')).toBeTruthy(); // follows the rename
      expect(tray.querySelector('a[data-title="옛 이름"]')).toBeNull();
      // …and this device's persisted list is kept in step
      expect(JSON.parse(localStorage.getItem('mf_recent')!)).toEqual(['새 이름']);
    });

    it('prefetches thumbnail bodies for recent maps living in OTHER spaces (they render in the tray)', async () => {
      // Regression: the preview prefetch was scoped to the ACTIVE space's maps
      // only, but the recent tray is cross-space — a recent map from another
      // space never resolved and sat on the loading skeleton forever.
      localStorage.setItem('mf_recent', JSON.stringify(['작업맵']));
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          v: 1,
          spaces: [
            { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '일반맵', when: '내 맵', hue: '#f0663f', docId: 'doc-g' }] },
            { id: 'work', name: '작업', color: '#3f8fd0', maps: [{ title: '작업맵', when: '내 맵', hue: '#3f8fd0', docId: 'doc-w' }] },
          ],
          mapFolders: {},
          recent: ['작업맵'],
        }),
      );
      const { docStore } = renderHomeWithDocStore([
        { id: 'doc-g', title: '일반맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        { id: 'doc-w', title: '작업맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      // active space is 일반 공간, yet the 작업-space recent's body must be fetched too
      await waitFor(() => expect(docStore.load).toHaveBeenCalledWith('doc-w'));
      expect(docStore.load).toHaveBeenCalledWith('doc-g'); // active space still prefetches
    });

    it('deleting calls docStore.remove(docId), restoring calls docStore.restore(docId)', async () => {
      const user = userEvent.setup();
      const { container, docStore } = renderHomeWithDocStore([
        { id: 'doc2', title: '삭제할 맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);

      await waitFor(() => expect(screen.getByText('삭제할 맵')).toBeTruthy());
      const card = container.querySelector('a[data-title="삭제할 맵"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(within(card).getByText('삭제하기'));

      // ConfirmModal is always mounted (display:none when hidden), so only the
      // now-visible delete-map dialog's button is in the accessibility tree —
      // the folder/space delete dialogs (also labeled "삭제") stay excluded.
      await user.click(screen.getByRole('button', { name: '삭제' }));
      expect(docStore.remove).toHaveBeenCalledWith('doc2');

      // The trash list's "복원" link is always in the DOM (CSS-collapsed, not
      // unmounted) regardless of the "휴지통" section's open/closed state.
      const restoreLink = container.querySelector('.restore-link') as HTMLElement;
      expect(restoreLink).toBeTruthy();
      await user.click(restoreLink);

      // Disambiguate from the (still-present) "복원" restore-link span, which
      // also matches role=button/name=복원 — only the confirm dialog uses a
      // real <button>.
      const restoreConfirmBtn = screen.getAllByRole('button', { name: '복원' }).find((el) => el.tagName === 'BUTTON');
      expect(restoreConfirmBtn).toBeTruthy();
      await user.click(restoreConfirmBtn!);

      expect(docStore.restore).toHaveBeenCalledWith('doc2');
    });

    it('permanently deletes a workspace-only (docId-less) card — removed from the persisted workspace so it cannot reappear on reload', async () => {
      const user = userEvent.setup();
      // A space whose card has NO docId (the reported "새 마인드맵_1 (2)" case):
      // deletion used to only set a session-only `deleted[title]`, so a refresh
      // (which re-reads this workspace) brought the card straight back.
      localStorage.setItem(
        'mf_spaces',
        JSON.stringify({
          spaces: [{ id: 'snew', name: '신규 공간', color: '#3f8fd0', maps: [{ title: '새 마인드맵_1 (2)', when: '내 맵', hue: '#f0663f' }], folders: [] }],
          mapFolders: {},
        }),
      );
      const { container, unmount } = renderHomeWithDocStore([]); // no doc metas

      await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeTruthy());
      const card = container.querySelector('a[data-title="새 마인드맵_1 (2)"]') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: '메뉴' }));
      await user.click(within(card).getByText('삭제하기'));
      await user.click(screen.getByRole('button', { name: '삭제' }));

      // gone from the grid…
      await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeNull());
      // …and REMOVED from the persisted workspace (the reload source of truth)
      await waitFor(() => {
        const ws = JSON.parse(localStorage.getItem('mf_spaces') || '{}') as { spaces?: { maps?: { title: string }[] }[] };
        const titles = (ws.spaces || []).flatMap((s) => (s.maps || []).map((m) => m.title));
        expect(titles).not.toContain('새 마인드맵_1 (2)');
      });

      // simulate a browser refresh: a fresh mount reads the persisted workspace
      unmount();
      const { container: c2 } = renderHomeWithDocStore([]);
      await waitFor(() => expect(within(c2).getAllByText('신규 공간').length).toBeGreaterThan(0)); // loaded
      expect(c2.querySelector('a[data-title="새 마인드맵_1 (2)"]')).toBeNull();
    });

    it('seeds trash from docStore.list() metas on mount (refresh scenario: deletedAt survives reload)', async () => {
      const { container } = renderHomeWithDocStore([
        // A live doc still present in the grid (sanity anchor).
        { id: 'doc-live', title: '따라잡기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
        // A meta with deletedAt already set — as if a previous session had
        // deleted it and the page is now reloading. Before the fix,
        // `deleted`/`trash` always started empty, so this card would reappear
        // as a regular map.
        { id: 'doc3', title: '무상 비즈머니 지급', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: '2026-01-02T00:00:00.000Z' },
      ]);

      // Sanity: an unrelated live doc still renders normally.
      await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());

      // Seeded as deleted => no card for it in the regular map grid...
      await waitFor(() => expect(container.querySelector('a[data-title="무상 비즈머니 지급"]')).toBeNull());
      // ...but it shows up in the trash sidebar list with a working restore link.
      const trashRow = Array.from(container.querySelectorAll('.drive-file')).find((el) => (el.textContent || '').includes('무상 비즈머니 지급'));
      expect(trashRow).toBeTruthy();
      expect(trashRow?.querySelector('.restore-link')).toBeTruthy();
    });

    it('seeds favorites from docStore.list() metas on mount (refresh scenario: isFavorite survives reload)', async () => {
      const { container } = renderHomeWithDocStore([
        { id: 'doc4', title: '따라잡기', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
      ]);

      // Still shows as a regular card (favoriting doesn't hide it)...
      await waitFor(() => expect(container.querySelector('a[data-title="따라잡기"]')).toBeTruthy());
      // ...and the card's own favorite star renders as "on" (filled, not hollow).
      const card = container.querySelector('a[data-title="따라잡기"]') as HTMLElement;
      expect(within(card).getByRole('button', { name: '즐겨찾기 해제' })).toBeTruthy();
    });

    it('a favorited+deleted map on reload lands ONLY in trash, never in favorites (LNB)', async () => {
      const { container } = renderHomeWithDocStore([
        // A live favorite (sanity anchor — should stay in the favorites list).
        { id: 'fav-live', title: '살아있는 즐겨찾기', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: null },
        // The bug case: favorited AND deleted. `remove()` only sets deletedAt,
        // so the persisted meta still carries isFavorite=true. It must show up
        // in trash only — not in both LNB lists.
        { id: 'fav-del', title: '즐겨찾기했다삭제한맵', version: 2, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: true, deletedAt: '2026-01-02T00:00:00.000Z' },
      ]);

      await waitFor(() => expect(container.querySelector('aside')).toBeTruthy());
      // Rows in the favorites/trash lists both use `.drive-file`; trash rows are
      // the ones carrying a `.restore-link`.
      const rows = () => Array.from(container.querySelectorAll('aside .drive-file'));
      const favTitles = () => rows().filter((r) => !r.querySelector('.restore-link')).map((r) => (r.textContent || '').trim());
      const trashTitles = () => rows().filter((r) => r.querySelector('.restore-link')).map((r) => (r.textContent || '').trim());

      await waitFor(() => expect(favTitles().some((t) => t.includes('살아있는 즐겨찾기'))).toBe(true));

      // The favorited+deleted map is in trash...
      expect(trashTitles().some((t) => t.includes('즐겨찾기했다삭제한맵'))).toBe(true);
      // ...and NOT in favorites (the reported regression).
      expect(favTitles().some((t) => t.includes('즐겨찾기했다삭제한맵'))).toBe(false);
    });

    it('new-map link gets a _N-suffixed default title when "새 마인드맵" already exists', async () => {
      const { container } = renderHomeWithDocStore([
        { id: 'nm0', title: '새 마인드맵', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);
      // Wait for the existing map to be merged into the grid (so newMapHref sees it).
      await waitFor(() => expect(container.querySelector('a[data-title="새 마인드맵"]')).toBeTruthy());

      const newLink = Array.from(container.querySelectorAll('a')).find((a) => (a.textContent || '').includes('＋ 새로 만들기')) as HTMLAnchorElement;
      expect(newLink).toBeTruthy();
      const href = newLink.getAttribute('href') || '';
      // The colliding default title is auto-uniquified so the new map won't be
      // hidden by Home's title-based dedup.
      expect(href).toContain(`title=${encodeURIComponent('새 마인드맵_1')}`);
      expect(href).toContain('new=1');
    });

    it('new-map link keeps the plain default title when no "새 마인드맵" exists', async () => {
      const { container } = renderHomeWithDocStore([
        { id: 'other', title: '기획 회의', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', isFavorite: false, deletedAt: null },
      ]);
      await waitFor(() => expect(container.querySelector('a[data-title="기획 회의"]')).toBeTruthy());
      const newLink = Array.from(container.querySelectorAll('a')).find((a) => (a.textContent || '').includes('＋ 새로 만들기')) as HTMLAnchorElement;
      const href = newLink.getAttribute('href') || '';
      // No collision → the title param is either absent or the plain default.
      expect(href).not.toContain('_1');
    });

    it('shows a loading skeleton (not the empty state) while DocStore.list() is pending', async () => {
      // A docStore whose list() never resolves within the test — the grid must
      // show its skeleton, not flash the "아직 만든 맵이 없어요" empty state.
      class PendingDocStore extends MockDocStore {
        override list(): Promise<DocMeta[]> {
          return new Promise<DocMeta[]>(() => {}); // never resolves
        }
      }
      const backend: Backend = { auth: new LocalAuth(), docStore: new PendingDocStore(), spaceStore: new LocalSpaceStore(), mode: 'local' };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(container.querySelectorAll('.mf-skel').length).toBeGreaterThan(0);
      expect(screen.queryByText('아직 만든 맵이 없어요')).toBeNull();
    });
  });

  describe('cross-device first-login workspace race', () => {
    // Reproduces the reported bug: logging in on a new PC showed ONLY the default
    // 일반 공간; other spaces appeared only after a manual browser refresh. Cause:
    // the mount hydrate ran before Supabase applied the session token, so the
    // first RLS-scoped read came back empty. Fix: re-hydrate once auth confirms a
    // session (onAuthChange), which is the automatic equivalent of that refresh.

    /** SpaceStore whose FIRST `load()` returns null (the racing pre-session read)
     * and every later call returns the real workspace (post-session read). */
    class RacySpaceStore implements SpaceStore {
      calls = 0;
      constructor(private full: WorkspaceData) {}
      async load(): Promise<WorkspaceData | null> {
        this.calls += 1;
        return this.calls === 1 ? null : this.full;
      }
      async save(): Promise<void> {
        /* no-op */
      }
    }

    /** Auth that emits a confirmed session shortly after subscription — mirrors
     * Supabase firing INITIAL_SESSION/SIGNED_IN once the client has initialized. */
    class RacyAuth extends LocalAuth {
      override onAuthChange(listener: (s: { user: { id: string; email: string | null } } | null) => void): () => void {
        const un = super.onAuthChange(listener);
        setTimeout(() => listener({ user: { id: 'u1', email: 'a@b.com' } }), 0);
        return un;
      }
    }

    it('re-hydrates when auth confirms a session, so all spaces show without a manual refresh', async () => {
      const full: WorkspaceData = {
        spaces: [
          { id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [] },
          { id: 's2', name: '업무 공간', color: '#3f8fd0', maps: [] },
        ],
        mapFolders: {},
      };
      const spaceStore = new RacySpaceStore(full);
      const backend: Backend = { auth: new RacyAuth(), docStore: new MockDocStore([]), spaceStore, mode: 'supabase' };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );
      const sidebar = () => within(container.querySelector('aside') as HTMLElement);

      // The racing first read saw no custom spaces — only the default 일반 공간.
      await waitFor(() => expect(sidebar().getByText('일반 공간')).toBeTruthy());

      // …then the auth-confirmed resync pulls the real workspace automatically.
      await waitFor(() => expect(sidebar().getByText('업무 공간')).toBeTruthy());
      expect(spaceStore.calls).toBeGreaterThanOrEqual(2);
    });

    it('card preview resolves even when spaces re-hydrate mid-prefetch (no stuck loading skeleton)', async () => {
      // Repro of the reported "미리보기가 계속 로딩" on a new PC: the preview
      // prefetch's `docStore.load` batch was in flight when a SECOND spaces
      // setState (the late mount hydrate landing after the auth resync, same
      // content/new identity) re-ran the effect — whose cleanup cancelled the
      // batch before it set `previewResolved`, so the card was stranded on the
      // skeleton until a full remount (opening the map and coming back).
      function defer<T = void>() {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((r) => {
          resolve = r;
        });
        return { promise, resolve };
      }
      const docId = 'doc-race-1';
      const full: WorkspaceData = { spaces: [{ id: 'general', name: '일반 공간', home: true, color: '#f0663f', maps: [{ title: '내 맵', docId }] }], mapFolders: {} };
      const body: LoadedDoc = {
        doc: { v: 1, nodes: { root: { id: 'root', text: '루트', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' } as unknown as LoadedDoc['doc'],
        version: 1,
        title: '내 맵',
      };

      // Mount workspace load is gated so it lands AFTER the resync; both return `full`.
      const mountGate = defer<WorkspaceData>();
      const spaceStore: SpaceStore = {
        calls: 0,
        async load() {
          this.calls += 1;
          return this.calls === 1 ? mountGate.promise : full;
        },
        async save() {},
      } as SpaceStore & { calls: number };

      // Doc body load is gated so the prefetch is still in flight when the late
      // mount hydrate re-runs the prefetch effect.
      const loadGate = defer<void>();
      const docStore: DocStore = {
        list: async () => [{ id: docId, title: '내 맵' } as DocMeta],
        load: async (id: string) => {
          await loadGate.promise;
          return id === docId ? body : null;
        },
        save: vi.fn(async () => ({ ok: true, version: 1 })),
        setFavorite: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        restore: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
      } as unknown as DocStore;

      const backend: Backend = { auth: new RacyAuth(), docStore, spaceStore, mode: 'supabase' };
      render(
        <MemoryRouter initialEntries={['/home']}>
          <BackendProvider backend={backend}>
            <Routes>
              <Route path="/home" element={<Home />} />
            </Routes>
          </BackendProvider>
        </MemoryRouter>,
      );

      // Resync (call 2) returns immediately → the card shows, preview still loading (body gated).
      await waitFor(() => expect(screen.getByText('내 맵')).toBeTruthy());
      const thumb = () => (screen.getByText('내 맵').closest('.map-card') as HTMLElement).querySelector('.map-thumb') as HTMLElement;
      expect(thumb().querySelector('.mf-skel')).toBeTruthy(); // loading skeleton

      // The late mount workspace load lands → a second spaces setState re-runs the
      // prefetch effect (this is what used to cancel the in-flight batch).
      await act(async () => {
        mountGate.resolve(full);
        await Promise.resolve();
      });
      // Release the doc body → the (previously cancelled) prefetch must still apply.
      await act(async () => {
        loadGate.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(thumb().querySelector('svg')).toBeTruthy(); // real preview rendered
        expect(thumb().querySelector('.mf-skel')).toBeNull(); // skeleton cleared
      });
    });
  });
});

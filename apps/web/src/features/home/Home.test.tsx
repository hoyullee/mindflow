import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Home } from './Home';
import { mockMatchMedia } from '../../test/matchMedia';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import type { Backend, DocMeta, DocStore, LoadedDoc, SaveResult } from '../../adapters/ports';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
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
  load = vi.fn(async (): Promise<LoadedDoc | null> => null);

  constructor(private metas: DocMeta[] = []) {}

  async list(): Promise<DocMeta[]> {
    return this.metas;
  }
}

function renderHomeWithDocStore(metas: DocMeta[] = []) {
  const docStore = new MockDocStore(metas);
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
    expect(sidebar.getByText('일반 공간')).toBeTruthy();

    // toolbar / main. With no saved maps the grid shows its empty state (after
    // the initial DocStore.list() settles — until then it shows a skeleton), so
    // "＋ 새로 만들기" appears both in the toolbar and the empty-state CTA.
    expect(screen.getByPlaceholderText('파일 검색')).toBeTruthy();
    expect(screen.getAllByText('＋ 새로 만들기').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('아직 만든 맵이 없어요')).toBeTruthy());
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

  describe('mobile (M6)', () => {
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

        await user.click(screen.getByRole('button', { name: '메뉴 닫기' }));
        expect(container.querySelector('aside')).toBeNull();
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
});

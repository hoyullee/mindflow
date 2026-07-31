import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
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
  return { backend: { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), mode } as Backend, save };
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
    // 미니맵도 준비 전에는 내용 없는 홀딩 박스 — 시드 지오메트리로 점을
    // 그렸다가 실문서 도착 후 튀는 깜빡임 방지.
    expect(container.querySelector('[data-minimap-holding]')).toBeTruthy();

    // body arrives → the real tree renders, spinner gone
    await act(async () => {
      resolveLoad({ doc: REAL_DOC as unknown as LoadedDoc['doc'], version: 3, title: '실제 루트' });
      await gate;
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('불러오는 중')).toBeNull();
      expect(within(vp).getByText('실제 루트')).toBeTruthy();
      expect(within(vp).getByText('실제 자식')).toBeTruthy();
      // 준비 완료 → 미니맵 홀딩 박스가 실제 미니맵으로 교체된다
      expect(container.querySelector('[data-minimap-holding]')).toBeNull();
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

  // ---- 저장 상태 칩 + 신규 문서 시드 저장 ----

  it("brand-new map: chip is honest (저장 전 → 저장됨) and the seed is persisted once the load confirms there's no row", async () => {
    localStorage.clear();
    let resolveLoad!: (v: LoadedDoc | null) => void;
    const gate = new Promise<LoadedDoc | null>((r) => {
      resolveLoad = r;
    });
    const { backend, save } = makeBackend(vi.fn(async () => gate), 'local');
    renderEditor(backend, '/editor?map=new-t1&new=1&title=새 마인드맵');

    // Load unresolved: this doc has never been saved anywhere → the chip must
    // NOT claim '저장됨', and the data-loss guard still forbids any write.
    expect(screen.getByText('저장 전')).toBeTruthy();
    expect(screen.queryByText('저장됨')).toBeNull();
    expect(save).not.toHaveBeenCalled();

    // Backend confirms brand-new (null) → the seed is persisted immediately, so
    // '저장됨' is now the truth (and browser-back from an untouched new map
    // leaves a real body behind for the Home card preview).
    await act(async () => {
      resolveLoad(null);
      await gate;
    });
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
    const call = save.mock.calls[0] as unknown as [string, { nodes: Record<string, { text: string }> }];
    expect(call[0]).toBe('new-t1');
    expect(call[1].nodes.root?.text).toBe('새 마인드맵');
    // …and the local recovery copy exists too (what Home's preview reads in local mode)
    const cached = JSON.parse(localStorage.getItem('mindflow_doc_new-t1') || 'null') as { nodes?: Record<string, { text?: string }> } | null;
    expect(cached?.nodes?.root?.text).toBe('새 마인드맵');
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

    // load still in flight → no write may have happened; the chip doesn't claim
    // '저장됨' either (no local body, backend state unknown → '저장 전')
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('저장 전')).toBeTruthy();

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
    // the doc now mirrors the stored truth → the chip flips to a truthful '저장됨'
    await waitFor(() => expect(screen.getByText('저장됨')).toBeTruthy());
  });

  // 제보 후속: 신규 기기에서 **기존 카드**를 열면, 백엔드에 행이 없다는 이유로
  // 에디터가 "새 맵"으로 보고 빈 seed를 저장했다. 그러면 그 빈 문서가 정본이 되고,
  // 본문을 가진 기기가 다음에 열 때 그것을 내려받아 로컬 본문까지 덮었다.
  // 새로 만들기 링크만 `new=1`을 붙이므로(`newMapHref`) 그것으로 구분한다.
  describe('본문이 다른 기기에만 있는 맵 (new=1 없음 + 행 없음 + 로컬 본문 없음)', () => {
    it('빈 문서를 저장하지 않고, 에디터 대신 전용 안내 화면을 띄운다', async () => {
      localStorage.clear();
      const { backend, save } = makeBackend(vi.fn(async () => null), 'supabase');
      const { container } = renderEditor(backend, '/editor?map=m-legacy&title=옛날 맵'); // 홈의 기존 카드 링크(new=1 없음)

      await waitFor(() => expect(screen.getByText('이 맵을 열 수 없어요')).toBeTruthy());
      // 어떤 쓰기도 없어야 한다 — 이게 손실을 막는 핵심이다.
      expect(save).not.toHaveBeenCalled();
      expect(localStorage.getItem('mindflow_doc_m-legacy')).toBeNull();
      // 제보: 편집은 막혀 있었지만 툴바·메뉴가 그대로 노출돼 "우회되는 것처럼" 보였다.
      // 이제 에디터 크롬 자체가 없다 — 캔버스도, 저장 칩도, 도구도.
      expect(container.querySelector('.mf-ed-vp')).toBeNull();
      expect(screen.queryByText('저장 전')).toBeNull();
      expect(screen.queryByText('저장됨')).toBeNull();
      expect(screen.queryByRole('button', { name: '공유' })).toBeNull();
      // 나갈 길은 있다.
      expect(screen.getByRole('link', { name: '내 맵으로 가기' }).getAttribute('href')).toBe('/home');
    });

    it('편집을 시도해도 저장하지 않는다', async () => {
      localStorage.clear();
      const { backend, save } = makeBackend(vi.fn(async () => null), 'supabase');
      renderEditor(backend, '/editor?map=m-legacy2&title=옛날 맵');
      await waitFor(() => expect(screen.getByText('이 맵을 열 수 없어요')).toBeTruthy());

      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      await new Promise((r) => setTimeout(r, 60));
      expect(save).not.toHaveBeenCalled();
    });

    it('로컬 본문이 있으면(원래 기기) 종전대로 올린다 — 안내를 띄우지 않는다', async () => {
      localStorage.clear();
      localStorage.setItem('mindflow_doc_m-mine', JSON.stringify(REAL_DOC));
      const { backend, save } = makeBackend(vi.fn(async () => null), 'supabase');
      renderEditor(backend, '/editor?map=m-mine&title=실제 루트');

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('이 맵을 열 수 없어요')).toBeNull();
      const call = save.mock.calls[0] as unknown as [string, { nodes: Record<string, { text: string }> }];
      expect(call[1].nodes.root?.text).toBe('실제 루트'); // 빈 seed가 아니라 그 본문
    });

    it('새로 만들기(new=1)는 종전대로 seed를 저장한다', async () => {
      localStorage.clear();
      const { backend, save } = makeBackend(vi.fn(async () => null), 'supabase');
      renderEditor(backend, '/editor?map=new-fresh&new=1&title=새 마인드맵');

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('이 맵을 열 수 없어요')).toBeNull();
    });
  });

  it('after an async load adopts the real doc, Undo rebases onto it and never reverts to the empty seed', async () => {
    localStorage.clear();
    let resolveLoad!: (v: LoadedDoc | null) => void;
    const gate = new Promise<LoadedDoc | null>((r) => {
      resolveLoad = r;
    });
    const { backend } = makeBackend(vi.fn(async () => gate), 'supabase');
    const { container } = renderEditor(backend, '/editor?map=undo1&title=제목');
    const vp = () => container.querySelector('.mf-ed-vp') as HTMLElement;
    const nodeBoxes = () => vp().querySelectorAll('[data-node-id]').length;

    // Real doc arrives → adopted. The history baseline was seeded at mount from the
    // empty placeholder; the adopt must rebase it onto the loaded doc.
    await act(async () => {
      resolveLoad({ doc: REAL_DOC as unknown as LoadedDoc['doc'], version: 3, title: '실제 루트' });
      await gate;
    });
    await waitFor(() => expect(within(vp()).getByText('실제 루트')).toBeTruthy());
    const before = nodeBoxes();

    // Make a discrete structural edit (Tab on the selected root adds a child).
    const rootBox = within(vp()).getByText('실제 루트').closest('[data-node-id]') as HTMLElement;
    fireEvent.pointerDown(rootBox, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Tab' });
    await waitFor(() => expect(nodeBoxes()).toBe(before + 1));
    // leave the child's text editor (undo is a no-op while a node editor has focus)
    const editing = vp().querySelector('.mf-richedit') as HTMLDivElement;
    fireEvent.keyDown(editing, { key: 'Escape' });
    await waitFor(() => expect(vp().querySelector('.mf-richedit')).toBeNull());

    // Undo: must return to the LOADED doc (child removed) — NOT past it to the empty seed.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(nodeBoxes()).toBe(before));
    // the real map is intact...
    expect(within(vp()).getByText('실제 루트')).toBeTruthy();
    expect(within(vp()).getByText('실제 자식')).toBeTruthy();
    // ...and the empty placeholder ("제목"/"새 마인드맵") was never restored
    expect(within(vp()).queryByText('제목')).toBeNull();
    expect(within(vp()).queryByText('새 마인드맵')).toBeNull();

    // A further Undo has nothing to revert into (baseline = loaded doc): still intact.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(within(vp()).getByText('실제 자식')).toBeTruthy());
    expect(nodeBoxes()).toBe(before);
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

// 제보(Supabase 로그): `42501 ... row-level security policy (USING expression)`이
// 자동저장마다 반복됐다. 원인은 "행이 없다"와 "행은 있는데 RLS가 가려 안 보인다"가
// 똑같이 빈 결과라는 것 — 에디터가 남의 문서를 신규로 오해하고 그 id에 강제로 썼다.
// 이제 어댑터가 `idTaken`으로 알려 주고, 에디터는 **새 id로 옮겨 저장**한다.
describe('다른 계정이 쓰던 id로 저장하려 할 때 — 새 id로 옮겨 저장', () => {
  /** 첫 저장은 `idTaken`, 새 id로의 저장은 성공하는 스토어. */
  function makeTakenBackend() {
    const saved: { id: string; version: number }[] = [];
    const save = vi.fn(async (id: string) => {
      if (id === 'm-legacy') return { ok: false as const, reason: 'idTaken' as const };
      saved.push({ id, version: 1 });
      return { ok: true as const, version: 1 };
    });
    const docStore = {
      list: async () => [],
      load: async () => null, // RLS에 가려 빈 결과 — 신규처럼 보인다
      setFavorite: async () => undefined,
      remove: async () => undefined,
      restore: async () => undefined,
      rename: async () => undefined,
      save,
    } as unknown as DocStore;
    const spaceStore = new LocalSpaceStore();
    return { backend: { auth: new LocalAuth(), docStore, spaceStore, shareStore: new LocalShareStore(), mode: 'supabase' } as Backend, save, saved, spaceStore };
  }

  it('옛 id 저장이 막히면 새 id로 옮겨 저장하고, 그 뒤 저장은 새 id로 나간다', async () => {
    localStorage.clear();
    // 로컬 본문이 있어야 "본문이 다른 기기에 있다" 가드를 지나 저장까지 간다(제보 상황).
    localStorage.setItem('mindflow_doc_m-legacy', JSON.stringify(REAL_DOC));
    const { backend, save, saved } = makeTakenBackend();
    renderEditor(backend, '/editor?map=m-legacy&title=%EA%B3%84%ED%9A%8D');

    await waitFor(() => expect(saved.length).toBe(1));
    const newId = saved[0]!.id;
    expect(newId).not.toBe('m-legacy');
    expect(newId.startsWith('new-')).toBe(true);
    // 옛 id로는 딱 한 번만 시도했다 — 반복해서 남의 행을 두드리지 않는다.
    expect(save.mock.calls.filter((c) => c[0] === 'm-legacy').length).toBe(1);
    // 새 id에 본문이 로컬 캐시로도 남는다(복구본).
    await waitFor(() => expect(localStorage.getItem(`mindflow_doc_${newId}`)).toBeTruthy());
  });

  it('옮겨 갔음을 배너로 알린다', async () => {
    localStorage.clear();
    localStorage.setItem('mindflow_doc_m-legacy', JSON.stringify(REAL_DOC));
    const { backend } = makeTakenBackend();
    renderEditor(backend, '/editor?map=m-legacy&title=x');

    // 전광판(mf-marquee)은 같은 문장을 두 번 그린다 — findAll로 받는다.
    expect((await screen.findAllByText(/새 문서로 옮겨 저장했어요/)).length).toBeGreaterThan(0);
  });

  it('홈 카드(레거시: docId 없음)가 새 id를 가리키도록 재바인딩된다', async () => {
    localStorage.clear();
    localStorage.setItem('mindflow_doc_m-legacy', JSON.stringify(REAL_DOC));
    const { backend, saved, spaceStore } = makeTakenBackend();
    // 제목 해시가 'm-legacy'인 카드를 흉내낼 수 없으므로 docId로 매칭되는 카드를 둔다.
    await spaceStore.save({ spaces: [{ id: 'g', name: '일반', maps: [{ title: '계획', when: '', hue: '#f0663f', docId: 'm-legacy' }] }], mapFolders: { 'm-legacy': 'f1' }, recent: ['m-legacy'] });
    renderEditor(backend, '/editor?map=m-legacy&title=x');

    await waitFor(() => expect(saved.length).toBe(1));
    const newId = saved[0]!.id;
    await waitFor(async () => {
      const ws = await spaceStore.load();
      const maps = (ws?.spaces?.[0] as { maps: { docId?: string }[] } | undefined)?.maps ?? [];
      expect(maps[0]?.docId).toBe(newId);
      expect(ws?.mapFolders).toEqual({ [newId]: 'f1' });
      expect(ws?.recent).toEqual([newId]);
    });
  });
});

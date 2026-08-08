// 실시간이 끊긴 채 양쪽이 편집할 때의 안전장치(질문에서 드러난 구멍).
//
// 서버는 CRDT 로그가 아니라 **최종 본문**만 보관한다. 그래서 연결이 끊긴 채 A와 B가
// 각각 편집하면 두 문서가 갈라지고, 나중에 저장한 쪽이 상대의 작업을 통째로 덮는다.
// 예전엔 #320의 "협업 중 충돌은 경고가 아니다" 규칙이 **연결 여부를 보지 않아**, 끊긴
// 상태의 충돌까지 조용히 덮어썼다.
//
// 규칙 셋:
//  ① 충돌을 조용히 덮어쓰는 건 **지금 실시간이 붙어 있을 때만**(그때만 수렴이 보장된다).
//  ② 공유 맵에서 끊기면 **즉시** 편집을 멈춘다 — 재연결하면 수렴은 하지만 같은 대상을
//     상대도 건드렸으면 한쪽이 사라진다(core `crdt/divergence.test.ts`가 그 규칙을 고정).
//  ③ 끊김이 오래가면 배너에서 전체 안내(새로고침)로 승격한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Doc } from '@mindflow/mindmap-core';
import type { CollabProvider, CollabStatusListener } from '../../collab/ports';
import type { Backend, DocStore, SaveResult, ShareStore } from '../../adapters/ports';

/** 실시간 전송을 테스트가 조종한다 — 상태(연결/끊김)를 마음대로 바꿀 수 있어야 한다. */
const transport = {
  status: 'connected' as 'connected' | 'offline',
  emit: null as CollabStatusListener | null,
  ydoc: null as { getMap: (k: string) => { set: (k: string, v: unknown) => void } } | null,
};
vi.mock('../../collab/factory', () => ({
  createCollabProvider: (): CollabProvider => ({
    connect: (_docId: string, ydoc: unknown, onStatus?: CollabStatusListener) => {
      transport.emit = onStatus ?? null;
      transport.ydoc = ydoc as typeof transport.ydoc;
      onStatus?.(transport.status);
    },
    disconnect: () => {
      transport.emit = null;
    },
    getAwareness: () => null,
  }),
}));

const { Editor } = await import('./Editor');
const { BackendProvider } = await import('../../adapters/BackendContext');
const { LocalAuth } = await import('../../adapters/local/localAuth');
const { LocalSpaceStore } = await import('../../adapters/local/localSpaceStore');
const { LocalFeedbackStore } = await import('../../adapters/local/localFeedbackStore');
const { LocalCommentStore } = await import('../../adapters/local/localCommentStore');
const { LocalImageStore } = await import('../../adapters/local/localImageStore');

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

/** 공유된 맵(초대 목록에 행이 있다) — `sharedDoc` 판별의 근거. */
function shareStore(rows: { email: string; role: 'edit' | 'view' }[]): ShareStore {
  return {
    list: async () => rows.map((r) => ({ ...r, invitedAt: new Date().toISOString() })),
    add: async () => undefined,
    remove: async () => undefined,
    participants: async () => null,
    listSharedWithMe: async () => [],
  } as unknown as ShareStore;
}

function makeBackend(results: SaveResult[], rows: { email: string; role: 'edit' | 'view' }[] = [{ email: 'peer@e.com', role: 'edit' }]) {
  let i = 0;
  const save = vi.fn(async (): Promise<SaveResult> => results[i++] ?? { ok: true, version: 9 });
  const docStore = {
    list: async () => [],
    load: async () => ({ doc: DOC, version: 1, title: '제품 로드맵' }),
    loadPreview: async () => null,
    listEditorNames: async () => ({}),
    setFavorite: async () => undefined,
    remove: async () => undefined,
    restore: async () => undefined,
    purge: async () => undefined,
    rename: async () => undefined,
    save,
  } as unknown as DocStore;
  // mode 'supabase' — 협업 경고/멈춤은 실제로 붙을 대상이 있는 모드에서만 뜻이 있다.
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: shareStore(rows), feedbackStore: new LocalFeedbackStore(), imageStore: new LocalImageStore(), commentStore: new LocalCommentStore(), mode: 'supabase' };
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

/** 자동저장(0.9초 디바운스)을 기다리지 않고 지금 저장한다 — 여기서 검증할 규칙은
 * 충돌 해석이지 디바운스가 아니고, 부하가 걸린 CI에서는 그 대기가 테스트 제한(5초)을
 * 넘겨 깨졌다. */
function saveNow(): void {
  fireEvent.keyDown(window, { key: 's', ctrlKey: true });
}

function edit(container: HTMLElement): void {
  const vp = getViewport(container);
  const label = within(vp).getByText('리서치');
  fireEvent.pointerDown(label, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(label, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.keyDown(window, { key: 'Tab' }); // 자식 추가
}

/** 상대의 편집이 도착한 것처럼 Y.Doc을 밖에서 건드린다 — 이 세션이 "함께 편집했다"고
 * 기억하게 만드는 유일한 신호다(`onRemoteDoc` → `collabSessionRef`). */
function remoteEdit(): void {
  act(() => {
    transport.ydoc?.getMap('meta').set('themeKey', 'ocean');
  });
}

/** 공유 판별(`shareStore.list`)은 비동기다 — 유예 타이머를 재기 전에 끝내 둔다. */
async function settleShare(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setStatus(status: 'connected' | 'offline'): void {
  transport.status = status;
  act(() => {
    transport.emit?.(status);
  });
}

beforeEach(() => {
  localStorage.clear();
  // 공유 판별(`shareStore.list`의 내 행)은 로그인 사용자가 있어야 돈다.
  localStorage.setItem('mf_demo_session', JSON.stringify({ user: { id: 'u', email: 'me@e.com' } }));
  transport.status = 'connected';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('실시간이 끊긴 채 편집할 때', () => {
  it('끊긴 상태의 저장 충돌은 조용히 덮어쓰지 않는다 — 상대 작업이 사라진다', async () => {
    const { backend, save } = makeBackend([{ ok: false, reason: 'conflict', currentVersion: 7 } as SaveResult]);
    const { container } = renderEditor(backend, 'div1');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    remoteEdit(); // 같이 편집 중이었다 — 그런데 지금은 끊겼다
    setStatus('offline');
    save.mockClear();

    edit(container);
    saveNow();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 4000 });

    // 두 번째 쓰기(덮어쓰기)를 시도하지 않고, 사용자에게 알린다.
    await waitFor(() => expect(screen.getAllByText(/다른 기기\/탭에서 먼저 저장됨/).length).toBeGreaterThan(0));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('붙어 있을 때의 충돌은 예전처럼 조용히 한 번 더 쓴다(수렴이 보장된다 — 무회귀)', async () => {
    const { backend, save } = makeBackend([{ ok: false, reason: 'conflict', currentVersion: 7 } as SaveResult, { ok: true, version: 8 } as SaveResult]);
    const { container } = renderEditor(backend, 'div2');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    setStatus('connected');
    remoteEdit(); // 상대 편집이 한 번 도착 = 같이 편집 중인 세션
    save.mockClear();

    edit(container);
    saveNow();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(screen.queryAllByText(/다른 기기\/탭에서 먼저 저장됨/)).toHaveLength(0);
  });

  it('공유 맵에서 끊기면 **즉시** 편집이 멈춘다(유실 창을 열지 않는다)', async () => {
    const { backend } = makeBackend([]);
    const { container } = renderEditor(backend, 'div3');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    const before = getViewport(container).querySelectorAll('[data-node-id]').length;
    await settleShare();

    setStatus('offline');

    // 유예 없음 — 그 즉시 문서 변이가 chokepoint에서 막힌다.
    edit(container);
    expect(getViewport(container).querySelectorAll('[data-node-id]').length).toBe(before);
    // 짧은 끊김은 얇은 배너로만 알린다(화면 전체를 덮지 않는다).
    expect(screen.getByText(/연결이 끊겨 편집을 잠시 멈췄어요/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '공동 편집 연결 끊김' })).toBeNull();
  });

  it('끊김이 오래가면 배너에서 전체 안내(새로고침)로 승격한다', async () => {
    const { backend } = makeBackend([]);
    const { container } = renderEditor(backend, 'div3b');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    await settleShare();

    // 가짜 타이머는 **끊김을 알리기 전에** 켜야 한다 — 승격 타이머가 그 뒤에 잡힌다.
    vi.useFakeTimers();
    setStatus('offline');
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    vi.useRealTimers();

    expect(screen.getByRole('dialog', { name: '공동 편집 연결 끊김' })).toBeTruthy();
    expect(screen.queryByText(/연결이 끊겨 편집을 잠시 멈췄어요/)).toBeNull(); // 두 겹으로 알리지 않는다
  });

  it('다시 연결되면 멈춤이 풀린다(새로고침을 강요하지 않는다)', async () => {
    const { backend } = makeBackend([]);
    const { container } = renderEditor(backend, 'div4');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    const before = getViewport(container).querySelectorAll('[data-node-id]').length;

    await settleShare();
    vi.useFakeTimers();
    setStatus('offline');
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    vi.useRealTimers();
    expect(screen.getByRole('dialog', { name: '공동 편집 연결 끊김' })).toBeTruthy();

    setStatus('connected');
    expect(screen.queryByRole('dialog', { name: '공동 편집 연결 끊김' })).toBeNull();
    edit(container);
    expect(getViewport(container).querySelectorAll('[data-node-id]').length).toBe(before + 1);
  });

  it('혼자 쓰는 맵은 끊겨도 멈추지 않는다 — 갈라질 상대가 없다', async () => {
    const { backend } = makeBackend([], []); // 초대 목록이 비어 있다
    const { container } = renderEditor(backend, 'div5');
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    const before = getViewport(container).querySelectorAll('[data-node-id]').length;

    await settleShare();
    vi.useFakeTimers();
    setStatus('offline');
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    vi.useRealTimers();

    expect(screen.queryByRole('dialog', { name: '공동 편집 연결 끊김' })).toBeNull();
    expect(screen.queryByText(/연결이 끊겨 편집을 잠시 멈췄어요/)).toBeNull();
    edit(container);
    expect(getViewport(container).querySelectorAll('[data-node-id]').length).toBe(before + 1);
  });
});

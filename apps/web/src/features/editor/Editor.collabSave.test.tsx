// 협업 중 **저장 책임**과 **충돌 해석** — 실계정 두 명의 제보에서 나온 회귀 가드.
//
// 제보한 흐름: A(소유자)와 B가 같은 맵을 열고 B가 편집했더니 ① 저장은 A가 실행되고
// ② B에게 "다른 기기/탭에서 먼저 저장됨" 경고가 떴다.
//
// 원인은 자동저장이 `doc`의 **모든** 변화를 자기 변경으로 보던 것: 상대의 편집이
// CRDT로 도착해 `setDoc`되면 받은 쪽도 저장을 걸어, 같은 행에 두 명이 쓰고 서로의
// 버전을 밀어냈다(그 결과 `updated_by`도 편집하지 않은 사람으로 찍혔다).
//
// 규칙: **편집한 쪽이 저장한다.** 받은 쪽은 저장하지 않고, 상대가 저장 전에 떠나면
// 남은 쪽이 인수한다. 협업 중 발생한 충돌은 같은 세션의 동시 저장이므로 경고 없이
// 새 버전 기준으로 한 번 더 쓴다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import { ROOT_ID, addNode, setNodeField, type Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { BroadcastChannelProvider } from '../../collab/BroadcastChannelProvider';
import { BackendProvider } from '../../adapters/BackendContext';
import { LocalAuth } from '../../adapters/local/localAuth';
import { LocalSpaceStore } from '../../adapters/local/localSpaceStore';
import { LocalShareStore } from '../../adapters/local/localShareStore';
import { LocalFeedbackStore } from '../../adapters/local/localFeedbackStore';
import type { Backend, DocStore, SaveResult } from '../../adapters/ports';

const DOC: Doc = {
  v: 1,
  nodes: {
    root: { id: 'root', text: '제품 로드맵', emoji: '🎯', parent: null, children: ['c1'], collapsed: false, color: null, x: 0, y: 0 },
    c1: { id: 'c1', text: '리서치', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 },
  },
  floats: [],
  lines: [],
  zones: [],
  layoutMode: 'radial',
  themeKey: 'coral',
};

/** 저장 호출을 들여다볼 수 있는 백엔드. `save`는 테스트가 정한 결과를 돌려준다. */
function makeBackend(results: SaveResult[] = []) {
  let i = 0;
  const save = vi.fn(async (): Promise<SaveResult> => results[i++] ?? { ok: true, version: 1 });
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
  const backend: Backend = { auth: new LocalAuth(), docStore, spaceStore: new LocalSpaceStore(), shareStore: new LocalShareStore(), feedbackStore: new LocalFeedbackStore(), mode: 'local' };
  return { backend, save };
}

function renderEditor(backend: Backend, docId: string) {
  return render(
    <MemoryRouter initialEntries={[`/editor?map=${docId}&title=x`]}>
      <BackendProvider backend={backend}>
        <Routes>
          <Route path="/editor" element={<Editor />} />
          <Route path="/home" element={<div>HOME_PAGE</div>} />
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

/** "다른 탭"의 피어 — 자기 Y.Doc + 같은 방의 provider. awareness에 상태를 심어야
 * 상대(에디터) 쪽에 접속자로 보인다(빈 기본 상태는 clock 0이라 적용되지 않는다). */
async function joinPeer(docId: string, announce = true) {
  const ydoc = new Y.Doc();
  const provider = new BroadcastChannelProvider();
  provider.connect(docId, ydoc);
  if (announce) {
    const aw = provider.getAwareness();
    aw?.setLocalStateField('user', { name: '상대', color: '#3f8fd0' });
  }
  await waitFor(() => expect(ydoc.getMap('nodes').has(ROOT_ID)).toBe(true));
  return { ydoc, provider };
}

/** 피어가 노드를 하나 추가한다(= 상대의 편집). */
function peerAddsNode(ydoc: Y.Doc, id: string, text: string) {
  const rootY = ydoc.getMap('nodes').get(ROOT_ID) as Y.Map<unknown>;
  const children = (rootY.get('children') as string[] | undefined) ?? [];
  addNode(ydoc, id, { id, text, emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 260, y: 260 });
  setNodeField(ydoc, ROOT_ID, 'children', [...children, id]);
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('협업 중 저장 책임', () => {
  it('상대의 편집이 도착해도 받은 쪽은 저장하지 않는다 (제보: B가 편집했는데 A가 저장됨)', async () => {
    const docId = `save-remote-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    save.mockClear(); // 마운트 시드 저장은 이 테스트의 관심이 아니다

    const { ydoc } = await joinPeer(docId);
    peerAddsNode(ydoc, 'remoteChild', '원격 노드');

    // 상대의 편집은 화면에 반영된다 …
    await waitFor(() => expect(within(getViewport(container)).getByText('원격 노드')).toBeTruthy());
    // … 하지만 저장은 상대가 한다. 자동저장 창(0.9s + 0.25s)을 넉넉히 넘겨 확인.
    await new Promise((r) => setTimeout(r, 1600));
    expect(save).not.toHaveBeenCalled();
    // 저장 표시도 흔들리지 않는다(내가 저장할 게 아니므로 "저장 안 됨"이 아니다).
    expect(screen.queryByText('저장 안 됨')).toBeNull();
  });

  it('내 편집은 그대로 저장한다 (무회귀)', async () => {
    const docId = `save-local-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    const vp = getViewport(container);
    await waitFor(() => expect(within(vp).getByText('리서치')).toBeTruthy());
    save.mockClear();

    // 노드 선택 → Tab(자식 추가) = 내 편집
    fireEvent.pointerDown(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Tab' });

    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('상대가 저장 전에 떠나면 남은 쪽이 인수해 저장한다 (안전망)', async () => {
    const docId = `save-handoff-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    save.mockClear();

    const peer = await joinPeer(docId);
    await waitFor(() => expect(screen.getByText(/명 접속 중/)).toBeTruthy());
    peerAddsNode(peer.ydoc, 'remoteChild', '원격 노드');
    await waitFor(() => expect(within(getViewport(container)).getByText('원격 노드')).toBeTruthy());
    expect(save).not.toHaveBeenCalled();

    // 상대가 창을 닫는다 — 저장하지 못한 그 편집은 이제 내 책임이다.
    peer.provider.disconnect();
    peer.ydoc.destroy();
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 4000 });
  });
});

describe('닫기·전환 직전 강제 저장', () => {
  /** 탭이 숨는 순간(전환·최소화·닫기 시작)을 흉내 낸다. */
  function hide() {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  function show() {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  }

  afterEach(show);

  it('자동저장(0.9초)을 기다리지 않고, 숨는 순간 내 편집을 저장한다', async () => {
    const docId = `hide-save-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    const vp = getViewport(container);
    await waitFor(() => expect(within(vp).getByText('리서치')).toBeTruthy());
    save.mockClear();

    // 편집하고 **곧바로** 숨는다(자동저장 타이머가 돌기 전).
    fireEvent.pointerDown(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Tab' });
    hide();

    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 1000 });
  });

  it('저장할 게 없으면 아무것도 쓰지 않는다', async () => {
    const docId = `hide-clean-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    save.mockClear();

    hide();
    await new Promise((r) => setTimeout(r, 300));
    expect(save).not.toHaveBeenCalled();
  });

  it('상대가 만든 상태는 숨을 때도 내가 저장하지 않는다 (수정자 이름이 틀리지 않게)', async () => {
    const docId = `hide-remote-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend();
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    save.mockClear();

    const { ydoc } = await joinPeer(docId);
    peerAddsNode(ydoc, 'remoteChild', '원격 노드');
    await waitFor(() => expect(within(getViewport(container)).getByText('원격 노드')).toBeTruthy());

    hide();
    await new Promise((r) => setTimeout(r, 300));
    expect(save).not.toHaveBeenCalled();
  });
});

describe('탭을 닫으면 즉시 떠났다고 알린다', () => {
  it('pagehide에서 내 awareness 상태를 지운다 (30초 타임아웃을 기다리지 않게)', async () => {
    const docId = `leave-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend } = makeBackend();
    const { container } = renderEditor(backend, docId);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    // 상대 입장에서 본다 — 에디터가 접속자로 보이다가, pagehide 뒤 사라진다.
    const peer = await joinPeer(docId);
    const peerAw = peer.provider.getAwareness();
    if (!peerAw) throw new Error('awareness 없음');
    const others = () => [...peerAw.getStates().entries()].filter(([id, st]) => id !== peerAw.clientID && !!(st as { user?: unknown } | null)?.user).length;
    await waitFor(() => expect(others()).toBe(1));

    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(others()).toBe(0));
  });
});

describe('협업 중 저장 충돌 해석', () => {
  it('같이 붙어 있는 사람이 있으면 경고 없이 새 버전으로 다시 쓴다', async () => {
    const docId = `conflict-collab-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    // 첫 저장은 충돌(상대가 방금 먼저 저장), 두 번째는 성공.
    const { backend, save } = makeBackend([
      { ok: false, reason: 'conflict', currentVersion: 7 },
      { ok: true, version: 8 },
    ]);
    const { container } = renderEditor(backend, docId);
    const vp = getViewport(container);
    await waitFor(() => expect(within(vp).getByText('리서치')).toBeTruthy());

    await joinPeer(docId);
    await waitFor(() => expect(screen.getByText(/명 접속 중/)).toBeTruthy());
    save.mockClear();

    fireEvent.pointerDown(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Tab' });

    // 충돌 → 새 버전(7)을 기준으로 한 번 더 쓴다.
    await waitFor(() => expect(save.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    const secondCall = save.mock.calls[1] as unknown as [string, Doc, { prevVersion?: number }] | undefined;
    expect(secondCall?.[2]?.prevVersion).toBe(7);
    // 그리고 사용자에게는 아무 경고도 띄우지 않는다.
    expect(screen.queryByText(/다른 기기\/탭에서 먼저 저장됨/)).toBeNull();
  });

  it('혼자일 때의 충돌은 예전처럼 알린다 (진짜 다른 기기/탭)', async () => {
    const docId = `conflict-solo-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { backend, save } = makeBackend([{ ok: false, reason: 'conflict', currentVersion: 5 }]);
    const { container } = renderEditor(backend, docId);
    const vp = getViewport(container);
    await waitFor(() => expect(within(vp).getByText('리서치')).toBeTruthy());
    save.mockClear();

    fireEvent.pointerDown(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(within(vp).getByText('리서치'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'Tab' });

    await waitFor(() => expect(screen.getAllByText(/다른 기기\/탭에서 먼저 저장됨/).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(save).toHaveBeenCalledTimes(1); // 재시도 없음
  });
});

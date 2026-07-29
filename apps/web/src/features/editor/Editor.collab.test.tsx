// M5 editor integration test: a REMOTE peer (its own Y.Doc + a second
// `BroadcastChannelProvider` connected to the same document id — modelling
// "another browser tab", exactly what the manual verification step in
// CLAUDE.md's M5 task brief exercises) edits the document, and the open
// `<Editor>` picks up the resulting Yjs update and re-renders with the new
// node — without going through this tab's own UI at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import { ROOT_ID, addNode, applyDocToYDoc, docToYDoc, setNodeField, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
import { Editor } from './Editor';
import { BroadcastChannelProvider } from '../../collab/BroadcastChannelProvider';

const DOC = {
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

function renderEditor(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/home" element={<div>HOME_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.mf-ed-vp');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Editor collaboration (M5)', () => {
  it("applies a remote peer's Yjs update (a brand-new node) into the currently-open document", async () => {
    const docId = `collab-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);

    // Confirm the editor's own initial render (before any remote edit).
    expect(within(getViewport(container)).getByText('리서치')).toBeTruthy();

    // "Another browser tab" for the same document: its own Y.Doc, joined to
    // the same BroadcastChannel room the editor's `useYjsDocSync` connected.
    const remoteYdoc = new Y.Doc();
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);

    // Wait for the remote peer to catch up with the editor's current state
    // (its provider's connect-time 'sync-request' round trip).
    await waitFor(() => expect(remoteYdoc.getMap('nodes').has(ROOT_ID)).toBe(true));
    const rootY = remoteYdoc.getMap('nodes').get(ROOT_ID) as Y.Map<unknown>;
    const currentChildren = (rootY.get('children') as string[] | undefined) ?? [];

    // The remote peer adds a new child node under root.
    addNode(remoteYdoc, 'remoteChild', { id: 'remoteChild', text: '원격 노드', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 260, y: 260 });
    setNodeField(remoteYdoc, ROOT_ID, 'children', [...currentChildren, 'remoteChild']);

    await waitFor(() => {
      expect(within(getViewport(container)).getByText('원격 노드')).toBeTruthy();
    });
    // The pre-existing node is still there — this was a merge, not a replace.
    expect(within(getViewport(container)).getByText('리서치')).toBeTruthy();

    remoteProvider.disconnect();
  });

  // 위 테스트의 원격 피어는 **빈** Y.Doc으로 들어온다 — 그건 실제로 잘 되던 유일한
  // 경우였다. 실제 사용자는 각자 백엔드에서 같은 문서를 받아 **자기 Y.Doc을 따로 심고**
  // 들어오는데, 그때는 두 피어의 연산 이력이 서로 달라서 편집이 오가지 않았다(제보:
  // "A가 편집한 내용이 B에게 보이지 않음, 반대도 동일, 마지막 사람 것만 저장됨").
  // 원인은 합류 시 **요청만 하고 내 상태는 보내지 않은** 반쪽 동기화였다.
  it('두 피어가 각자 자기 문서를 심고 들어와도 편집이 양방향으로 오간다 (제보한 그 증상)', async () => {
    const docId = `collab-both-seeded-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    // 상대도 같은 문서를 자기 Y.Doc에 심고 합류한다(= 다른 기기에서 같은 행을 열었다).
    const remoteYdoc = docToYDoc(DOC as unknown as Doc);
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);

    // ① 상대 → 나
    await waitFor(() => expect(remoteYdoc.getMap('nodes').has(ROOT_ID)).toBe(true));
    addNode(remoteYdoc, 'remoteChild', { id: 'remoteChild', text: '상대가 만든 노드', emoji: '', parent: ROOT_ID, children: [], collapsed: false, color: null, x: 260, y: 260 });
    setNodeField(remoteYdoc, ROOT_ID, 'children', ['c1', 'remoteChild']);
    await waitFor(() => expect(within(getViewport(container)).getByText('상대가 만든 노드')).toBeTruthy());

    // ② 나 → 상대 (에디터 UI로 실제 편집: 노드 선택 후 Tab = 하위 추가)
    const box = within(getViewport(container)).getByText('리서치').closest('[data-node-id]') as HTMLElement;
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(box, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.keyDown(window, { key: 'Tab' });

    await waitFor(() => {
      const texts = Object.values(yDocToDoc(remoteYdoc).nodes).map((n) => n.text);
      expect(texts).toContain('새 주제'); // 내가 추가한 노드가 상대 문서에 도착했다
    });
    // 상대 쪽에서도 문서가 온전하다 — 보류된 연산 때문에 필드가 빈 노드가 생기면
    // 레이아웃이 터졌었다(`children`이 배열이 아님).
    for (const n of Object.values(yDocToDoc(remoteYdoc).nodes)) expect(Array.isArray(n.children)).toBe(true);

    remoteProvider.disconnect();
  });

  it('양쪽이 같은 메모를 심고 만나도 메모가 두 개로 늘지 않는다', async () => {
    const docId = `collab-float-${Math.random()}`;
    const withMemo = { ...DOC, floats: [{ id: 'f1', kind: 'memo', text: '메모 하나', x: 300, y: 200, w: 180, h: 90, color: '#f7d67a' }] };
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(withMemo));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('메모 하나')).toBeTruthy());

    const remoteYdoc = docToYDoc(withMemo as unknown as Doc);
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);

    // 두 피어의 순서 배열에 같은 id가 두 번 들어간다(Y.Array는 삽입을 병합하지 않는다).
    // 읽을 때 id로 한 번만 내야 한다 — 안 그러면 화면과 저장본에서 메모가 계속 늘어난다.
    await waitFor(() => expect(remoteYdoc.getArray('floatsOrder').length).toBe(2)); // 순서 배열엔 둘
    expect(yDocToDoc(remoteYdoc).floats.length).toBe(1); // 읽으면 하나
    expect(within(getViewport(container)).getAllByText('메모 하나').length).toBe(1);

    remoteProvider.disconnect();
  });

  // 제보: 동시 편집 중 한 사람이 연결선 스타일(곡선↔직선)을 바꿔도 상대에게 반영되지
  // 않았다. 원인 두 곳: CRDT meta가 edgeStyle을 아예 나르지 않았고, 원격 문서가 와도
  // 에디터의 edgeStyle 로컬 미러가 갱신되지 않았다. 둘 다 이 테스트가 가드한다.
  it("상대가 바꾼 연결선 스타일이 이쪽 렌더(EdgeLayer)에 반영된다", async () => {
    const docId = `collab-edge-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());

    // 캔버스 안의 커넥터만 — 툴바의 브랜드 마크도 svg path라 컨테이너 전체로 찾으면 걸린다
    const edgeD = () => getViewport(container).querySelector('svg path[stroke]')?.getAttribute('d') ?? '';
    await waitFor(() => expect(edgeD()).not.toBe(''));
    expect(edgeD()).toContain('C'); // 기본 곡선 — 큐빅 세그먼트

    const remoteDoc = { ...DOC } as unknown as Doc;
    const remoteYdoc = docToYDoc(remoteDoc);
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);
    await waitFor(() => expect(remoteYdoc.getMap('nodes').has(ROOT_ID)).toBe(true));

    // 상대가 스타일 드롭다운에서 '직선'을 고른 것과 같은 diff
    applyDocToYDoc(remoteYdoc, { ...remoteDoc, edgeStyle: 'straight' }, remoteDoc);

    await waitFor(() => expect(edgeD()).not.toContain('C')); // 직선 = L 세그먼트만
    expect(edgeD()).toMatch(/^M .+ L .+$/);

    remoteProvider.disconnect();
  });

  it('shows no collaboration banner/crash when the document is opened solo (no peers) — single-user behavior is unchanged', async () => {
    const docId = `solo-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    expect(screen.queryByText(/충돌|conflict/i)).toBeNull();
  });
});

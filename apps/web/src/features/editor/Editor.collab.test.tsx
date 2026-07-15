// M5 editor integration test: a REMOTE peer (its own Y.Doc + a second
// `BroadcastChannelProvider` connected to the same document id — modelling
// "another browser tab", exactly what the manual verification step in
// CLAUDE.md's M5 task brief exercises) edits the document, and the open
// `<Editor>` picks up the resulting Yjs update and re-renders with the new
// node — without going through this tab's own UI at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import { ROOT_ID, addNode, setNodeField } from '@mindflow/mindmap-core';
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

  it('shows no collaboration banner/crash when the document is opened solo (no peers) — single-user behavior is unchanged', async () => {
    const docId = `solo-${Math.random()}`;
    localStorage.setItem(`mindflow_doc_${docId}`, JSON.stringify(DOC));
    const { container } = renderEditor(`/editor?map=${docId}&title=x`);
    await waitFor(() => expect(within(getViewport(container)).getByText('리서치')).toBeTruthy());
    expect(screen.queryByText(/충돌|conflict/i)).toBeNull();
  });
});

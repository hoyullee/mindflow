// Unit-level test for the hook in isolation (not through the whole
// `<Editor>` tree — see `features/editor/Editor.collab.test.tsx` for that).

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { addNode, setNodeField, type Doc } from '@mindflow/mindmap-core';
import { useYjsDocSync } from './useYjsDocSync';
import { BroadcastChannelProvider } from './BroadcastChannelProvider';

function baseDoc(): Doc {
  return {
    v: 1,
    nodes: { root: { id: 'root', text: 'Root', emoji: '', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } },
    floats: [],
    lines: [],
    zones: [],
    layoutMode: 'radial',
    themeKey: 'coral',
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe('useYjsDocSync', () => {
  it('pushes local doc changes out to a remote peer on the same docId', async () => {
    const docId = `hook-${Math.random()}`;
    const onRemoteDoc = () => {};
    const { rerender } = renderHook(({ doc }: { doc: Doc }) => useYjsDocSync(docId, doc, onRemoteDoc), { initialProps: { doc: baseDoc() } });

    const remoteYdoc = new Y.Doc();
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);
    cleanups.push(() => remoteProvider.disconnect());

    await waitFor(() => remoteYdoc.getMap('nodes').has('root'));

    const nextDoc: Doc = { ...baseDoc(), nodes: { ...baseDoc().nodes, root: { ...baseDoc().nodes.root!, text: 'Renamed locally' } } };
    rerender({ doc: nextDoc });

    await waitFor(() => (remoteYdoc.getMap('nodes').get('root') as Y.Map<unknown>).get('text') === 'Renamed locally');
    expect((remoteYdoc.getMap('nodes').get('root') as Y.Map<unknown>).get('text')).toBe('Renamed locally');
  });

  it("surfaces a remote peer's edit via onRemoteDoc", async () => {
    const docId = `hook-${Math.random()}`;
    const received: Doc[] = [];
    renderHook(({ doc }: { doc: Doc }) => useYjsDocSync(docId, doc, (d) => received.push(d)), { initialProps: { doc: baseDoc() } });

    const remoteYdoc = new Y.Doc();
    const remoteProvider = new BroadcastChannelProvider();
    remoteProvider.connect(docId, remoteYdoc);
    cleanups.push(() => remoteProvider.disconnect());

    await waitFor(() => remoteYdoc.getMap('nodes').has('root'));
    addNode(remoteYdoc, 'child1', { id: 'child1', text: 'from remote', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 10, y: 10 });
    setNodeField(remoteYdoc, 'root', 'children', ['child1']);

    await waitFor(() => received.some((d) => d.nodes.child1?.text === 'from remote'));
    const last = received[received.length - 1]!;
    expect(last.nodes.child1?.text).toBe('from remote');
    expect(last.nodes.root?.children).toEqual(['child1']);
  });

  it('reconnects to a fresh document when docId changes (does not leak the old session)', async () => {
    const docIdA = `hook-a-${Math.random()}`;
    const docIdB = `hook-b-${Math.random()}`;
    const received: Doc[] = [];
    const { rerender } = renderHook(({ docId, doc }: { docId: string; doc: Doc }) => useYjsDocSync(docId, doc, (d) => received.push(d)), {
      initialProps: { docId: docIdA, doc: baseDoc() },
    });

    rerender({ docId: docIdB, doc: baseDoc() });

    // A remote peer still on the OLD docId should no longer reach this hook.
    const staleRemote = new Y.Doc();
    const staleProvider = new BroadcastChannelProvider();
    staleProvider.connect(docIdA, staleRemote);
    cleanups.push(() => staleProvider.disconnect());
    addNode(staleRemote, 'staleChild', { id: 'staleChild', text: 'stale', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 });

    await new Promise((r) => setTimeout(r, 80));
    expect(received.some((d) => d.nodes.staleChild)).toBe(false);

    // A peer on the NEW docId should reach it.
    const freshRemote = new Y.Doc();
    const freshProvider = new BroadcastChannelProvider();
    freshProvider.connect(docIdB, freshRemote);
    cleanups.push(() => freshProvider.disconnect());
    await waitFor(() => freshRemote.getMap('nodes').has('root'));
    addNode(freshRemote, 'freshChild', { id: 'freshChild', text: 'fresh', emoji: '', parent: 'root', children: [], collapsed: false, color: null, x: 0, y: 0 });
    setNodeField(freshRemote, 'root', 'children', ['freshChild']);

    await waitFor(() => received.some((d) => d.nodes.freshChild?.text === 'fresh'));
  });
});

// jsdom (25.x) ships a real `BroadcastChannel`, so these tests exercise the
// actual message-passing (two independent Y.Doc instances, each behind its
// own `BroadcastChannelProvider`, connected to the same document id) rather
// than a hand-rolled mock — this is the same mechanism two real browser tabs
// use (per CLAUDE.md's M5 manual verification step).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToYDoc, yDocToDoc, type Doc } from '@mindflow/mindmap-core';
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

/** Polls until `predicate()` is true or the timeout elapses (BroadcastChannel
 * delivery is asynchronous, even within the same jsdom document). */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('BroadcastChannelProvider', () => {
  it('propagates a local Yjs update from one tab to another tab connected to the same docId', async () => {
    const docId = `doc-${Math.random()}`;
    const ydocA = docToYDoc(baseDoc());
    const ydocB = new Y.Doc();
    const providerA = new BroadcastChannelProvider();
    const providerB = new BroadcastChannelProvider();
    try {
      providerA.connect(docId, ydocA);
      providerB.connect(docId, ydocB);

      ydocA.getMap('nodes').set('extra', (() => {
        const m = new Y.Map<unknown>();
        m.set('id', 'extra');
        m.set('text', 'from A');
        return m;
      })());

      await waitFor(() => ydocB.getMap('nodes').has('extra'));
      expect((ydocB.getMap('nodes').get('extra') as Y.Map<unknown>).get('text')).toBe('from A');
    } finally {
      providerA.disconnect();
      providerB.disconnect();
    }
  });

  it("catches up a newly-connected tab via its 'sync-request' on connect", async () => {
    const docId = `doc-${Math.random()}`;
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const providerA = new BroadcastChannelProvider();
    providerA.connect(docId, ydocA);

    // A edits BEFORE B ever connects.
    ydocA.getMap('nodes').set('early', (() => {
      const m = new Y.Map<unknown>();
      m.set('id', 'early');
      m.set('text', 'edited before B joined');
      return m;
    })());

    const ydocB = new Y.Doc();
    const providerB = new BroadcastChannelProvider();
    try {
      providerB.connect(docId, ydocB); // sends 'sync-request'; A should reply with its full state

      await waitFor(() => ydocB.getMap('nodes').has('early'));
      expect((ydocB.getMap('nodes').get('early') as Y.Map<unknown>).get('text')).toBe('edited before B joined');
    } finally {
      providerA.disconnect();
      providerB.disconnect();
    }
  });

  it('two tabs converge to the same Doc after each makes a concurrent, independent edit', async () => {
    const docId = `doc-${Math.random()}`;
    const doc = baseDoc();
    const ydocA = docToYDoc(doc);
    const providerA = new BroadcastChannelProvider();
    providerA.connect(docId, ydocA);

    const ydocB = new Y.Doc();
    const providerB = new BroadcastChannelProvider();
    providerB.connect(docId, ydocB);
    await waitFor(() => ydocB.getMap('nodes').has('root')); // wait for B's initial sync-request catch-up

    try {
      const nm = new Y.Map<unknown>();
      nm.set('id', 'fromA');
      nm.set('text', 'A');
      ydocA.getMap('nodes').set('fromA', nm);

      const nm2 = new Y.Map<unknown>();
      nm2.set('id', 'fromB');
      nm2.set('text', 'B');
      ydocB.getMap('nodes').set('fromB', nm2);

      await waitFor(() => ydocA.getMap('nodes').has('fromB') && ydocB.getMap('nodes').has('fromA'));

      expect(yDocToDoc(ydocA)).toEqual(yDocToDoc(ydocB));
    } finally {
      providerA.disconnect();
      providerB.disconnect();
    }
  });

  it('disconnect() stops delivering further updates', async () => {
    const docId = `doc-${Math.random()}`;
    const ydocA = docToYDoc(baseDoc());
    const ydocB = new Y.Doc();
    const providerA = new BroadcastChannelProvider();
    const providerB = new BroadcastChannelProvider();
    providerA.connect(docId, ydocA);
    providerB.connect(docId, ydocB);
    await waitFor(() => ydocB.getMap('nodes').has('root'));

    providerB.disconnect();
    const nm = new Y.Map<unknown>();
    nm.set('id', 'afterDisconnect');
    ydocA.getMap('nodes').set('afterDisconnect', nm);

    await new Promise((r) => setTimeout(r, 60));
    expect(ydocB.getMap('nodes').has('afterDisconnect')).toBe(false);
    providerA.disconnect();
  });

  describe('awareness (presence) relay', () => {
    it("relays a local awareness state (setLocalState) to a peer connected to the same docId", async () => {
      const docId = `aware-${Math.random()}`;
      const ydocA = docToYDoc(baseDoc());
      const ydocB = new Y.Doc();
      const providerA = new BroadcastChannelProvider();
      const providerB = new BroadcastChannelProvider();
      try {
        providerA.connect(docId, ydocA);
        providerB.connect(docId, ydocB);
        const awarenessA = providerA.getAwareness();
        const awarenessB = providerB.getAwareness();
        expect(awarenessA).not.toBeNull();
        expect(awarenessB).not.toBeNull();

        awarenessA!.setLocalStateField('user', { name: 'Coral Otter', color: '#f0663f' });
        awarenessA!.setLocalStateField('cursor', { x: 12, y: 34 });

        await waitFor(() => awarenessB!.getStates().has(awarenessA!.clientID));
        const stateOnB = awarenessB!.getStates().get(awarenessA!.clientID) as { user: { name: string }; cursor: { x: number; y: number } };
        expect(stateOnB.user.name).toBe('Coral Otter');
        expect(stateOnB.cursor).toEqual({ x: 12, y: 34 });
      } finally {
        providerA.disconnect();
        providerB.disconnect();
      }
    });

    it('broadcasts an already-connected peer\'s awareness state to a newly-connected one (via sync-request)', async () => {
      const docId = `aware-sync-${Math.random()}`;
      const ydocA = docToYDoc(baseDoc());
      const providerA = new BroadcastChannelProvider();
      providerA.connect(docId, ydocA);
      const awarenessA = providerA.getAwareness()!;
      awarenessA.setLocalStateField('user', { name: 'Early Fox', color: '#3f8fd0' });

      const ydocB = new Y.Doc();
      const providerB = new BroadcastChannelProvider();
      try {
        providerB.connect(docId, ydocB); // fires 'sync-request'; A replies with its awareness too
        const awarenessB = providerB.getAwareness()!;

        await waitFor(() => awarenessB.getStates().has(awarenessA.clientID));
        expect((awarenessB.getStates().get(awarenessA.clientID) as { user: { name: string } }).user.name).toBe('Early Fox');
      } finally {
        providerA.disconnect();
        providerB.disconnect();
      }
    });

    it("disconnect() broadcasts this client's departure (local awareness state -> removed) to peers", async () => {
      const docId = `aware-leave-${Math.random()}`;
      const ydocA = docToYDoc(baseDoc());
      const ydocB = new Y.Doc();
      const providerA = new BroadcastChannelProvider();
      const providerB = new BroadcastChannelProvider();
      providerA.connect(docId, ydocA);
      providerB.connect(docId, ydocB);
      const awarenessA = providerA.getAwareness()!;
      const awarenessB = providerB.getAwareness()!;
      awarenessA.setLocalStateField('user', { name: 'Leaving Panda', color: '#8a6bd1' });

      await waitFor(() => awarenessB.getStates().has(awarenessA.clientID));
      expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(true);

      providerA.disconnect();

      await waitFor(() => !awarenessB.getStates().has(awarenessA.clientID));
      expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(false);
      providerB.disconnect();
    });

    it('getAwareness() returns null before connect() and after disconnect()', () => {
      const provider = new BroadcastChannelProvider();
      expect(provider.getAwareness()).toBeNull();
      const ydoc = docToYDoc(baseDoc());
      provider.connect(`aware-lifecycle-${Math.random()}`, ydoc);
      expect(provider.getAwareness()).not.toBeNull();
      provider.disconnect();
      expect(provider.getAwareness()).toBeNull();
    });
  });
});

// M5 editor integration seam: bridges the editor's plain `Doc` React state to
// a live `Y.Doc` backed by whichever `CollabProvider` `collab/factory.ts`
// picked (Supabase Realtime / BroadcastChannel / no-op). This is the ONLY
// piece of collaboration-aware code the editor hook needs to call — it does
// not otherwise know Yjs exists.
//
// Design (see CLAUDE.md's M5 task brief "에디터 통합" section): rather than
// rewriting every one of `useEditorState`'s dozens of individual mutation
// call sites (`commitDoc`, `setDoc` for themeKey, `applySnapshot` for
// undo/redo, drag handlers, ...) to each emit its own fine-grained Yjs
// operation, this hook watches the SAME `doc` value `useEditorState` already
// produces and reconciles it into the Y.Doc via `applyDocToYDoc`'s diff (see
// that function's doc comment in `@mindflow/mindmap-core`) whenever it
// changes. `applyDocToYDoc` still applies the diff as real per-node/
// per-field Yjs map operations (not a single opaque blob), so the underlying
// CRDT merge behavior verified by `packages/mindmap-core/src/crdt/binding.test.ts`
// (concurrent edits to different fields of the same node both surviving,
// etc.) is exactly what a real multi-tab/multi-device session gets — the
// simplification is only in WHEN the diff is computed (once per doc-state
// change, not once per user gesture), which is a deliberate scope reduction
// to keep this integration point small and low-risk; see the M5 report for
// what this trades away (undo/redo semantics for remote edits, in
// particular — see below).
//
// Remote updates are applied the same way in reverse: an incoming Yjs update
// is applied to the local Y.Doc, converted back to a `Doc` via `yDocToDoc`,
// and handed to `onRemoteDoc` (which `useEditorState` wires straight to its
// own `setDoc` — NOT through `commitDoc`, so a remote peer's edits do not
// get pushed onto this tab's local undo/redo stack; each tab's Ctrl+Z only
// ever undoes ITS OWN edits, which avoids the confusing "undo reverted
// someone else's change" experience without needing a CRDT-aware undo
// manager for this first cut).

import { useEffect, useRef } from 'react';
import type { Doc, YDoc } from '@mindflow/mindmap-core';
import { applyDocToYDoc, docToYDoc, yDocToDoc } from '@mindflow/mindmap-core';
import { createCollabProvider } from './factory';
import type { CollabProvider } from './ports';

/** Transaction-origin sentinel for updates this hook itself applies to the
 * Y.Doc as a result of a LOCAL doc-state change (as opposed to updates a
 * `CollabProvider` applied after receiving them from the network). Letting
 * `handleUpdate` tell the two apart is what prevents an infinite
 * local-change -> Y.Doc -> "remote" update -> setDoc -> local-change loop. */
const LOCAL_ORIGIN = Symbol('mindflow-local-doc-sync');

export function useYjsDocSync(docId: string, doc: Doc, onRemoteDoc: (doc: Doc) => void): void {
  const providerRef = useRef<CollabProvider | null>(null);
  if (!providerRef.current) providerRef.current = createCollabProvider();

  const ydocRef = useRef<YDoc | null>(null);
  const lastSyncedRef = useRef<Doc | null>(null);
  const onRemoteDocRef = useRef(onRemoteDoc);
  onRemoteDocRef.current = onRemoteDoc;
  // `doc` at the moment `docId` (re)connects — read via a ref so the
  // (re)connect effect below can stay dependent on `docId` ONLY (see its own
  // comment for why depending on `doc` there would be wrong).
  const docAtConnectRef = useRef(doc);
  docAtConnectRef.current = doc;

  // (Re)connects a fresh Y.Doc + provider session whenever the OPEN DOCUMENT
  // changes (navigating to a different map). Intentionally does NOT depend
  // on `doc` itself — re-running this on every keystroke would tear down and
  // recreate the whole collab session (and briefly disconnect every peer)
  // for no reason; pushing incremental local edits into the already-live
  // Y.Doc is the separate effect below.
  useEffect(() => {
    const ydoc = docToYDoc(docAtConnectRef.current);
    ydocRef.current = ydoc;
    lastSyncedRef.current = docAtConnectRef.current;

    const handleUpdate = (_update: Uint8Array, origin: unknown): void => {
      if (origin === LOCAL_ORIGIN) return; // our own local->Y.Doc push; `doc` state already reflects it
      const merged = yDocToDoc(ydoc);
      lastSyncedRef.current = merged;
      onRemoteDocRef.current(merged);
    };
    ydoc.on('update', handleUpdate);
    providerRef.current!.connect(docId, ydoc);

    return () => {
      ydoc.off('update', handleUpdate);
      providerRef.current!.disconnect();
      ydocRef.current = null;
    };
  }, [docId]);

  // Pushes local doc-state changes into the live Y.Doc as a diff-based Yjs
  // transaction (see `applyDocToYDoc`), which in turn is what the connected
  // `CollabProvider` broadcasts to peers.
  useEffect(() => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    if (doc === lastSyncedRef.current) return; // this `doc` value came FROM the network (see handleUpdate above) — nothing new to push
    applyDocToYDoc(ydoc, doc, lastSyncedRef.current, LOCAL_ORIGIN);
    lastSyncedRef.current = doc;
  }, [doc]);
}

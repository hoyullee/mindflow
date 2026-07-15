// M5: Doc <-> Y.Doc binding. Pure TS (no DOM/network) — `yjs` itself has zero
// browser/DOM dependency (it is environment-agnostic CRDT machinery, built on
// `lib0`), so depending on it here does not violate mindmap-core's purity
// rule (ADR-0001 §2 / eslint.config.mjs's `no-restricted-imports`/
// `no-restricted-globals`). Transport (WebSocket/BroadcastChannel/Supabase
// Realtime) lives entirely in `apps/web/src/collab/` — this module only
// knows how to read/write a `Y.Doc`'s in-memory CRDT state; it never touches
// the network.
//
// Shape mirrors `Doc` (see `../model.ts`):
//   ydoc.getMap('nodes')  : Y.Map<nodeId, Y.Map<field, value>>   — one nested
//                           Y.Map per node so concurrent edits to DIFFERENT
//                           fields of the SAME node both survive an update
//                           exchange (this is the scenario the M5 task brief
//                           calls out explicitly). Concurrent edits to the
//                           SAME field of the SAME node still converge (both
//                           peers end up with the identical winning value —
//                           Yjs's per-key-map last-writer-wins, deterministic
//                           via each update's internal clock/client id), just
//                           without a smarter field-level 3-way merge.
//   ydoc.getMap('floats') / 'lines' / 'zones' : same nested-Y.Map-per-id
//                           pattern, keyed by each item's `id`.
//   ydoc.getArray('floatsOrder') / 'linesOrder' / 'zonesOrder' : Y.Array<string>
//                           of ids, so array ORDER round-trips too (a plain
//                           Y.Map has no ordering guarantee across peers).
//   ydoc.getMap('meta')    : Y.Map with 'layoutMode' / 'themeKey'.
//
// `applyDocToYDoc` is the "mutation helper" the task brief asks for: it
// diffs an old/new `Doc` pair and applies ONLY the changed fields as Yjs
// operations inside a single transaction (so a whole editor "commit" — which
// may touch several nodes — becomes one coalesced Yjs update, not a giant
// document replace). `addNode`/`removeNode`/`setNodeField` are lower-level
// primitives for callers (and tests) that want to express a single
// structural change directly as its own transaction.

import * as Y from 'yjs';
import type { Doc, Float, Line, LayoutMode, Node, NodeMap, Zone } from '../model';
import { DEFAULT_LAYOUT_MODE, DEFAULT_THEME_KEY } from '../model';

type PlainRecord = Record<string, unknown>;
type YEntityMap = Y.Map<unknown>;

interface WithId {
  id: string;
}

/** Sets/deletes only the keys that actually differ between `prev` and `next`
 * onto `yMap` — the core "diff → Yjs ops" primitive everything else here is
 * built on. Keys present in `prev` but absent from `next` are deleted. */
function reconcileFields(yMap: YEntityMap, prev: PlainRecord | undefined, next: PlainRecord): void {
  if (prev) {
    for (const k of Object.keys(prev)) {
      if (!(k in next)) yMap.delete(k);
    }
  }
  for (const k of Object.keys(next)) {
    const nv = next[k];
    if (prev && prev[k] === nv) continue;
    if (nv === undefined) yMap.delete(k);
    else yMap.set(k, nv);
  }
}

function yMapToObject<T>(yMap: YEntityMap): T {
  const out: PlainRecord = {};
  yMap.forEach((v, k) => {
    out[k] = v;
  });
  return out as T;
}

function syncNodesMap(ydoc: Y.Doc, prevNodes: NodeMap | undefined, nextNodes: NodeMap): void {
  const map = ydoc.getMap<YEntityMap>('nodes');
  const prevIds = prevNodes ? Object.keys(prevNodes) : [];
  const nextIds = Object.keys(nextNodes);
  const nextIdSet = new Set(nextIds);
  for (const id of prevIds) {
    if (!nextIdSet.has(id)) map.delete(id);
  }
  for (const id of nextIds) {
    const prevNode = prevNodes?.[id];
    const nextNode = nextNodes[id];
    if (prevNode === nextNode) continue; // reference-equal: nothing changed, skip (perf + avoids update churn)
    let nm = map.get(id);
    if (!nm) {
      nm = new Y.Map<unknown>();
      map.set(id, nm);
    }
    reconcileFields(nm, prevNode as unknown as PlainRecord | undefined, { id, ...(nextNode as unknown as PlainRecord) });
  }
}

function readNodesMap(ydoc: Y.Doc): NodeMap {
  const map = ydoc.getMap<YEntityMap>('nodes');
  const out: NodeMap = {};
  map.forEach((nm, id) => {
    out[id] = yMapToObject<Node>(nm);
  });
  return out;
}

function syncEntityList<T extends WithId>(ydoc: Y.Doc, mapName: string, orderName: string, prevList: T[] | undefined, nextList: T[]): void {
  const map = ydoc.getMap<YEntityMap>(mapName);
  const order = ydoc.getArray<string>(orderName);
  const prevIds = prevList ? prevList.map((x) => x.id) : [];
  const nextIds = nextList.map((x) => x.id);
  const nextIdSet = new Set(nextIds);
  for (const id of prevIds) {
    if (!nextIdSet.has(id)) map.delete(id);
  }
  for (const item of nextList) {
    const prevItem = prevList?.find((x) => x.id === item.id);
    if (prevItem === item) continue;
    let em = map.get(item.id);
    if (!em) {
      em = new Y.Map<unknown>();
      map.set(item.id, em);
    }
    reconcileFields(em, prevItem as unknown as PlainRecord | undefined, item as unknown as PlainRecord);
  }
  const currentOrder = order.toArray();
  const orderChanged = currentOrder.length !== nextIds.length || currentOrder.some((id, i) => id !== nextIds[i]);
  if (orderChanged) {
    order.delete(0, order.length);
    if (nextIds.length) order.insert(0, nextIds);
  }
}

function readEntityList<T extends WithId>(ydoc: Y.Doc, mapName: string, orderName: string): T[] {
  const map = ydoc.getMap<YEntityMap>(mapName);
  const order = ydoc.getArray<string>(orderName);
  const ids = order.toArray();
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const em = map.get(id);
    if (!em) continue; // order array out of sync with map (shouldn't happen via our own writers) — skip defensively
    seen.add(id);
    out.push(yMapToObject<T>(em));
  }
  // Defensive: any entity present in the map but missing from the order array
  // (e.g. a remote peer applied an update this client's order-array logic
  // didn't produce) still round-trips instead of silently vanishing.
  map.forEach((em, id) => {
    if (seen.has(id)) return;
    out.push(yMapToObject<T>(em));
  });
  return out;
}

/** Creates a brand-new `Y.Doc` whose CRDT state represents `doc` (M5 task
 * brief: `docToYDoc(doc): Y.Doc`). */
export function docToYDoc(doc: Doc): Y.Doc {
  const ydoc = new Y.Doc();
  applyDocToYDoc(ydoc, doc);
  return ydoc;
}

/** Reads a `Y.Doc`'s current CRDT state back out as a plain `Doc` (M5 task
 * brief: `yDocToDoc(ydoc): Doc`). Never mutates `ydoc`. */
export function yDocToDoc(ydoc: Y.Doc): Doc {
  const nodes = readNodesMap(ydoc);
  const floats = readEntityList<Float>(ydoc, 'floats', 'floatsOrder');
  const lines = readEntityList<Line>(ydoc, 'lines', 'linesOrder');
  const zones = readEntityList<Zone>(ydoc, 'zones', 'zonesOrder');
  const meta = ydoc.getMap<unknown>('meta');
  const layoutMode = (meta.get('layoutMode') as LayoutMode | undefined) ?? DEFAULT_LAYOUT_MODE;
  const themeKey = (meta.get('themeKey') as string | undefined) ?? DEFAULT_THEME_KEY;
  return { v: 1, nodes, floats, lines, zones, layoutMode, themeKey };
}

/**
 * Applies the difference between `prevDoc` (or `undefined`/`null` for "the
 * Y.Doc is empty/being initialized") and `nextDoc` onto `ydoc` as Yjs
 * mutations, all inside one transaction. This is the "local edit -> Yjs
 * transaction" mutation helper the M5 task brief calls for: the editor
 * integration (`apps/web`) calls this whenever its local `doc` state
 * changes, so every local commit becomes a real (coalesced) CRDT update
 * rather than the whole document being blindly overwritten.
 *
 * `origin` is forwarded to `ydoc.transact` so a transport layer can tag
 * locally-produced updates (and skip re-broadcasting updates it itself just
 * applied from the network) — see `apps/web/src/collab/`.
 */
export function applyDocToYDoc(ydoc: Y.Doc, nextDoc: Doc, prevDoc?: Doc | null, origin?: unknown): void {
  ydoc.transact(() => {
    syncNodesMap(ydoc, prevDoc?.nodes, nextDoc.nodes);
    syncEntityList<Float>(ydoc, 'floats', 'floatsOrder', prevDoc?.floats, nextDoc.floats);
    syncEntityList<Line>(ydoc, 'lines', 'linesOrder', prevDoc?.lines, nextDoc.lines);
    syncEntityList<Zone>(ydoc, 'zones', 'zonesOrder', prevDoc?.zones, nextDoc.zones);
    const meta = ydoc.getMap<unknown>('meta');
    if (!prevDoc || prevDoc.layoutMode !== nextDoc.layoutMode) meta.set('layoutMode', nextDoc.layoutMode);
    if (!prevDoc || prevDoc.themeKey !== nextDoc.themeKey) meta.set('themeKey', nextDoc.themeKey);
  }, origin);
}

/** Adds (or overwrites) a single node as its own Yjs transaction — a
 * lower-level primitive for callers that want one structural change at a
 * time instead of a whole-doc diff (mirrors `mindmap-core`'s `addChildNode`
 * etc., but expressed directly against the Y.Doc). */
export function addNode(ydoc: Y.Doc, id: string, node: Node, origin?: unknown): void {
  ydoc.transact(() => {
    const nm = new Y.Map<unknown>();
    reconcileFields(nm, undefined, { id, ...(node as unknown as PlainRecord) });
    ydoc.getMap<YEntityMap>('nodes').set(id, nm);
  }, origin);
}

/** Removes a single node as its own Yjs transaction. */
export function removeNode(ydoc: Y.Doc, id: string, origin?: unknown): void {
  ydoc.transact(() => {
    ydoc.getMap<YEntityMap>('nodes').delete(id);
  }, origin);
}

/** Sets (or, when `value === undefined`, deletes) a single field of a single
 * node as its own Yjs transaction — this is the "속성변경" primitive from the
 * task brief: two peers calling this for the SAME node id but DIFFERENT
 * `field`s converge with both changes intact after an update exchange. */
export function setNodeField<K extends keyof Node>(ydoc: Y.Doc, id: string, field: K, value: Node[K], origin?: unknown): void {
  ydoc.transact(() => {
    const map = ydoc.getMap<YEntityMap>('nodes');
    let nm = map.get(id);
    if (!nm) {
      nm = new Y.Map<unknown>();
      nm.set('id', id);
      map.set(id, nm);
    }
    if (value === undefined) nm.delete(field as string);
    else nm.set(field as string, value);
  }, origin);
}

/** Encodes the full current state of `ydoc` as a portable update (thin
 * re-export so callers don't need their own `yjs` import just for the two
 * functions the transport layer needs — `apps/web/src/collab/` still may
 * import `yjs` directly for `Y.Doc`/`Y.Map` typing, this is purely a
 * convenience). */
export function encodeStateAsUpdate(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

/** Applies a remote update (produced by `encodeStateAsUpdate`, possibly from
 * a different `Y.Doc` instance/peer) onto `ydoc`. */
export function applyUpdate(ydoc: Y.Doc, update: Uint8Array, origin?: unknown): void {
  Y.applyUpdate(ydoc, update, origin);
}

/** Convenience alias so callers don't need their own `import * as Y from
 * 'yjs'` just to spell the `Y.Doc` type. */
export type YDoc = Y.Doc;

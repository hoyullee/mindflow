// Small helper shared by every render layer (`NodeLayer`/`FloatLayer`/
// `LineLayer`/`ZoneLayer`) that needs to know "is any REMOTE peer currently
// selecting this object" — used to draw a peer-colored outline distinct from
// this tab's own `th.accent` selection ring (`controller.multiGroups`/
// `controller.selection`).

import type { RemotePeer } from '../../collab/presence';

/** Every remote peer whose broadcast `selection` includes `id` under the
 * given object kind. Usually 0 or 1 (two people rarely select the exact same
 * object at once), but the caller (e.g. `NodeLayer`) only ever renders the
 * FIRST one to keep the highlight readable rather than stacking N rings. */
export function peersSelecting(peers: RemotePeer[], kind: 'nodes' | 'floats' | 'lines' | 'zones', id: string): RemotePeer[] {
  if (!peers.length) return [];
  return peers.filter((p) => p.selection[kind].includes(id));
}

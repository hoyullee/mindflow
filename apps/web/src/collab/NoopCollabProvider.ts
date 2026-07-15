// Neither Supabase nor `BroadcastChannel` is available — single-user, current
// (pre-M5) behavior. Kept as an explicit no-op provider (rather than `null`
// scattered through the editor) so `useYjsDocSync`'s call sites stay
// unconditional: connect/disconnect are always safe to call.

import type { YDoc } from '@mindflow/mindmap-core';
import type { CollabProvider } from './ports';

export class NoopCollabProvider implements CollabProvider {
  connect(docId: string, ydoc: YDoc): void {
    void docId;
    void ydoc;
    /* no transport: single-user, matches pre-M5 behavior */
  }
  disconnect(): void {
    /* nothing to release */
  }
}
